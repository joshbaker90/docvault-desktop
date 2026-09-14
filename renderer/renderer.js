// State
let cfg = {}
let currentPath = ''
let editingBookmarkId = null
let confirmCallback = null

// ── Init ─────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  cfg = await window.api.config.get()
  loadSettingsForm()
  await loadBookmarks()
  await loadClips()
  if (cfg.hetznerPassword) {
    await loadFileList(currentPath)
  }
})

// ── Tabs ─────────────────────────────────────────────────────────────────
function showTab(name) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'))
  document.querySelectorAll('nav button').forEach(el => el.classList.remove('active'))
  document.getElementById(`tab-content-${name}`).classList.add('active')
  document.getElementById(`tab-${name}`).classList.add('active')
}

// ── Sync ─────────────────────────────────────────────────────────────────
async function runSync() {
  if (!cfg.hetznerPassword) { showTab('settings'); toast('Enter your Hetzner credentials first'); return }
  const btn = document.getElementById('sync-btn')
  const status = document.getElementById('sync-status')
  btn.disabled = true
  btn.classList.add('syncing')
  btn.textContent = '⟳ Syncing…'
  status.textContent = ''
  try {
    const result = await window.api.sync.run(cfg)
    status.textContent = result.summary || 'Done'
    toast(result.summary || 'Sync complete')
    await loadFileList(currentPath)
    await loadBookmarks()
    await loadClips()
  } catch (e) {
    status.textContent = `Error: ${e.message}`
    toast(`Sync failed: ${e.message}`)
  } finally {
    btn.disabled = false
    btn.classList.remove('syncing')
    btn.textContent = '⟳ Sync'
  }
}

