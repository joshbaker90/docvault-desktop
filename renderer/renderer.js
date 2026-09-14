let cfg = {}
let currentPath = ''
let editingBookmarkId = null
let confirmCallback = null

const TAB_TITLES = { docs: 'Documents', bookmarks: 'Bookmarks', clips: 'Clips', settings: 'Settings' }

const P = {
  FOLDER:   'M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z',
  DOC:      'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z',
  OPEN:     'M19 19H5V5h7V3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z',
  TRASH:    'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
  EDIT:     'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
  COPY:     'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z',
  BOOKMARK: 'M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z'
}

function mkSvg(path, size = 15) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor"><path d="${path}"/></svg>`
}

function mkIaBtn(cls, title, path) {
  return `<button class="ia-btn ${cls}" title="${title}">${mkSvg(path)}</button>`
}

// ── Init ─────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  const locked = await window.api.lock.isEnabled()
  if (locked) {
    await showLockScreen()
  } else {
    await initApp()
  }
})

async function initApp() {
  cfg = await window.api.config.get()
  window.api.app.version().then(v => {
    const el = document.getElementById('app-version-line')
    if (el) el.textContent = `DocVault Desktop v${v}`
  })
  loadSettingsForm()
  await loadBookmarks()
  await loadClips()
  if (cfg.hetznerPassword) loadFileList(currentPath)

  // Sidebar nav
  document.querySelectorAll('.nav-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab))
  })

  // Topbar
  document.getElementById('sync-btn').addEventListener('click', runSync)

  // Docs
  document.getElementById('add-files-btn').addEventListener('click', addFiles)
  document.getElementById('breadcrumb').addEventListener('click', e => {
    const item = e.target.closest('.bc-item:not(.current)')
    if (item) navigateTo(item.dataset.path)
  })

  // Bookmarks
  document.getElementById('add-bookmark-btn').addEventListener('click', showAddBookmark)
  document.getElementById('bm-cancel').addEventListener('click', closeBookmarkModal)
  document.getElementById('bm-save').addEventListener('click', saveBookmark)

  // Clips
  document.getElementById('add-clip-btn').addEventListener('click', showAddClip)
  document.getElementById('clip-cancel').addEventListener('click', closeClipModal)
  document.getElementById('clip-save').addEventListener('click', saveClip)

  // Settings
  document.getElementById('save-settings-btn').addEventListener('click', saveSettings)
  document.getElementById('test-connection-btn').addEventListener('click', testConnection)
  document.getElementById('reset-resync-btn').addEventListener('click', resetResync)
  document.getElementById('view-log-btn').addEventListener('click', viewSyncLog)
  document.getElementById('s-sync-enabled').addEventListener('change', e => {
    document.getElementById('s-interval-group').style.display = e.target.checked ? '' : 'none'
  })
  document.getElementById('s-lock-enabled').addEventListener('change', e => {
    if (e.target.checked) showPinModal('set')
    else disableLock()
  })
  document.getElementById('change-pin-btn').addEventListener('click', () => showPinModal('change'))
  document.getElementById('pin-cancel').addEventListener('click', closePinModal)
  document.getElementById('pin-save').addEventListener('click', savePinModal)

  // Auto-sync background notification
  window.api.sync.onAutoDone(result => {
    document.getElementById('sync-status').textContent = result.summary || 'Auto-synced'
    loadFileList(currentPath)
    loadBookmarks()
    loadClips()
  })

  // Confirm
  document.getElementById('confirm-cancel').addEventListener('click', closeConfirm)

  // Keyboard
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeBookmarkModal(); closeClipModal(); closeConfirm(); closePinModal() }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      if (document.getElementById('bookmark-modal').classList.contains('show')) saveBookmark()
      if (document.getElementById('clip-modal').classList.contains('show')) saveClip()
      if (document.getElementById('pin-modal').classList.contains('show')) savePinModal()
    }
  })
}

// ── Tabs ─────────────────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'))
  document.querySelectorAll('.nav-btn[data-tab]').forEach(b => b.classList.remove('active'))
  document.getElementById('panel-' + name).classList.add('active')
  document.querySelector(`.nav-btn[data-tab="${name}"]`).classList.add('active')
  document.getElementById('topbar-title').textContent = TAB_TITLES[name] || name
  if (name === 'docs' && cfg.hetznerPassword) loadFileList(currentPath)
}

