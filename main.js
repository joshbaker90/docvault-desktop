const { app, BrowserWindow, ipcMain, dialog, shell, Menu, systemPreferences } = require('electron')
const path = require('path')
const fs = require('fs')
const https = require('https')
const os = require('os')
const crypto = require('crypto')
const hetzner = require('./hetzner')
const sync = require('./sync')
const config = require('./config')

function createWindow() {
  Menu.setApplicationMenu(null)
  const win = new BrowserWindow({
    width:  1100,
    height: 750,
    minWidth:  820,
    minHeight: 560,
    autoHideMenuBar: true,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false
    },
    title: 'DocVault'
  })
  win.loadFile('renderer/index.html')
}

let autoSyncInterval = null
let isSyncing = false

// ── File watcher — queues locally-modified files for upload ───────────────
function startFileWatcher() {
  const docDir = path.join(app.getPath('documents'), 'DocVault')
  fs.mkdirSync(docDir, { recursive: true })

  const timers = new Map()

  try {
    fs.watch(docDir, { recursive: true }, (_, filename) => {
      if (!filename || isSyncing) return
      const base = path.basename(filename)
      // Skip temp/hidden files created by editors
      if (base.startsWith('.') || base.startsWith('~$') || base.endsWith('.tmp') || base.endsWith('.swp')) return

      const relPath = filename.replace(/\\/g, '/')
      const fullPath = path.join(docDir, filename)

      clearTimeout(timers.get(relPath))
      timers.set(relPath, setTimeout(() => {
        timers.delete(relPath)
        try {
          const stat = fs.statSync(fullPath)
          if (!stat.isDirectory()) {
            const events = config.getPendingEvents()
            if (!events.some(e => e.action === 'create' && e.path === relPath)) {
              config.addPendingEvent({ action: 'create', path: relPath })
            }
          }
        } catch (_) {}
      }, 1500))
    })
  } catch (e) {
    console.error('File watcher error:', e.message)
  }
}

function startAutoSync(cfg) {
  clearInterval(autoSyncInterval)
  if (!cfg.syncEnabled || !cfg.hetznerPassword) return
  const ms = (cfg.syncIntervalMinutes || 60) * 60 * 1000
  autoSyncInterval = setInterval(async () => {
    const current = config.load()
    if (!current.hetznerPassword || !current.syncEnabled) return
    try {
      const result = await sync.run(current)
      appendSyncLog(result.log)
      const wins = BrowserWindow.getAllWindows()
      if (wins.length) wins[0].webContents.send('auto-sync-done', result)
    } catch (_) {}
  }, ms)
}

