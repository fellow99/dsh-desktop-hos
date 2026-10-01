/**
 * Client half of harmony-plugin-workspace-picker. Lazy-CJS factory: script
 * execution only registers the factory; every side effect (style injection,
 * slot/locale registration) runs inside the factory closure.
 *
 * The factory's `require` is the loader module table and shadows the
 * renderer's native node require, and it cannot resolve `electron`. Capture
 * the native require before registration so the bridge can reach
 * `ipcRenderer` (nodeIntegration is enabled in the renderer).
 */
const nodeRequire = typeof require === 'function' ? require : null

window.__ModuleLoader__.load({
  id: 'harmony-plugin-workspace-picker',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const LOCALE_NS = 'workspacePicker'
    const ROOT_STORAGE_KEY = 'wpk.lastRoot'
    const ROOT_IDS = ['sandbox', 'desktop', 'documents', 'download']
    const PERMISSION_TYPE = {
      desktop: 'directory_desktop',
      documents: 'directory_document',
      download: 'directory_download',
    }
    const CHANNELS = {
      root: 'harmony-plugin-workspace-picker:root',
      check: 'harmony-plugin-workspace-picker:permission-check',
      request: 'harmony-plugin-workspace-picker:permission-request',
      appInfo: 'harmony-plugin-workspace-picker:open-app-info',
    }

    function ipcRenderer() {
      if (nodeRequire === null) return null
      try {
        return nodeRequire('electron').ipcRenderer
      } catch (error) {
        return null
      }
    }

    function invoke(channel, ...args) {
      const renderer = ipcRenderer()
      if (renderer === null || typeof renderer.invoke !== 'function') {
        const error = new Error('native capability bridge is not reachable')
        error.code = 'bridge-unavailable'
        return Promise.reject(error)
      }
      return renderer.invoke(channel, ...args)
    }

    const bridge = {
      resolveRoot(rootId) {
        return invoke(CHANNELS.root, rootId)
      },
      checkPermission(type) {
        return invoke(CHANNELS.check, type)
      },
      requestPermission(type) {
        return invoke(CHANNELS.request, type)
      },
      openAppInfo() {
        return invoke(CHANNELS.appInfo)
      },
    }

    function joinPath(parent, name) {
      return parent.replace(/\/+$/, '') + '/' + name
    }

    function isPermissionError(error) {
      const code = error && error.code
      if (code === 'EACCES' || code === 'EPERM') return true
      // The wire code 'directory-picker/unreadable' names every unreadable
      // cause, not only a permission refusal, so the refusal is distinguished
      // by the host message (`cannot list <path>: EACCES: permission denied`).
      const message = String(error && error.message)
      return /EACCES|EPERM|permission denied|not permitted/i.test(message)
    }

    function readStoredRoot() {
      try {
        const value = window.localStorage.getItem(ROOT_STORAGE_KEY)
        return ROOT_IDS.includes(value) ? value : 'sandbox'
      } catch (error) {
        return 'sandbox'
      }
    }

    function storeRoot(rootId) {
      try {
        window.localStorage.setItem(ROOT_STORAGE_KEY, rootId)
      } catch (error) {
        /* storage unavailable: selection still works for the session */
      }
    }

    const stylesheet = [
      '.wpk-overlay{position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:1000}',
      '.wpk-dialog{width:680px;max-width:94vw;height:500px;max-height:92vh;display:flex;flex-direction:column;border-radius:12px;overflow:hidden;background:var(--dsw-color-bg, #fff);color:var(--dsw-color-text, #1a1a1a);box-shadow:0 12px 40px rgba(0,0,0,.25);font-size:14px}',
      '.wpk-tabs{display:flex;padding:8px 8px 0;background:var(--dsw-color-bg, #fff);border-bottom:1px solid var(--dsw-color-border, #e5e5e5)}',
      '.wpk-tab{appearance:none;border:none;background:transparent;padding:8px 14px;border-radius:8px 8px 0 0;cursor:pointer;color:var(--dsw-color-text-secondary,#666);font-size:14px}',
      '.wpk-tab[aria-selected="true"]{background:var(--dsw-color-accent-bg,#eef2ff);color:var(--dsw-color-accent,#3b4bd6)}',
      '.wpk-crumbs{display:flex;align-items:center;gap:4px;padding:8px 14px;font-size:13px;color:var(--dsw-color-text-secondary,#666);border-bottom:1px solid var(--dsw-color-border,#eee)}',
      '.wpk-crumb{appearance:none;border:none;background:transparent;cursor:pointer;color:inherit;padding:2px 4px;border-radius:4px}',
      '.wpk-crumb:last-child{color:var(--dsw-color-text,#1a1a1a);cursor:default}',
      '.wpk-body{flex:1;display:flex;overflow-x:auto;overflow-y:hidden;background:var(--dsw-color-bg,#fff)}',
      '.wpk-col{flex:0 0 240px;display:flex;flex-direction:column;border-right:1px solid var(--dsw-color-border,#eee);min-height:0}',
      '.wpk-col:only-child,.wpk-col.last-auto{flex:1 1 auto}',
      '.wpk-row{appearance:none;border:none;background:transparent;text-align:left;width:100%;padding:9px 14px;cursor:pointer;color:var(--dsw-color-text,#1a1a1a);display:flex;gap:8px;align-items:center}',
      '.wpk-row[aria-selected="true"]{background:var(--dsw-color-accent-bg,#eef2ff)}',
      '.wpk-col-note{padding:10px 14px;color:var(--dsw-color-text-secondary,#777);font-size:12px}',
      '.wpk-col-msg{margin:auto;padding:24px;text-align:center;color:var(--dsw-color-text-secondary,#777);display:flex;flex-direction:column;gap:12px;align-items:center}',
      '.wpk-footer{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:12px 14px;border-top:1px solid var(--dsw-color-border,#e5e5e5)}',
      '.wpk-btn{appearance:none;border:1px solid var(--dsw-color-border,#d5d5d5);background:var(--dsw-color-bg,#fff);color:var(--dsw-color-text,#1a1a1a);padding:7px 16px;border-radius:8px;cursor:pointer;font-size:14px}',
      '.wpk-btn.primary{background:var(--dsw-color-accent,#3b4bd6);border-color:var(--dsw-color-accent,#3b4bd6);color:#fff}',
      '.wpk-btn:disabled{opacity:.5;cursor:not-allowed}',
      '.wpk-spacer{flex:1}',
      '.wpk-modal-shade{position:absolute;inset:0;background:rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center}',
      '.wpk-modal{width:380px;max-width:90%;background:var(--dsw-color-bg,#fff);border-radius:12px;padding:18px;display:flex;flex-direction:column;gap:14px;box-shadow:0 8px 30px rgba(0,0,0,.2)}',
      '.wpk-modal-title{font-size:15px;font-weight:600}',
      '.wpk-input{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--dsw-color-border,#ccc);border-radius:8px;font-size:14px;background:var(--dsw-color-bg,#fff);color:var(--dsw-color-text,#1a1a1a)}',
      '.wpk-field-error{color:var(--dsw-color-danger,#c0392b);font-size:12px}',
      '.wpk-modal-actions{display:flex;justify-content:flex-end;gap:8px}',
    ].join('\n')

    const styleTag = document.createElement('style')
    styleTag.dataset.plugin = 'harmony-plugin-workspace-picker'
    styleTag.textContent = stylesheet
    document.head.append(styleTag)

    function RootTabs({ rootId, t, onSelect }) {
      return h('div', { className: 'wpk-tabs', role: 'tablist' },
        ROOT_IDS.map((id) =>
          h('button', {
            key: id,
            type: 'button',
            role: 'tab',
            className: 'wpk-tab',
            'aria-selected': id === rootId,
            onClick: () => onSelect(id),
          }, t('root.' + id)),
        ),
      )
    }

    function Breadcrumb({ labels, onJump }) {
      return h('div', { className: 'wpk-crumbs' },
        labels.map((label, index) =>
          h(React.Fragment, { key: index },
            index > 0 ? h('span', null, '/') : null,
            h('button', {
              type: 'button',
              className: 'wpk-crumb',
              onClick: () => onJump(index),
              disabled: index === labels.length - 1,
            }, label),
          ),
        ),
      )
    }

    function ColumnMessage({ text, actions }) {
      return h('div', { className: 'wpk-col-msg' },
        h('div', null, text),
        h('div', { style: { display: 'flex', gap: 8 } }, actions),
      )
    }

    function Column({ column, selected, t, onSelect, onRequest, onRetry, onOpenSettings }) {
      if (column.status === 'loading') {
        return h('div', { className: 'wpk-col' },
          h('div', { className: 'wpk-col-msg' }, t('loading')))
      }
      if (column.status === 'denied') {
        return h('div', { className: 'wpk-col' },
          h(ColumnMessage, {
            text: t('perm.denied'),
            actions: [
              h('button', {
                key: 'request', type: 'button', className: 'wpk-btn primary',
                onClick: () => onRequest(),
              }, column.requesting ? t('perm.requesting') : t('perm.request')),
              h('button', {
                key: 'settings', type: 'button', className: 'wpk-btn',
                onClick: () => onOpenSettings(),
              }, t('perm.settings')),
            ],
          }))
      }
      if (column.status === 'error') {
        return h('div', { className: 'wpk-col' },
          h(ColumnMessage, {
            text: t('unreadable'),
            actions: [
              h('button', {
                key: 'retry', type: 'button', className: 'wpk-btn',
                onClick: () => onRetry(),
              }, t('retry')),
            ],
          }))
      }
      return h('div', { className: 'wpk-col' },
        column.entries.length === 0
          ? h('div', { className: 'wpk-col-msg' }, t('empty'))
          : column.entries.map((entry) =>
            h('button', {
              key: entry.path,
              type: 'button',
              className: 'wpk-row',
              'aria-selected': selected === entry.name,
              onClick: () => onSelect(entry.name),
            }, h('span', { 'aria-hidden': true }, '📁'), entry.name),
          ),
        column.truncated
          ? h('div', { className: 'wpk-col-note' }, t('truncated'))
          : null,
      )
    }

    function NewFolderModal({ defaultValue, t, onCreate, onCancel }) {
      const [name, setName] = React.useState(defaultValue)
      const [error, setError] = React.useState(null)
      const [pending, setPending] = React.useState(false)

      async function submit() {
        if (name.trim() === '') {
          setError(t('modal.nameRequired'))
          return
        }
        setPending(true)
        setError(null)
        try {
          await onCreate(name.trim())
        } catch (error) {
          const exists = error && (error.code === 'directory-picker/exists' || /already exists/i.test(String(error.message)))
          setError(exists ? t('modal.exists') : t('modal.failed'))
          setPending(false)
        }
      }

      return h('div', { className: 'wpk-modal-shade' },
        h('div', { className: 'wpk-modal', role: 'dialog', 'aria-modal': true },
          h('div', { className: 'wpk-modal-title' }, t('modal.title')),
          h('input', {
            className: 'wpk-input',
            value: name,
            autoFocus: true,
            onChange: (event) => setName(event.target.value),
            onKeyDown: (event) => { if (event.key === 'Enter') submit() },
          }),
          error ? h('div', { className: 'wpk-field-error' }, error) : null,
          h('div', { className: 'wpk-modal-actions' },
            h('button', { type: 'button', className: 'wpk-btn', onClick: onCancel, disabled: pending }, t('cancel')),
            h('button', { type: 'button', className: 'wpk-btn primary', onClick: submit, disabled: pending }, t('create')),
          ),
        ),
      )
    }

    function defaultFolderName(t, entries) {
      const base = t('untitled')
      const names = new Set(entries.map((entry) => entry.name))
      if (!names.has(base)) return base
      for (let i = 2; ; i++) {
        const candidate = `${base} ${i}`
        if (!names.has(candidate)) return candidate
      }
    }

    function WorkspacePickerFlow(props) {
      const { open } = props
      const t = props.t
      const [rootId, setRootId] = React.useState(readStoredRoot)
      const [rootPath, setRootPath] = React.useState(null)
      const [columns, setColumns] = React.useState([])
      const [selected, setSelected] = React.useState([])
      const [rootError, setRootError] = React.useState(false)
      const [modalOpen, setModalOpen] = React.useState(false)
      const generation = React.useRef(0)

      async function loadInto(path, index, g, rid, attempt = 0) {
        setColumns((prev) => {
          const next = prev.slice(0, index)
          next[index] = { path, status: 'loading' }
          return next
        })
        try {
          const listing = await props.listDirectory(path)
          if (generation.current !== g) return
          const entries = listing.entries.filter((entry) => !entry.hidden)
          setColumns((prev) => {
            const next = prev.slice(0, index)
            next[index] = { path, status: 'ready', entries, truncated: listing.truncated === true }
            return next
          })
        } catch (error) {
          if (generation.current !== g) return
          // rid is threaded explicitly: the rootId state closure still names the
          // previous root until re-render, so reading it here would classify
          // against the wrong permission (or as undefined after the sandbox).
          const permissionType = PERMISSION_TYPE[rid]
          if (permissionType && isPermissionError(error)) {
            let granted = false
            try {
              granted = await bridge.checkPermission(permissionType) === true
            } catch (checkError) {
              granted = false
            }
            if (generation.current !== g) return
            // Retry at most once: a granted check that still fails to list (the
            // check bridge and the fs refusal can disagree) must not recurse
            // forever on the same generation.
            if (granted && attempt === 0) {
              await loadInto(path, index, g, rid, 1)
              return
            }
            if (granted) {
              setColumns((prev) => {
                const next = prev.slice(0, index)
                next[index] = { path, status: 'error' }
                return next
              })
              return
            }
            setColumns((prev) => {
              const next = prev.slice(0, index)
              next[index] = { path, status: 'denied', requesting: false, permType: permissionType }
              return next
            })
          } else {
            setColumns((prev) => {
              const next = prev.slice(0, index)
              next[index] = { path, status: 'error' }
              return next
            })
          }
        }
      }

      async function startRoot(rid) {
        const g = ++generation.current
        setRootError(false)
        setRootPath(null)
        setColumns([])
        setSelected([])
        let path
        try {
          path = await bridge.resolveRoot(rid)
        } catch (error) {
          if (generation.current === g) setRootError(true)
          return
        }
        if (generation.current !== g) return
        setRootPath(path)
        setSelected([null])
        await loadInto(path, 0, g, rid)
      }

      React.useEffect(() => {
        if (open) {
          // Re-read on every open: useState(readStoredRoot) only runs at mount,
          // so using the mount-time rootId would ignore a root chosen (or a
          // value changed) after mount and always reopen on the stale root.
          const rid = readStoredRoot()
          setRootId(rid)
          void startRoot(rid)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [open])

      function selectRoot(rid) {
        setRootId(rid)
        storeRoot(rid)
        if (open) void startRoot(rid)
      }

      function selectEntry(index, name) {
        const g = ++generation.current
        setSelected((prev) => {
          const next = prev.slice(0, index)
          next[index] = name
          next[index + 1] = null
          return next
        })
        void loadInto(joinPath(columns[index].path, name), index + 1, g, rootId)
      }

      function jumpCrumb(index) {
        generation.current++
        setSelected((prev) => {
          const next = prev.slice(0, index)
          next[index] = null
          return next
        })
        setColumns((prev) => prev.slice(0, index + 1))
      }

      async function requestPermissionFor(index) {
        // Snapshot the column before awaiting and guard on a fresh generation:
        // a root switch or crumb jump while the request is in flight would
        // otherwise read/write a column that no longer exists.
        const g = ++generation.current
        const column = columns[index]
        if (!column) return
        const permissionType = column.permType || PERMISSION_TYPE[rootId]
        const targetPath = column.path
        setColumns((prev) => {
          if (generation.current !== g) return prev
          const next = prev.slice()
          next[index] = { ...next[index], status: 'denied', requesting: true }
          return next
        })
        let code = -1
        try {
          code = Number(await bridge.requestPermission(permissionType))
        } catch (error) {
          code = -1
        }
        if (generation.current !== g) return
        if (code === 0) {
          await loadInto(targetPath, index, g, rootId)
        } else {
          setColumns((prev) => {
            if (generation.current !== g) return prev
            const next = prev.slice()
            next[index] = { ...next[index], status: 'denied', requesting: false }
            return next
          })
        }
      }

      function retryColumn(index) {
        const g = ++generation.current
        void loadInto(columns[index].path, index, g, rootId)
      }

      function crumbLabels() {
        if (rootPath === null || columns.length === 0) return []
        const deep = columns[columns.length - 1].path
        const rel = deep.slice(rootPath.length).replace(/^\/+/, '')
        const segments = rel.length > 0 ? rel.split('/') : []
        return [t('root.' + rootId), ...segments]
      }

      async function createFolder(name) {
        const index = columns.length - 1
        const targetPath = columns[index].path
        // Mint the generation before the first await so a root switch or crumb
        // jump during create/relist cannot splice this root's column into a
        // different root's picker.
        const g = ++generation.current
        await props.createDirectory(targetPath, name)
        if (generation.current !== g) return
        const listing = await props.listDirectory(targetPath)
        if (generation.current !== g) return
        const entries = listing.entries.filter((entry) => !entry.hidden)
        setColumns((prev) => {
          const next = prev.slice(0, index + 1)
          next[index] = { path: targetPath, status: 'ready', entries, truncated: listing.truncated === true }
          return next
        })
        setSelected((prev) => {
          const next = prev.slice(0, index)
          next[index] = name
          next[index + 1] = null
          return next
        })
        setModalOpen(false)
        await loadInto(joinPath(targetPath, name), index + 1, g, rootId)
      }

      if (!open) return null

      const lastColumn = columns[columns.length - 1]
      const canConfirm = !!lastColumn && lastColumn.status === 'ready'

      return h('div', { className: 'wpk-overlay', role: 'presentation' },
        h('div', { className: 'wpk-dialog', role: 'dialog', 'aria-modal': true, 'aria-label': t('title') },
          h(RootTabs, { rootId, t, onSelect: selectRoot }),
          rootError
            ? h('div', { className: 'wpk-body' },
              h(ColumnMessage, {
                text: t('rootUnavailable'),
                actions: [
                  h('button', {
                    key: 'retry', type: 'button', className: 'wpk-btn primary',
                    onClick: () => void startRoot(rootId),
                  }, t('retry')),
                ],
              }))
            : h(React.Fragment, null,
              h(Breadcrumb, { labels: crumbLabels(), onJump: jumpCrumb }),
              h('div', { className: 'wpk-body' },
                columns.map((column, index) =>
                  h(Column, {
                    key: column.path,
                    column,
                    selected: selected[index] ?? null,
                    t,
                    onSelect: (name) => selectEntry(index, name),
                    onRequest: () => void requestPermissionFor(index),
                    onRetry: () => retryColumn(index),
                    onOpenSettings: () => bridge.openAppInfo(),
                  }),
                ),
              ),
            ),
          h('div', { className: 'wpk-footer' },
            h('button', {
              type: 'button', className: 'wpk-btn',
              onClick: () => setModalOpen(true),
              disabled: rootError || !canConfirm || props.busy,
            }, t('newFolder')),
            h('div', { className: 'wpk-spacer' }),
            h('button', { type: 'button', className: 'wpk-btn', onClick: props.onCancel, disabled: props.busy }, t('cancel')),
            h('button', {
              type: 'button', className: 'wpk-btn primary',
              onClick: () => props.onPicked(lastColumn.path),
              disabled: !canConfirm || props.busy,
            }, t('open')),
          ),
          modalOpen && lastColumn && lastColumn.status === 'ready'
            ? h(NewFolderModal, {
              defaultValue: defaultFolderName(t, lastColumn.entries),
              t,
              onCreate: createFolder,
              onCancel: () => setModalOpen(false),
            })
            : null,
        ),
      )
    }

    return {
      inject: ['slots', 'uiWorkspace', 'locale'],

      apply(ctx) {
        ctx.effect(() => {
          const disposers = []
          const dictionaries = [
            ['zh', {
              'title': '选择工作区目录',
              'root.sandbox': '沙箱',
              'root.desktop': '桌面',
              'root.documents': '文档',
              'root.download': '下载',
              'newFolder': '新建文件夹',
              'untitled': '未命名文件夹',
              'create': '创建',
              'cancel': '取消',
              'open': '打开',
              'loading': '加载中…',
              'empty': '空文件夹',
              'unreadable': '无法读取该文件夹',
              'retry': '重试',
              'truncated': '文件夹过多，仅显示开头部分。',
              'rootUnavailable': '该主目录当前不可用。',
              'perm.request': '请求授权',
              'perm.requesting': '正在请求…',
              'perm.denied': '需要授权才能访问此文件夹。',
              'perm.settings': '去系统设置',
              'modal.title': '新建文件夹',
              'modal.nameRequired': '请输入文件夹名称',
              'modal.exists': '同名文件夹已存在',
              'modal.failed': '创建失败，请重试',
            }],
            ['en', {
              'title': 'Select Workspace Directory',
              'root.sandbox': 'Sandbox',
              'root.desktop': 'Desktop',
              'root.documents': 'Documents',
              'root.download': 'Download',
              'newFolder': 'New folder',
              'untitled': 'Untitled folder',
              'create': 'Create',
              'cancel': 'Cancel',
              'open': 'Open',
              'loading': 'Loading…',
              'empty': 'Empty folder',
              'unreadable': 'This folder cannot be read',
              'retry': 'Retry',
              'truncated': 'Too many folders to list; only the beginning is shown.',
              'rootUnavailable': 'This root is currently unavailable.',
              'perm.request': 'Request access',
              'perm.requesting': 'Requesting…',
              'perm.denied': 'Permission is required to open this folder.',
              'perm.settings': 'Open system settings',
              'modal.title': 'New folder',
              'modal.nameRequired': 'Enter a folder name',
              'modal.exists': 'A folder with this name already exists',
              'modal.failed': 'Could not create the folder; try again',
            }],
          ]
          try {
            for (const [locale, dict] of dictionaries) disposers.push(ctx.locale.register(LOCALE_NS, locale, dict))
          } catch (error) {
            for (const dispose of disposers.reverse()) dispose()
            throw error
          }
          return () => { for (const dispose of disposers) dispose() }
        }, 'workspace-picker: dictionaries')

        const injected = () => ({
          listDirectory: (path, signal) => ctx.uiWorkspace.listDirectory(path, signal),
          createDirectory: (path, name) => ctx.uiWorkspace.createDirectory(path, name),
          t: ctx.locale.bind(LOCALE_NS),
        })

        ctx.slots.inject('conversation.hero.workspace.directoryFlow', () =>
          ctx.slots.inject('sidebar.workspaces.directoryFlow', function* () {
            yield ctx.slots.register({
              name: 'conversation.hero.workspace.directoryFlow', inject: injected,
            }, WorkspacePickerFlow)
            yield ctx.slots.register({
              name: 'sidebar.workspaces.directoryFlow', inject: injected,
            }, WorkspacePickerFlow)
          }))
      },
    }
  },
})
