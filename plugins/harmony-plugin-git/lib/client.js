/**
 * Client half of harmony-plugin-git: the "Git 凭据" page in Settings.
 *
 * Lazy-CJS factory: script execution only registers the factory; every side effect (dictionary
 * registration, slot registration) runs inside the factory closure.
 *
 * The page is deliberately **write-mostly**. The client-reachable credential API serves
 * `describe` / `set` / `unset` over reference names and never returns a stored value, and it
 * cannot enumerate references either — so the page shows the hosts the user has entered here
 * (remembered in `localStorage`) plus, per host, whether a credential is configured and where it
 * came from. The value format and reference name are the host contract implemented in
 * `lib/auth.js` (`GIT_CREDENTIAL_<HOST>` with `host[:port]` upper-cased and every non-alphanumeric
 * character replaced by `_`, value `<username>:<password>`), and they are printed verbatim so a
 * user can also maintain `$DSH_HOME/.credentials.yaml` by hand.
 */

window.__ModuleLoader__.load({
  id: 'harmony-plugin-git',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const LOCALE_NS = 'gitCredentials'
    const STORAGE_KEY = 'harmony-plugin-git.hosts'
    const REF_PREFIX = 'GIT_CREDENTIAL_'

    /**
     * Mirror of the host-side reference-name rule (`lib/auth.js`). Kept as a two-line duplicate
     * rather than an import because the two halves ship in different module graphs; if one
     * changes, the other must change with it.
     */
    function refForHost(host) {
      return REF_PREFIX + String(host).toUpperCase().replace(/[^A-Z0-9]/g, '_')
    }

    /** Hosts the user has entered on this page, newest last. Never contains a secret. */
    function readHosts() {
      try {
        const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
        return Array.isArray(raw) ? raw.filter(entry => typeof entry === 'string' && entry.length > 0) : []
      } catch {
        return []
      }
    }

    /** @param hosts - the host list to persist. */
    function writeHosts(hosts) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(hosts))
      } catch {
        // A full or unavailable localStorage must not break credential management: the store
        // itself is the source of truth, this list is only the page's own index.
      }
    }

    /**
     * One configured-host row: reference name, live status, and the two write actions.
     * @param props - row props assembled by the page.
     */
    function HostRow(props) {
      const { host, info, busy, t, onRemove, onUpdate } = props
      const ref = refForHost(host)
      const state = info === undefined
        ? 'unknown'
        : info.configured ? (info.writable ? 'configured' : 'readonly') : 'absent'
      return h('div', { className: 'git-cred-row' }, [
        h('div', { className: 'git-cred-main', key: 'main' }, [
          h('div', { className: 'git-cred-host', key: 'host' }, host),
          h('code', { className: 'git-cred-ref', key: 'ref' }, ref),
        ]),
        h('div', { className: 'git-cred-actions', key: 'actions' }, [
          h('span', { className: `git-cred-state git-cred-state-${state}`, key: 'state' }, t(`state.${state}`)),
          h('button', { type: 'button', key: 'update', disabled: busy, onClick: () => onUpdate(host) }, t('action.update')),
          h('button', { type: 'button', key: 'remove', disabled: busy, onClick: () => onRemove(host) }, t('action.remove')),
        ]),
      ])
    }

    /**
     * The settings section. Everything it renders is derived from `describe()` plus the local host
     * index; no secret is ever read back.
     * @param props - `{ t, describe, set, unset }` provided by the registration's `inject`.
     */
    function GitCredentialsSection(props) {
      const { t, describe, set, unset } = props
      const [hosts, setHosts] = React.useState(readHosts)
      const [info, setInfo] = React.useState({})
      const [form, setForm] = React.useState({ host: '', username: '', password: '' })
      const [busy, setBusy] = React.useState(false)
      const [message, setMessage] = React.useState(null)

      /** Re-read every known host's status in one batched call. */
      const refresh = React.useCallback(async (list) => {
        if (list.length === 0) {
          setInfo({})
          return
        }
        try {
          setInfo(await describe(list.map(refForHost)))
        } catch (error) {
          setMessage({ kind: 'error', text: t('error.describe') + ' ' + String(error && error.message ? error.message : error) })
        }
      }, [describe, t])

      React.useEffect(() => { void refresh(hosts) }, [hosts, refresh])

      /** Save one host's credentials, remembering the host so the page can find it again. */
      const save = React.useCallback(async (host, username, password) => {
        if (host.trim() === '' || username === '' || password === '') {
          setMessage({ kind: 'error', text: t('error.incomplete') })
          return
        }
        setBusy(true)
        setMessage(null)
        try {
          await set(refForHost(host.trim()), `${username}:${password}`)
          const next = hosts.includes(host.trim()) ? hosts : [...hosts, host.trim()]
          setHosts(next)
          writeHosts(next)
          await refresh(next)
          setMessage({ kind: 'ok', text: t('saved') })
        } catch (error) {
          setMessage({ kind: 'error', text: String(error && error.message ? error.message : error) })
        } finally {
          setBusy(false)
        }
      }, [hosts, refresh, set, t])

      return h('section', { className: 'git-cred-section' }, [
        h('h2', { key: 'title' }, t('title')),
        h('p', { className: 'git-cred-hint', key: 'hint' }, t('hint')),
        h('p', { className: 'git-cred-hint', key: 'format' }, t('format')),
        h('div', { className: 'git-cred-form', key: 'form' }, [
          h('input', {
            key: 'host', placeholder: t('field.host'), value: form.host, disabled: busy,
            onChange: event => setForm({ ...form, host: event.target.value }),
          }),
          h('input', {
            key: 'user', placeholder: t('field.username'), value: form.username, disabled: busy,
            onChange: event => setForm({ ...form, username: event.target.value }),
          }),
          h('input', {
            key: 'pass', type: 'password', placeholder: t('field.password'), value: form.password, disabled: busy,
            onChange: event => setForm({ ...form, password: event.target.value }),
          }),
          h('button', {
            key: 'save', type: 'button', disabled: busy,
            onClick: async () => {
              await save(form.host, form.username, form.password)
              setForm({ host: '', username: '', password: '' })
            },
          }, t('action.save')),
        ]),
        message === null ? null : h('p', { className: `git-cred-msg git-cred-${message.kind}`, key: 'msg' }, message.text),
        hosts.length === 0
          ? h('p', { className: 'git-cred-hint', key: 'empty' }, t('empty'))
          : h('div', { className: 'git-cred-list', key: 'list' }, hosts.map(host => h(HostRow, {
            key: host,
            host,
            info: info[refForHost(host)],
            busy,
            t,
            onRemove: async (target) => {
              setBusy(true)
              setMessage(null)
              try {
                await unset(refForHost(target))
                const next = hosts.filter(entry => entry !== target)
                setHosts(next)
                writeHosts(next)
                await refresh(next)
                setMessage({ kind: 'ok', text: t('removed') })
              } catch (error) {
                setMessage({ kind: 'error', text: String(error && error.message ? error.message : error) })
              } finally {
                setBusy(false)
              }
            },
            onUpdate: (target) => setForm({ host: target, username: '', password: '' }),
          }))),
        h('p', { className: 'git-cred-limit', key: 'limit' }, t('limit')),
      ])
    }

    return {
      inject: ['slots', 'locale', 'remote', 'remote.credentials'],

      apply(ctx) {
        ctx.effect(() => {
          const disposers = []
          const dictionaries = [
            ['zh', {
              'nav': 'Git 凭据',
              'title': 'Git 凭据',
              'hint': '带账号的 Git 远端在需要认证时会读取这里保存的用户名与密码。明文只保存在本机凭据库中，不会写入配置、对话或日志。',
              'format': '存储名由主机名推导：host[:port] 大写、非字母数字替换为 _，例如 git.example.com:8443 → GIT_CREDENTIAL_GIT_EXAMPLE_COM_8443；值为「用户名:密码」（按第一个冒号切分）。',
              'field.host': '主机（如 git.example.com:8443）',
              'field.username': '用户名',
              'field.password': '密码',
              'action.save': '保存',
              'action.update': '更新',
              'action.remove': '删除',
              'state.configured': '已配置',
              'state.readonly': '只读来源',
              'state.absent': '未配置',
              'state.unknown': '状态未知',
              'saved': '已保存。',
              'removed': '已删除。',
              'empty': '还没有记录任何主机。填入主机、用户名与密码后保存即可。',
              'error.incomplete': '请填写主机、用户名与密码。',
              'error.describe': '读取凭据状态失败：',
              'limit': '注意：凭据接口不提供枚举能力，因此直接写入 .credentials.yaml 的主机不会自动出现在此列表。另外，明文 http:// 远端会让凭据以 Base64 明文过网，生产环境请使用 https://。',
            }],
            ['en', {
              'nav': 'Git credentials',
              'title': 'Git credentials',
              'hint': 'Authenticated Git remotes read the username and password stored here. The cleartext lives only in the local credential store — never in configuration, conversations or logs.',
              'format': 'The stored name is derived from the host: host[:port] upper-cased with non-alphanumerics replaced by _, e.g. git.example.com:8443 → GIT_CREDENTIAL_GIT_EXAMPLE_COM_8443. The value is "username:password", split on the first colon.',
              'field.host': 'Host (e.g. git.example.com:8443)',
              'field.username': 'Username',
              'field.password': 'Password',
              'action.save': 'Save',
              'action.update': 'Update',
              'action.remove': 'Remove',
              'state.configured': 'Configured',
              'state.readonly': 'Read-only source',
              'state.absent': 'Not configured',
              'state.unknown': 'Unknown',
              'saved': 'Saved.',
              'removed': 'Removed.',
              'empty': 'No host recorded yet. Enter a host, username and password, then save.',
              'error.incomplete': 'Host, username and password are all required.',
              'error.describe': 'Could not read credential status: ',
              'limit': 'Note: the credential API cannot enumerate references, so hosts written directly into .credentials.yaml do not appear here. Also, a plaintext http:// remote sends the credential as Base64 in the clear — use https:// in production.',
            }],
          ]
          try {
            for (const [locale, dict] of dictionaries) disposers.push(ctx.locale.register(LOCALE_NS, locale, dict))
          } catch (error) {
            for (const dispose of disposers.reverse()) dispose()
            throw error
          }
          return () => { for (const dispose of disposers) dispose() }
        }, 'git-credentials: dictionaries')

        const t = ctx.locale.bind(LOCALE_NS)

        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'git-credentials',
          order: 40,
          label: () => t('nav'),
          locale: LOCALE_NS,
          inject: () => ({
            t,
            describe: refs => ctx.remote.credentials.describe(refs),
            set: (ref, value) => ctx.remote.credentials.set(ref, value),
            unset: ref => ctx.remote.credentials.unset(ref),
          }),
        }, GitCredentialsSection))
      },
    }
  },
})