app.whenReady().then(() => {
  createWindow()
  startAutoSync(config.load())
  startFileWatcher()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ── Lock ─────────────────────────────────────────────────────────────────
function hashPin(pin) {
  return crypto.createHash('sha256').update('docvault:' + pin).digest('hex')
}

ipcMain.handle('lock:is-enabled', () => {
  const cfg = config.load()
  return !!(cfg.lockEnabled && cfg.lockPinHash)
})

ipcMain.handle('lock:check', (_, pin) => {
  const cfg = config.load()
  return cfg.lockPinHash === hashPin(pin)
})

ipcMain.handle('lock:set', (_, pin) => {
  const cfg = config.load()
  cfg.lockEnabled = true
  cfg.lockPinHash = hashPin(pin)
  config.save(cfg)
  return true
})

ipcMain.handle('lock:disable', () => {
  const cfg = config.load()
  cfg.lockEnabled = false
  cfg.lockPinHash = ''
  config.save(cfg)
  return true
})

ipcMain.handle('lock:touch-id-available', () => {
  return process.platform === 'darwin' && systemPreferences.canPromptTouchID()
})

ipcMain.handle('lock:touch-id', async () => {
  try {
    await systemPreferences.promptTouchID('Unlock DocVault')
    return true
  } catch (_) { return false }
})

// ── Sync log ─────────────────────────────────────────────────────────────

function syncLogPath() {
  return path.join(app.getPath('userData'), 'sync.log')
}

function appendSyncLog(lines) {
  try {
    const ts = new Date().toISOString()
    const entry = `[${ts}]\n${lines.join('\n')}\n\n`
    const existing = fs.existsSync(syncLogPath()) ? fs.readFileSync(syncLogPath(), 'utf8') : ''
    const trimmed = (entry + existing).slice(0, 50000)
    fs.writeFileSync(syncLogPath(), trimmed)
  } catch (_) {}
}

// ── App info ──────────────────────────────────────────────────────────────
ipcMain.handle('app:version', () => app.getVersion())

// ── Config ───────────────────────────────────────────────────────────────
ipcMain.handle('config:get',  ()    => config.load())
ipcMain.handle('config:save', (_, cfg) => {
  config.save(cfg)
  startAutoSync(cfg)
  return true
})

// ── Sync ─────────────────────────────────────────────────────────────────
ipcMain.handle('sync:run', async (_, cfg) => {
  isSyncing = true
  try {
    const result = await sync.run(cfg)
    appendSyncLog(result.log)
    return result
  }
  catch (e) { return { uploaded: 0, downloaded: 0, failed: [], log: [e.message], summary: `Error: ${e.message}` } }
  finally {
    // Delay re-enabling the watcher so downloaded files don't immediately queue for re-upload
    setTimeout(() => { isSyncing = false }, 2000)
  }
})

ipcMain.handle('sync:reset', () => {
  config.setCursors({})
  const docDir = path.join(app.getPath('documents'), 'DocVault')
  if (fs.existsSync(docDir)) {
    fs.rmSync(docDir, { recursive: true, force: true })
  }
  return true
})

ipcMain.handle('sync:get-log', () => {
  try {
    return fs.existsSync(syncLogPath()) ? fs.readFileSync(syncLogPath(), 'utf8') : 'No sync log yet. Run a sync first.'
  } catch (_) { return 'Could not read sync log.' }
})

// ── Files ─────────────────────────────────────────────────────────────────
ipcMain.handle('files:list', async (_, cfg, remotePath) => {
  return hetzner.listDirectory(cfg, remotePath)
})

ipcMain.handle('files:open', async (_, cfg, remotePath, name) => {
  const localDir = path.join(app.getPath('documents'), 'DocVault', path.dirname(remotePath.replace((cfg.hetznerBasePath || '/docvault').replace(/\/$/, ''), '')))
  fs.mkdirSync(localDir, { recursive: true })
  const localPath = path.join(localDir, name)
  const ok = await hetzner.downloadFile(cfg, remotePath, localPath)
  if (ok) await shell.openPath(localPath)
  return ok
})

ipcMain.handle('files:open-local', async (_, localPath) => {
  await shell.openPath(localPath)
})

ipcMain.handle('files:upload', async (_, cfg, currentRemotePath) => {
  const result = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] })
  if (result.canceled) return { uploaded: 0 }

  const basePath = (cfg.hetznerBasePath || '/docvault').replace(/\/$/, '')
  const localDocDir = path.join(app.getPath('documents'), 'DocVault')
  let uploaded = 0

  for (const localPath of result.filePaths) {
    const name = path.basename(localPath)
    // Determine relative path within vault
    const relFolder = currentRemotePath.replace(basePath, '').replace(/^\//, '').replace(/\/$/, '')
    const relPath = relFolder ? `${relFolder}/${name}` : name
    const remotePath = `${basePath}/${relPath}`

    // Copy to local vault folder
    const localDest = path.join(localDocDir, relPath)
    fs.mkdirSync(path.dirname(localDest), { recursive: true })
    fs.copyFileSync(localPath, localDest)

    const ok = await hetzner.uploadFile(cfg, remotePath, localPath)
    if (ok) {
      config.addPendingEvent({ action: 'create', path: relPath })
      uploaded++
    }
  }
  return { uploaded }
})

ipcMain.handle('files:delete', async (_, cfg, remotePath, localRel) => {
  const basePath = (cfg.hetznerBasePath || '/docvault').replace(/\/$/, '')
  await hetzner.deleteFile(cfg, remotePath)
  config.addPendingEvent({ action: 'delete', path: localRel })

  // Delete local copy if it exists
  const localPath = path.join(app.getPath('documents'), 'DocVault', localRel)
  if (fs.existsSync(localPath)) fs.unlinkSync(localPath)
  return true
})

// ── Bookmarks ─────────────────────────────────────────────────────────────
ipcMain.handle('bookmarks:get', () => config.getLocalBookmarks().filter(b => !b.deletedAt || b.deletedAt === 0))

ipcMain.handle('bookmarks:add', (_, bookmark) => {
  const bookmarks = config.getLocalBookmarks()
  bookmarks.push(bookmark)
  config.saveLocalBookmarks(bookmarks)
  return true
})

