/**
 * Host half of harmony-plugin-workspace-picker. Registers the plugin-owned
 * native-capability IPC bridge: the renderer cannot reach `app.getPath`,
 * `DSH_EXTRA_WRITABLE_ROOTS`, or the ArkTS permission functions, so four
 * `ipcMain.handle` channels expose them to this plugin's client half only.
 * The bridge carries root paths and permission results, never workspace or
 * session data. Named exports only: a default export would make the Loader
 * discard `inject`.
 * @module harmony-plugin-workspace-picker
 */
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'

const nodeRequire = createRequire(import.meta.url)

/** Plugin name used by loader diagnostics and the profile patch row. */
export const name = 'harmony-plugin-workspace-picker'

/** No cordis services are required; registrations use only ctx.effect. */
export const inject = []

/** Root ids the picker exposes; the sandbox sits inside app userData. */
const ROOT_SANDBOX = 'sandbox'
const USER_ROOTS = ['desktop', 'documents', 'download']
const ALL_ROOTS = [ROOT_SANDBOX, ...USER_ROOTS]

/** Fixed position of each user root inside DSH_EXTRA_WRITABLE_ROOTS. */
const USER_ROOT_INDEX = { desktop: 0, documents: 1, download: 2 }

/**
 * Error carrying a stable code the client maps to its unavailable/retry panel
 * or permission surface; messages stay free of throwaway context.
 */
function codedError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

/** Electron main-process surface; absent (plain Node) is a reported failure. */
function electron() {
  let electronModule
  try {
    electronModule = nodeRequire('electron')
  } catch (error) {
    throw codedError('bridge-unavailable', 'electron is not reachable from the host plugin')
  }
  if (typeof electronModule.ipcMain?.handle !== 'function'
    || typeof electronModule.systemPreferences?.callArkTSAsyncFunction !== 'function'
    || typeof electronModule.app?.getPath !== 'function') {
    throw codedError('bridge-unavailable', 'electron ipcMain/systemPreferences/app surface is incomplete')
  }
  return electronModule
}

/** Resolve one root to its absolute host path, creating the sandbox root. */
async function resolveRoot(rootId) {
  if (!ALL_ROOTS.includes(rootId)) {
    throw codedError('root-unknown', `unknown root id: ${String(rootId)}`)
  }
  const { app } = electron()
  if (rootId === ROOT_SANDBOX) {
    const path = join(app.getPath('userData'), 'workspace')
    await mkdir(path, { recursive: true })
    return path
  }
  const list = process.env.DSH_EXTRA_WRITABLE_ROOTS
  if (typeof list !== 'string' || list.length === 0) {
    throw codedError('root-unresolved', 'DSH_EXTRA_WRITABLE_ROOTS is not configured')
  }
  const parts = list.split(nodeRequire('node:path').delimiter)
  const path = parts[USER_ROOT_INDEX[rootId]]
  if (typeof path !== 'string' || path.length === 0) {
    throw codedError('root-unresolved', `root "${rootId}" is missing from DSH_EXTRA_WRITABLE_ROOTS`)
  }
  return path
}

/** Read the value field of the {type,value} envelope the ArkTS bridge returns. */
function bridgeValue(envelope) {
  if (envelope === null || typeof envelope !== 'object' || !('value' in envelope)) {
    throw codedError('bridge-unavailable', 'arkts bridge returned no value envelope')
  }
  return envelope.value
}

const CHANNELS = {
  root: `${name}:root`,
  permissionCheck: `${name}:permission-check`,
  permissionRequest: `${name}:permission-request`,
  openAppInfo: `${name}:open-app-info`,
}

/**
 * Register the four IPC channels and return the disposer.
 * @param ctx - the plugin context; registrations are effects scoped to it.
 */
export function apply(ctx) {
  ctx.effect(() => {
    const { ipcMain, systemPreferences } = electron()

    const install = (channel, handler) => {
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, handler)
    }

    install(CHANNELS.root, (_event, rootId) => resolveRoot(rootId))

    install(CHANNELS.permissionCheck, async (_event, type) => {
      const envelope = await systemPreferences.callArkTSAsyncFunction(
        'PermissionManagerAdapter.CheckPermissions', 'boolean', [type],
      )
      return bridgeValue(envelope) === true
    })

    install(CHANNELS.permissionRequest, async (_event, type) => {
      const envelope = await systemPreferences.callArkTSAsyncFunction(
        'PermissionManagerAdapter.RequestPermissionCode', 'number', [type],
      )
      return Number(bridgeValue(envelope))
    })

    install(CHANNELS.openAppInfo, async () => {
      await systemPreferences.callArkTSAsyncFunction(
        'ElectronApp.OpenApplicationInfoEntry', 'void', [],
      )
    })

    return () => {
      for (const channel of Object.values(CHANNELS)) ipcMain.removeHandler(channel)
    }
  }, `${name}: native-capability IPC bridge`)
}