// ── Sync ─────────────────────────────────────────────────────────────────
async function runSync() {
  if (!cfg.hetznerPassword) { switchTab('settings'); toast('Enter your Hetzner credentials first'); return }
  const btn = document.getElementById('sync-btn')
  const status = document.getElementById('sync-status')
  btn.disabled = true
  btn.classList.add('syncing')
  status.textContent = 'Syncing…'
  try {
    const result = await window.api.sync.run(cfg)
    status.textContent = result.summary || 'Up to date'
    toast(result.summary || 'Sync complete')
    await loadFileList(currentPath)
    await loadBookmarks()
    await loadClips()
  } catch (e) {
    status.textContent = 'Sync failed'
    toast(`Sync failed: ${e.message}`)
  } finally {
    btn.disabled = false
    btn.classList.remove('syncing')
  }
}

// ── Documents ─────────────────────────────────────────────────────────────
async function loadFileList(remotePath) {
  const base = basePath()
  const fullPath = remotePath ? `${base}/${remotePath}/` : `${base}/`
  const list = document.getElementById('file-list')
  list.innerHTML = '<div class="empty-state"><p>Loading…</p></div>'
  try {
    const entries = await window.api.files.list(cfg, fullPath)
    renderFileList(entries, remotePath, base)
  } catch (e) {
    list.innerHTML = `<div class="empty-state"><p style="color:#DC2626">Failed: ${esc(e.message)}</p></div>`
  }
}

function renderFileList(entries, remotePath, base) {
  // Breadcrumb
  const bc = document.getElementById('breadcrumb')
  bc.innerHTML = ''
  const home = el('span', { className: 'bc-item' + (!remotePath ? ' current' : ''), 'data-path': '' }, 'Home')
  bc.appendChild(home)
  if (remotePath) {
    remotePath.split('/').forEach((part, i, arr) => {
      const sep = el('span', { className: 'bc-sep' }, '/')
      bc.appendChild(sep)
      const isCurrent = i === arr.length - 1
      const span = el('span', {
        className: 'bc-item' + (isCurrent ? ' current' : ''),
        'data-path': arr.slice(0, i + 1).join('/')
      }, part)
      bc.appendChild(span)
    })
  }

  const list = document.getElementById('file-list')
  if (!entries || entries.length === 0) {
    list.innerHTML = `<div class="empty-state">${mkSvg(P.FOLDER, 40)}<p>This folder is empty</p></div>`
    return
  }
  list.innerHTML = ''

  const dirs  = entries.filter(e => e.isDir).sort(byName)
  const files = entries.filter(e => !e.isDir && !e.name.startsWith('.')).sort(byName)

  for (const dir of dirs) {
    const childPath = remotePath ? `${remotePath}/${dir.name}` : dir.name
    const row = el('div', { className: 'file-item' })
    row.innerHTML = `
      <span class="fi-icon">📁</span>
      <span class="fi-name">${esc(dir.name)}</span>
      <div class="fi-actions">${mkIaBtn('danger', 'Delete', P.TRASH)}</div>`
    row.addEventListener('click', () => navigateTo(childPath))
    row.querySelector('.ia-btn').addEventListener('click', e => { e.stopPropagation(); deleteEntry(`${base}/${childPath}`, childPath) })
    list.appendChild(row)
  }

  for (const file of files) {
    const relPath   = remotePath ? `${remotePath}/${file.name}` : file.name
    const remoteFull = `${base}/${relPath}`
    const row = el('div', { className: 'file-item' })
    row.innerHTML = `
      <span class="fi-icon">${fileIcon(file.name)}</span>
      <span class="fi-name">${esc(file.name)}</span>
      <span class="fi-meta">${formatSize(file.size)}</span>
      <div class="fi-actions">
        ${mkIaBtn('', 'Open', P.OPEN)}
        ${mkIaBtn('danger', 'Delete', P.TRASH)}
      </div>`
    const [openBtn, delBtn] = row.querySelectorAll('.ia-btn')
    row.addEventListener('click', () => openFile(remoteFull, file.name))
    openBtn.addEventListener('click', e => { e.stopPropagation(); openFile(remoteFull, file.name) })
    delBtn.addEventListener('click',  e => { e.stopPropagation(); deleteEntry(remoteFull, relPath) })
    list.appendChild(row)
  }
}

