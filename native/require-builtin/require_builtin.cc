// require_builtin.node — minimal OpenHarmony/arm64 bridge (raw V8).
//
// dsh-app-boot needs to require Node *internal* modules (e.g.
// internal/modules/esm/loader). Upstream ships prebuilds only for
// darwin/linux/win32 — none for openharmony-arm64. Rather than port the
// upstream addon's machine-code getter parser (gated to glibc; OHOS uses
// musl), this bridge reaches the same endpoint through symbols that
// libelectron.so already exports:
//
//   v8::Context::GetAlignedPointerFromEmbedderData(38)  // slot 38 = Realm*
//   node::PrincipalRealm::builtin_module_require()      // -> requireBuiltin fn
//
// The addon registers through the raw node_register_module_v136 symbol this
// OHOS-Electron loader looks up (no NODE_MODULE_VERSION constructor path).
// It is compiled against the matching Electron headers with pointer
// compression / sandbox defines, so V8 layout is consistent.

#include <v8.h>
#include <v8-context.h>
#include <v8-function.h>
#include <v8-local-handle.h>
#include <v8-object.h>
#include <v8-primitive.h>

#include <dlfcn.h>
#include <stdint.h>

namespace {

constexpr int kRealmSlot = 38;

// node::PrincipalRealm::builtin_module_require() — private ABI, resolved at
// runtime. It is a non-virtual const member, so on AArch64 Itanium it is a
// plain function taking `this` (realm) in x0 and returning the handle word.
using BuiltinModuleRequireGetterFn = v8::Local<v8::Value> (*)(void* /*realm*/);
constexpr const char* kSymBuiltinModuleRequireGetter =
    "_ZNK4node14PrincipalRealm22builtin_module_requireEv";

v8::Local<v8::String> Str(v8::Isolate* iso, const char* s) {
  return v8::String::NewFromUtf8(iso, s, v8::NewStringType::kNormal)
      .ToLocalChecked();
}

void Throw(v8::Isolate* iso, const char* message) {
  iso->ThrowException(v8::Exception::Error(Str(iso, message)));
}

// Resolve the PrincipalRealm's builtin_module_require JS function for the
// current context. Returns an empty Local on failure (a JS error is thrown).
v8::Local<v8::Function> ResolveRequireBuiltin(
    v8::Isolate* iso, v8::Local<v8::Context> context) {
  // Cached raw getter pointer (resolved once; symbol is process-wide).
  static BuiltinModuleRequireGetterFn getter = []() {
    return reinterpret_cast<BuiltinModuleRequireGetterFn>(
        dlsym(RTLD_DEFAULT, kSymBuiltinModuleRequireGetter));
  }();
  if (getter == nullptr) {
    Throw(iso, "PrincipalRealm::builtin_module_require symbol not found");
    return v8::Local<v8::Function>();
  }

  void* realm = context->GetAlignedPointerFromEmbedderData(kRealmSlot);
  if (realm == nullptr) {
    Throw(iso, "Realm pointer in context embedder slot 38 is null");
    return v8::Local<v8::Function>();
  }

  v8::Local<v8::Value> handle = getter(realm);
  if (!handle->IsFunction()) {
    Throw(iso, "builtin_module_require() did not return a function");
    return v8::Local<v8::Function>();
  }
  return handle.As<v8::Function>();
}

// requireBuiltin(moduleId: string) -> internal module exports
void RequireBuiltin(const v8::FunctionCallbackInfo<v8::Value>& args) {
  v8::Isolate* iso = args.GetIsolate();
  v8::Local<v8::Context> context = iso->GetCurrentContext();
  v8::HandleScope scope(iso);

  if (args.Length() < 1 || !args[0]->IsString()) {
    Throw(iso, "requireBuiltin() expects a string module id");
    return;
  }

  v8::Local<v8::Function> require_builtin =
      ResolveRequireBuiltin(iso, context);
  if (require_builtin.IsEmpty()) return;  // JS error already thrown

  v8::Local<v8::Value> argv[] = {args[0]};
  v8::Local<v8::Value> result;
  if (!require_builtin->Call(context, context->Global(), 1, argv)
           .ToLocal(&result)) {
    // The internal require's own JS exception is already pending.
    return;
  }
  args.GetReturnValue().Set(result);
}

// isAllowedInternalId() -> true (this is the unrestricted variant)
void IsAllowedInternalId(const v8::FunctionCallbackInfo<v8::Value>& args) {
  args.GetReturnValue().Set(true);
}

// getNativeBindingInfo() -> { mode, product, backend, abi }
void GetNativeBindingInfo(const v8::FunctionCallbackInfo<v8::Value>& args) {
  v8::Isolate* iso = args.GetIsolate();
  v8::HandleScope scope(iso);

  v8::Local<v8::Object> info = v8::Object::New(iso);
  auto set = [&](const char* key, const char* value) {
    info->Set(iso->GetCurrentContext(), Str(iso, key), Str(iso, value)).Check();
  };
  set("mode", "release");
  set("product", "openharmony-arm64");
  set("backend", "napi");
  set("abi", "napi-v9");
  args.GetReturnValue().Set(info);
}

void Register(v8::Local<v8::Object> exports,
              v8::Local<v8::Context> context) {
  v8::Isolate* iso = context->GetIsolate();

  struct Fn {
    const char* name;
    v8::FunctionCallback cb;
  };
  const Fn fns[] = {
      {"requireBuiltin", RequireBuiltin},
      {"isAllowedInternalId", IsAllowedInternalId},
      {"getNativeBindingInfo", GetNativeBindingInfo},
  };
  for (const Fn& f : fns) {
    v8::Local<v8::Function> fn =
        v8::Function::New(context, f.cb).ToLocalChecked();
    exports->Set(context, Str(iso, f.name), fn).Check();
  }
}

}  // namespace

// Raw symbol the OHOS-Electron loader looks up (context-aware variant).
extern "C" __attribute__((visibility("default"))) void
node_register_module_v136(v8::Local<v8::Object> exports,
                          v8::Local<v8::Value> module,
                          v8::Local<v8::Context> context) {
  Register(exports, context);
}