ipcMain.handle('bookmarks:update', (_, updated) => {
  const bookmarks = config.getLocalBookmarks().map(b => b.id === updated.id ? updated : b)
  config.saveLocalBookmarks(bookmarks)
  return true
})

ipcMain.handle('bookmarks:delete', (_, id) => {
  const now = Date.now()
  const bookmarks = config.getLocalBookmarks().map(b => b.id === id ? { ...b, deletedAt: now } : b)
  config.saveLocalBookmarks(bookmarks)
  return true
})

ipcMain.handle('bookmarks:open-url', (_, url) => {
  shell.openExternal(url)
})

// ── Clips ─────────────────────────────────────────────────────────────────
ipcMain.handle('clips:get', () => config.getLocalClips().filter(c => !c.deletedAt || c.deletedAt === 0))

ipcMain.handle('clips:add', (_, clip) => {
  const clips = config.getLocalClips()
  clips.push(clip)
  config.saveLocalClips(clips)
  return true
})

ipcMain.handle('clips:delete', (_, id) => {
  const now = Date.now()
  const clips = config.getLocalClips().map(c => c.id === id ? { ...c, deletedAt: now } : c)
  config.saveLocalClips(clips)
  return true
})

// ── Auto-updater ──────────────────────────────────────────────────────────
function isNewerVersion(remote, local) {
  const r = remote.replace(/^v/, '').split('.').map(Number)
  const l = local.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const rv = r[i] || 0, lv = l[i] || 0
    if (rv !== lv) return rv > lv
  }
  return false
}

function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const follow = (u, depth) => {
      if (depth > 5) return reject(new Error('Too many redirects'))
      const opts = new URL(u)
      https.get({ hostname: opts.hostname, path: opts.pathname + opts.search, headers: { 'User-Agent': 'DocVault-Desktop', ...headers } }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return follow(res.headers.location, depth + 1)
        }
        let data = ''
        res.on('data', c => data += c)
        res.on('end', () => resolve({ statusCode: res.statusCode, body: data, headers: res.headers }))
      }).on('error', reject)
    }
    follow(url, 0)
  })
}

ipcMain.handle('update:check', async () => {
  try {
    const res = await httpsGet('https://api.github.com/repos/joshbaker90/docvault-desktop/releases/latest', {
      Accept: 'application/vnd.github+json'
    })
    if (res.statusCode !== 200) return null
    const json = JSON.parse(res.body)
    const remoteVersion = (json.tag_name || '').replace(/^v/, '')
    if (!isNewerVersion(remoteVersion, app.getVersion())) return null

    const assets = json.assets || []
    let assetName
    if (process.platform === 'win32') assetName = 'DocVault-Setup.exe'
    else if (process.platform === 'darwin') assetName = process.arch === 'arm64' ? 'DocVault-arm64.dmg' : 'DocVault-x64.dmg'
    else assetName = 'DocVault.AppImage'

    const asset = assets.find(a => a.name === assetName)
    if (!asset) return null
    return { version: remoteVersion, url: asset.browser_download_url, size: asset.size, name: asset.name }
  } catch (_) { return null }
})

ipcMain.handle('update:download', (event, url, name) => {
  const tmpPath = path.join(os.tmpdir(), name)
  return new Promise((resolve, reject) => {
    const download = (u, depth) => {
      if (depth > 5) return reject(new Error('Too many redirects'))
      const opts = new URL(u)
      https.get({ hostname: opts.hostname, path: opts.pathname + opts.search, headers: { 'User-Agent': 'DocVault-Desktop' } }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return download(res.headers.location, depth + 1)
        }
        const total = parseInt(res.headers['content-length'] || '0')
        let downloaded = 0
        const file = fs.createWriteStream(tmpPath)
        res.on('data', chunk => {
          downloaded += chunk.length
          if (total > 0) {
            const win = BrowserWindow.getAllWindows()[0]
            if (win) win.webContents.send('update:progress', downloaded / total)
          }
        })
        res.pipe(file)
        file.on('finish', () => { file.close(); resolve(tmpPath) })
        file.on('error', reject)
      }).on('error', reject)
    }
    download(url, 0)
  })
})

ipcMain.handle('update:install', async (_, localPath) => {
  if (process.platform === 'linux') {
    try { fs.chmodSync(localPath, '755') } catch (_) {}
  }
  await shell.openPath(localPath)
})