function navigateTo(path) { currentPath = path; loadFileList(path) }

async function openFile(remotePath, name) {
  toast(`Opening ${name}…`)
  if (!await window.api.files.open(cfg, remotePath, name)) toast(`Failed to open ${name}`)
}

async function addFiles() {
  if (!cfg.hetznerPassword) { switchTab('settings'); toast('Enter credentials first'); return }
  const base = basePath()
  const remote = currentPath ? `${base}/${currentPath}/` : `${base}/`
  const result = await window.api.files.upload(cfg, remote)
  if (result.uploaded > 0) {
    toast(`${result.uploaded} file${result.uploaded !== 1 ? 's' : ''} uploaded`)
    await loadFileList(currentPath)
  }
}

async function deleteEntry(remotePath, relPath) {
  showConfirm(`Delete "${relPath.split('/').pop()}"?`, async () => {
    await window.api.files.delete(cfg, remotePath, relPath)
    toast('Deleted')
    await loadFileList(currentPath)
  })
}

// ── Bookmarks ─────────────────────────────────────────────────────────────
async function loadBookmarks() {
  renderBookmarks(await window.api.bookmarks.get())
}

function renderBookmarks(bookmarks) {
  const list = document.getElementById('bookmarks-list')
  if (!bookmarks.length) {
    list.innerHTML = `<div class="empty-state">${mkSvg(P.BOOKMARK, 40)}<p>No bookmarks yet</p><p class="sub">Tap "Add bookmark" to save a link</p></div>`
    return
  }
  list.innerHTML = ''
  for (const bm of bookmarks) {
    const row = el('div', { className: 'bm-item' })
    row.innerHTML = `
      <div class="bm-favicon">${mkSvg(P.BOOKMARK, 14)}</div>
      <div class="bm-info">
        <div class="bm-title">${esc(bm.title)}</div>
        <div class="bm-url">${esc(bm.url)}</div>
      </div>
      <div class="bm-actions">
        ${mkIaBtn('', 'Edit', P.EDIT)}
        ${mkIaBtn('danger', 'Delete', P.TRASH)}
      </div>`
    row.addEventListener('click', () => window.api.bookmarks.openUrl(bm.url))
    const [editBtn, delBtn] = row.querySelectorAll('.ia-btn')
    editBtn.addEventListener('click', e => { e.stopPropagation(); showEditBookmark(bm) })
    delBtn.addEventListener('click',  e => { e.stopPropagation(); deleteBookmark(bm.id, bm.title) })
    list.appendChild(row)
  }
}