// ── Documents ─────────────────────────────────────────────────────────────
async function loadFileList(remotePath) {
  const basePath = (cfg.hetznerBasePath || '/docvault').replace(/\/$/, '')
  const fullRemotePath = remotePath ? `${basePath}/${remotePath}/` : `${basePath}/`
  const list = document.getElementById('file-list')
  list.innerHTML = '<div class="empty-state"><div class="icon">⏳</div><div>Loading…</div></div>'

  try {
    const entries = await window.api.files.list(cfg, fullRemotePath)
    renderFileList(entries, remotePath, basePath)
  } catch (e) {
    list.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><div>Failed to load: ${e.message}</div></div>`
  }
}

function renderFileList(entries, remotePath, basePath) {
  const list = document.getElementById('file-list')

  // Update breadcrumb
  const bc = document.getElementById('breadcrumb')
  if (!remotePath) {
    bc.innerHTML = '<span class="current">Home</span>'
  } else {
    const parts = remotePath.split('/')
    let html = '<span onclick="navigateTo(\'\')">Home</span>'
    parts.forEach((part, i) => {
      const pathSoFar = parts.slice(0, i + 1).join('/')
      html += `<span class="sep">/</span>`
      if (i === parts.length - 1) {
        html += `<span class="current">${esc(part)}</span>`
      } else {
        html += `<span onclick="navigateTo('${esc(pathSoFar)}')">${esc(part)}</span>`
      }
    })
    bc.innerHTML = html
  }

  if (entries.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="icon">📂</div><div>Folder is empty</div></div>'
    return
  }

  const dirs = entries.filter(e => e.isDir).sort((a, b) => a.name.localeCompare(b.name))
  const files = entries.filter(e => !e.isDir && !e.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name))

  list.innerHTML = ''

  for (const dir of dirs) {
    const childPath = remotePath ? `${remotePath}/${dir.name}` : dir.name
    const el = document.createElement('div')
    el.className = 'file-item'
    el.innerHTML = `
      <div class="icon">📁</div>
      <div class="info">
        <div class="name">${esc(dir.name)}</div>
        <div class="meta">Folder</div>
      </div>
      <div class="actions">
        <button title="Delete folder" onclick="event.stopPropagation(); deleteEntry('${esc(basePath)}/${esc(childPath)}', '${esc(childPath)}')">🗑</button>
      </div>
    `
    el.onclick = () => navigateTo(childPath)
    list.appendChild(el)
  }

  for (const file of files) {
    const relPath = remotePath ? `${remotePath}/${file.name}` : file.name
    const remoteFull = `${basePath}/${relPath}`
    const el = document.createElement('div')
    el.className = 'file-item'
    el.innerHTML = `
      <div class="icon">${fileIcon(file.name)}</div>
      <div class="info">
        <div class="name">${esc(file.name)}</div>
        <div class="meta">${formatSize(file.size)}</div>
      </div>
      <div class="actions">
        <button title="Open" onclick="event.stopPropagation(); openFile('${esc(remoteFull)}', '${esc(file.name)}')">↗</button>
        <button title="Delete" onclick="event.stopPropagation(); deleteEntry('${esc(remoteFull)}', '${esc(relPath)}')">🗑</button>
      </div>
    `
    el.onclick = () => openFile(remoteFull, file.name)
    list.appendChild(el)
  }
}

function navigateTo(path) {
  currentPath = path
  loadFileList(path)
}

async function openFile(remotePath, name) {
  toast(`Opening ${name}…`)
  const ok = await window.api.files.open(cfg, remotePath, name)
  if (!ok) toast(`Failed to open ${name}`)
}

async function addFiles() {
  if (!cfg.hetznerPassword) { showTab('settings'); toast('Enter your Hetzner credentials first'); return }
  const basePath = (cfg.hetznerBasePath || '/docvault').replace(/\/$/, '')
  const remotePath = currentPath ? `${basePath}/${currentPath}/` : `${basePath}/`
  const result = await window.api.files.upload(cfg, remotePath)
  if (result.uploaded > 0) {
    toast(`${result.uploaded} file${result.uploaded > 1 ? 's' : ''} uploaded`)
    await loadFileList(currentPath)
  }
}

async function deleteEntry(remotePath, relPath) {
  confirm(`Delete "${relPath.split('/').pop()}"?`, async () => {
    await window.api.files.delete(cfg, remotePath, relPath)
    toast('Deleted')
    await loadFileList(currentPath)
  })
}

// ── Bookmarks ─────────────────────────────────────────────────────────────
async function loadBookmarks() {
  const bookmarks = await window.api.bookmarks.get()
  renderBookmarks(bookmarks)
}

function renderBookmarks(bookmarks) {
  const list = document.getElementById('bookmarks-list')
  if (bookmarks.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="icon">🔖</div><div>No bookmarks yet — tap + to add one</div></div>'
    return
  }
  list.innerHTML = ''
  for (const bm of bookmarks) {
    const el = document.createElement('div')
    el.className = 'bookmark-item'
    el.innerHTML = `
      <div class="bm-icon">🔖</div>
      <div class="bm-info">
        <div class="bm-title">${esc(bm.title)}</div>
        <div class="bm-url">${esc(bm.url)}</div>
      </div>
      <div class="bm-actions">
        <button title="Edit" onclick="event.stopPropagation(); editBookmark('${esc(bm.id)}', '${esc(bm.title)}', '${esc(bm.url)}')">✏️</button>
        <button class="del" title="Delete" onclick="event.stopPropagation(); deleteBookmark('${esc(bm.id)}', '${esc(bm.title)}')">🗑</button>
      </div>
    `
    el.onclick = () => window.api.bookmarks.openUrl(bm.url)
    list.appendChild(el)
  }
}

function showAddBookmark() {
  editingBookmarkId = null
  document.getElementById('bm-modal-title').textContent = 'Add bookmark'
  document.getElementById('bm-title').value = ''
  document.getElementById('bm-url').value = ''
  document.getElementById('bookmark-modal').classList.add('show')
  document.getElementById('bm-title').focus()
}

function editBookmark(id, title, url) {
  editingBookmarkId = id
  document.getElementById('bm-modal-title').textContent = 'Edit bookmark'
  document.getElementById('bm-title').value = title
  document.getElementById('bm-url').value = url
  document.getElementById('bookmark-modal').classList.add('show')
  document.getElementById('bm-title').focus()
}

function closeBookmarkModal() {
  document.getElementById('bookmark-modal').classList.remove('show')
  editingBookmarkId = null
}

async function saveBookmark() {
  const title = document.getElementById('bm-title').value.trim()
  let url = document.getElementById('bm-url').value.trim()
  if (!title || !url) { toast('Title and URL are required'); return }
  if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url

  if (editingBookmarkId) {
    await window.api.bookmarks.update({ id: editingBookmarkId, title, url })
  } else {
    await window.api.bookmarks.add({ id: crypto.randomUUID(), title, url, addedAt: Date.now(), deletedAt: 0 })
  }
  closeBookmarkModal()
  await loadBookmarks()
  // Auto-sync bookmarks
  if (cfg.hetznerPassword) window.api.sync.run(cfg).then(() => loadBookmarks()).catch(() => {})
}

async function deleteBookmark(id, title) {
  confirm(`Delete bookmark "${title}"?`, async () => {
    await window.api.bookmarks.delete(id)
    await loadBookmarks()
    if (cfg.hetznerPassword) window.api.sync.run(cfg).then(() => loadBookmarks()).catch(() => {})
  })
}

// ── Clips ─────────────────────────────────────────────────────────────────
async function loadClips() {
  const clips = await window.api.clips.get()
  renderClips(clips)
}

function renderClips(clips) {
  const list = document.getElementById('clips-list')
  if (clips.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="icon">📋</div><div>No clips yet — tap + to save a copy-paste</div></div>'
    return
  }
  list.innerHTML = ''
  for (const clip of clips) {
    const el = document.createElement('div')
    el.className = 'clip-item'
    el.innerHTML = `
      <div class="clip-content">${esc(clip.content)}</div>
      <div class="clip-meta">
        <span>${esc(clip.deviceName)} · ${formatDate(clip.addedAt)}</span>
        <div class="clip-actions">
          <button title="Copy" onclick="event.stopPropagation(); copyClip('${esc(clip.id)}', this)">📋</button>
          <button class="del" title="Delete" onclick="event.stopPropagation(); deleteClip('${esc(clip.id)}')">🗑</button>
        </div>
      </div>
    `
    el.setAttribute('data-content', clip.content)
    el.onclick = () => copyClipContent(clip.content)
    list.appendChild(el)
  }
}

function copyClipContent(content) {
  navigator.clipboard.writeText(content).then(() => toast('Copied to clipboard'))
}

function copyClip(id, btn) {
  const item = btn.closest('.clip-item')
  const content = item.getAttribute('data-content')
  copyClipContent(content)
}

function showAddClip() {
  navigator.clipboard.readText().then(text => {
    document.getElementById('clip-text').value = text || ''
  }).catch(() => {
    document.getElementById('clip-text').value = ''
  })
  document.getElementById('clip-modal').classList.add('show')
  document.getElementById('clip-text').focus()
}

function closeClipModal() {
  document.getElementById('clip-modal').classList.remove('show')
}

async function saveClip() {
  const text = document.getElementById('clip-text').value.trim()
  if (!text) { toast('Text is required'); return }
  const clip = {
    id: crypto.randomUUID(),
    content: text,
    deviceName: cfg.deviceName || 'desktop',
    addedAt: Date.now(),
    deletedAt: 0
  }
  await window.api.clips.add(clip)
  closeClipModal()
  await loadClips()
  if (cfg.hetznerPassword) window.api.sync.run(cfg).then(() => loadClips()).catch(() => {})
}

async function deleteClip(id) {
  confirm('Delete this clip?', async () => {
    await window.api.clips.delete(id)
    await loadClips()
    if (cfg.hetznerPassword) window.api.sync.run(cfg).then(() => loadClips()).catch(() => {})
  })
}

function formatDate(ms) {
  const d = new Date(ms)
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ', ' +
    d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

// ── Settings ─────────────────────────────────────────────────────────────
function loadSettingsForm() {
  document.getElementById('s-host').value   = cfg.hetznerHost || ''
  document.getElementById('s-user').value   = cfg.hetznerUser || ''
  document.getElementById('s-pass').value   = cfg.hetznerPassword || ''
  document.getElementById('s-base').value   = cfg.hetznerBasePath || '/docvault'
  document.getElementById('s-device').value = cfg.deviceName || ''
  document.getElementById('s-dir').value    = cfg.syncDirection || 'both'
}

async function saveSettings() {
  cfg = {
    ...cfg,
    hetznerHost:     document.getElementById('s-host').value.trim(),
    hetznerUser:     document.getElementById('s-user').value.trim(),
    hetznerPassword: document.getElementById('s-pass').value,
    hetznerBasePath: document.getElementById('s-base').value.trim() || '/docvault',
    deviceName:      document.getElementById('s-device').value.trim(),
    syncDirection:   document.getElementById('s-dir').value
  }
  await window.api.config.save(cfg)
  const msg = document.getElementById('save-msg')
  msg.classList.add('show')
  setTimeout(() => msg.classList.remove('show'), 2000)
}

async function testConnection() {
  await saveSettings()
  toast('Testing connection…')
  try {
    const basePath = (cfg.hetznerBasePath || '/docvault').replace(/\/$/, '')
    const entries = await window.api.files.list(cfg, `${basePath}/`)
    toast(`Connected ✓ (${entries.length} items found)`)
  } catch (e) {
    toast(`Connection failed: ${e.message}`)
  }
}

// ── Confirm modal ─────────────────────────────────────────────────────────
function confirm(msg, cb) {
  confirmCallback = cb
  document.getElementById('confirm-msg').textContent = msg
  document.getElementById('confirm-modal').classList.add('show')
  document.getElementById('confirm-ok').onclick = () => { closeConfirm(); cb() }
}
function closeConfirm() {
  document.getElementById('confirm-modal').classList.remove('show')
  confirmCallback = null
}

// ── Toast ─────────────────────────────────────────────────────────────────
let toastTimer
function toast(msg) {
  const el = document.getElementById('toast')
  el.textContent = msg
  el.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000)
}

// ── Helpers ─────────────────────────────────────────────────────────────
function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')
}

function formatSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function fileIcon(name) {
  const ext = name.split('.').pop().toLowerCase()
  const map = { pdf: '📕', doc: '📝', docx: '📝', xls: '📊', xlsx: '📊', ppt: '📑', pptx: '📑',
    jpg: '🖼', jpeg: '🖼', png: '🖼', gif: '🖼', mp4: '🎬', mp3: '🎵', zip: '📦', txt: '📄' }
  return map[ext] || '📄'
}

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeBookmarkModal()
    closeClipModal()
    closeConfirm()
  }
})