function showAddBookmark() {
  editingBookmarkId = null
  document.getElementById('bm-modal-title').textContent = 'Add bookmark'
  document.getElementById('bm-title').value = ''
  document.getElementById('bm-url').value = ''
  document.getElementById('bookmark-modal').classList.add('show')
  setTimeout(() => document.getElementById('bm-title').focus(), 40)
}
function showEditBookmark(bm) {
  editingBookmarkId = bm.id
  document.getElementById('bm-modal-title').textContent = 'Edit bookmark'
  document.getElementById('bm-title').value = bm.title
  document.getElementById('bm-url').value   = bm.url
  document.getElementById('bookmark-modal').classList.add('show')
  setTimeout(() => document.getElementById('bm-title').focus(), 40)
}
function closeBookmarkModal() {
  document.getElementById('bookmark-modal').classList.remove('show')
  editingBookmarkId = null
}
async function saveBookmark() {
  const title = document.getElementById('bm-title').value.trim()
  let url     = document.getElementById('bm-url').value.trim()
  if (!title || !url) { toast('Title and URL are required'); return }
  if (!url.match(/^https?:\/\//)) url = 'https://' + url
  if (editingBookmarkId) {
    await window.api.bookmarks.update({ id: editingBookmarkId, title, url })
  } else {
    await window.api.bookmarks.add({ id: crypto.randomUUID(), title, url, addedAt: Date.now(), deletedAt: 0 })
  }
  closeBookmarkModal()
  await loadBookmarks()
  if (cfg.hetznerPassword) window.api.sync.run(cfg).then(() => loadBookmarks()).catch(() => {})
}
async function deleteBookmark(id, title) {
  showConfirm(`Delete "${title}"?`, async () => {
    await window.api.bookmarks.delete(id)
    await loadBookmarks()
    if (cfg.hetznerPassword) window.api.sync.run(cfg).then(() => loadBookmarks()).catch(() => {})
  })
}

// ── Clips ─────────────────────────────────────────────────────────────────
async function loadClips() {
  renderClips(await window.api.clips.get())
}

function renderClips(clips) {
  const list = document.getElementById('clips-list')
  if (!clips.length) {
    list.innerHTML = `<div class="empty-state">${mkSvg(P.COPY, 40)}<p>No clips yet</p><p class="sub">Add a clip to sync text between devices</p></div>`
    return
  }
  list.innerHTML = ''
  for (const clip of clips) {
    const row = el('div', { className: 'clip-item' })
    row.innerHTML = `
      <div class="clip-content">${esc(clip.content)}</div>
      <div class="clip-footer">
        <span class="clip-meta">${esc(clip.deviceName)} · ${fmtDate(clip.addedAt)}</span>
        <div class="clip-actions">
          ${mkIaBtn('', 'Copy', P.COPY)}
          ${mkIaBtn('danger', 'Delete', P.TRASH)}
        </div>
      </div>`
    const [copyBtn, delBtn] = row.querySelectorAll('.ia-btn')
    row.addEventListener('click', () => copyText(clip.content))
    copyBtn.addEventListener('click', e => { e.stopPropagation(); copyText(clip.content) })
    delBtn.addEventListener('click',  e => { e.stopPropagation(); deleteClip(clip.id) })
    list.appendChild(row)
  }
}

function copyText(text) { navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard')) }

function showAddClip() {
  navigator.clipboard.readText().then(t => document.getElementById('clip-text').value = t || '').catch(() => {})
  document.getElementById('clip-modal').classList.add('show')
  setTimeout(() => document.getElementById('clip-text').focus(), 40)
}
function closeClipModal() { document.getElementById('clip-modal').classList.remove('show') }
async function saveClip() {
  const text = document.getElementById('clip-text').value.trim()
  if (!text) { toast('Text is required'); return }
  await window.api.clips.add({ id: crypto.randomUUID(), content: text, deviceName: cfg.deviceName || 'desktop', addedAt: Date.now(), deletedAt: 0 })
  closeClipModal()
  await loadClips()
  if (cfg.hetznerPassword) window.api.sync.run(cfg).then(() => loadClips()).catch(() => {})
}
async function deleteClip(id) {
  showConfirm('Delete this clip?', async () => {
    await window.api.clips.delete(id)
    await loadClips()
    if (cfg.hetznerPassword) window.api.sync.run(cfg).then(() => loadClips()).catch(() => {})
  })
}

// ── Settings ─────────────────────────────────────────────────────────────
function loadSettingsForm() {
  document.getElementById('s-host').value        = cfg.hetznerHost          || ''
  document.getElementById('s-user').value        = cfg.hetznerUser          || ''
  document.getElementById('s-pass').value        = cfg.hetznerPassword      || ''
  document.getElementById('s-base').value        = cfg.hetznerBasePath      || '/docvault'
  document.getElementById('s-device').value      = cfg.deviceName           || ''
  document.getElementById('s-dir').value         = cfg.syncDirection        || 'both'
  document.getElementById('s-sync-enabled').checked = !!cfg.syncEnabled
  document.getElementById('s-interval').value   = String(cfg.syncIntervalMinutes || 60)
  document.getElementById('s-interval-group').style.display = cfg.syncEnabled ? '' : 'none'
  const locked = !!(cfg.lockEnabled && cfg.lockPinHash)
  document.getElementById('s-lock-enabled').checked  = locked
  document.getElementById('change-pin-btn').style.display = locked ? '' : 'none'
  document.getElementById('lock-status-text').textContent = locked
    ? 'PIN required on launch'
    : 'No lock — anyone can open the app'
}
async function saveSettings() {
  cfg = {
    ...cfg,
    hetznerHost:          document.getElementById('s-host').value.trim(),
    hetznerUser:          document.getElementById('s-user').value.trim(),
    hetznerPassword:      document.getElementById('s-pass').value,
    hetznerBasePath:      document.getElementById('s-base').value.trim() || '/docvault',
    deviceName:           document.getElementById('s-device').value.trim(),
    syncDirection:        document.getElementById('s-dir').value,
    syncEnabled:          document.getElementById('s-sync-enabled').checked,
    syncIntervalMinutes:  parseInt(document.getElementById('s-interval').value) || 60
  }
  await window.api.config.save(cfg)
  const msg = document.getElementById('save-msg')
  msg.classList.add('show')
  setTimeout(() => msg.classList.remove('show'), 2500)
}
async function resetResync() {
  showConfirm('Delete all locally-synced documents and re-download them?', async () => {
    await window.api.sync.reset()
    toast('Reset complete — syncing now…')
    await runSync()
  })
}
async function viewSyncLog() {
  const text = await window.api.sync.getLog()
  const modal = document.createElement('div')
  modal.className = 'overlay show'
  modal.innerHTML = `
    <div class="modal modal-lg">
      <div class="modal-header"><h3>Sync Log</h3></div>
      <pre class="log-pre">${esc(text)}</pre>
      <div class="modal-actions">
        <button class="mbtn" id="log-copy-btn">Copy</button>
        <button class="mbtn cancel" id="log-close-btn">Close</button>
      </div>
    </div>`
  document.body.appendChild(modal)
  modal.querySelector('#log-close-btn').addEventListener('click', () => modal.remove())
  modal.querySelector('#log-copy-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(text).then(() => toast('Copied'))
  })
}
async function testConnection() {
  await saveSettings()
  toast('Testing connection…')
  try {
    const entries = await window.api.files.list(cfg, `${basePath()}/`)
    toast(`Connected ✓  (${entries.length} items)`)
  } catch (e) {
    toast(`Connection failed: ${e.message}`)
  }
}

// ── Lock screen ──────────────────────────────────────────────────────────
async function showLockScreen() {
  const screen = document.getElementById('lock-screen')
  screen.classList.add('show')
  const pinInput = document.getElementById('lock-pin')
  const dotsEl   = document.getElementById('lock-dots')
  const errorEl  = document.getElementById('lock-error')

  function updateDots(val) {
    const dots = dotsEl.querySelectorAll('span')
    dots.forEach((d, i) => d.classList.toggle('filled', i < val.length))
  }

  pinInput.addEventListener('input', () => { updateDots(pinInput.value); errorEl.textContent = '' })
  pinInput.addEventListener('keydown', async e => {
    if (e.key === 'Enter') await attemptPin()
  })
  pinInput.focus()

  async function attemptPin() {
    const ok = await window.api.lock.check(pinInput.value)
    if (ok) {
      screen.classList.remove('show')
      await initApp()
    } else {
      errorEl.textContent = 'Incorrect PIN'
      pinInput.value = ''
      updateDots('')
      pinInput.focus()
    }
  }

  const touchAvail = await window.api.lock.touchIdAvailable()
  if (touchAvail) {
    const tidBtn = document.getElementById('touch-id-btn')
    tidBtn.style.display = 'flex'
    tidBtn.addEventListener('click', async () => {
      const ok = await window.api.lock.touchId()
      if (ok) { screen.classList.remove('show'); await initApp() }
      else errorEl.textContent = 'Touch ID failed'
    })
    // Auto-prompt
    const autoOk = await window.api.lock.touchId()
    if (autoOk) { screen.classList.remove('show'); await initApp() }
  }
}

// ── Lock settings ─────────────────────────────────────────────────────────
let pinModalMode = 'set'

function showPinModal(mode) {
  pinModalMode = mode
  document.getElementById('pin-modal-title').textContent = mode === 'set' ? 'Set PIN' : 'Change PIN'
  document.getElementById('pin-input').value   = ''
  document.getElementById('pin-confirm').value = ''
  document.getElementById('pin-error').textContent = ''
  document.getElementById('pin-modal').classList.add('show')
  setTimeout(() => document.getElementById('pin-input').focus(), 40)
}

function closePinModal() {
  document.getElementById('pin-modal').classList.remove('show')
  // If user cancels 'set', revert the toggle
  if (pinModalMode === 'set') {
    document.getElementById('s-lock-enabled').checked = false
    document.getElementById('change-pin-btn').style.display = 'none'
  }
}

async function savePinModal() {
  const pin     = document.getElementById('pin-input').value
  const confirm = document.getElementById('pin-confirm').value
  const errEl   = document.getElementById('pin-error')
  if (pin.length < 4)    { errEl.textContent = 'PIN must be at least 4 digits'; return }
  if (!/^\d+$/.test(pin)) { errEl.textContent = 'PIN must be digits only'; return }
  if (pin !== confirm)   { errEl.textContent = 'PINs do not match'; return }
  await window.api.lock.set(pin)
  document.getElementById('pin-modal').classList.remove('show')
  document.getElementById('s-lock-enabled').checked = true
  document.getElementById('change-pin-btn').style.display = ''
  document.getElementById('lock-status-text').textContent = 'PIN required on launch'
  toast('App lock enabled')
}

async function disableLock() {
  await window.api.lock.disable()
  document.getElementById('s-lock-enabled').checked = false
  document.getElementById('change-pin-btn').style.display = 'none'
  document.getElementById('lock-status-text').textContent = 'No lock — anyone can open the app'
  toast('App lock disabled')
}

// ── Confirm ─────────────────────────────────────────────────────────────
function showConfirm(msg, cb) {
  document.getElementById('confirm-msg').textContent = msg
  document.getElementById('confirm-ok').onclick = () => { closeConfirm(); cb() }
  document.getElementById('confirm-modal').classList.add('show')
}
function closeConfirm() { document.getElementById('confirm-modal').classList.remove('show') }

// ── Toast ────────────────────────────────────────────────────────────────
let toastTimer
function toast(msg) {
  const t = document.getElementById('toast')
  t.textContent = msg
  t.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000)
}

// ── Helpers ──────────────────────────────────────────────────────────────
function basePath() { return (cfg.hetznerBasePath || '/docvault').replace(/\/$/, '') }
function byName(a, b) { return a.name.localeCompare(b.name) }

function el(tag, attrs, text) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k.startsWith('data-')) node.dataset[k.slice(5)] = v
    else node[k] = v
  }
  if (text !== undefined) node.textContent = text
  return node
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')
}

function formatSize(b) {
  if (!b) return ''
  if (b < 1024) return `${b} B`
  if (b < 1048576) return `${(b/1024).toFixed(1)} KB`
  return `${(b/1048576).toFixed(1)} MB`
}

function fileIcon(name) {
  const ext = (name.split('.').pop() || '').toLowerCase()
  const m = {pdf:'📕',doc:'📝',docx:'📝',xls:'📊',xlsx:'📊',ppt:'📑',pptx:'📑',
    jpg:'🖼',jpeg:'🖼',png:'🖼',gif:'🖼',webp:'🖼',svg:'🖼',
    mp4:'🎬',mov:'🎬',mp3:'🎵',m4a:'🎵',wav:'🎵',zip:'📦',rar:'📦',
    txt:'📄',md:'📄',json:'📋',js:'📋',ts:'📋',py:'📋',html:'📋',css:'📋'}
  return m[ext] || '📄'
}

function fmtDate(ms) {
  const d = new Date(ms)
  const diff = Math.floor((Date.now() - ms) / 86400000)
  if (diff === 0) return 'Today ' + d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})
  if (diff === 1) return 'Yesterday'
  if (diff < 7)  return d.toLocaleDateString([], {weekday:'short'})
  return d.toLocaleDateString([], {day:'numeric', month:'short'})
}
