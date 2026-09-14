const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const hetzner = require('./hetzner')
const sync = require('./sync')
const config = require('./config')

function createWindow() {
  const win = new BrowserWindow({
    width:  1100,
    height: 750,
    minWidth:  800,
    minHeight: 600,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false
    },
    title: 'DocVault'
  })
  win.loadFile('renderer/index.html')
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ── Config ───────────────────────────────────────────────────────────────
ipcMain.handle('config:get',  ()    => config.load())
ipcMain.handle('config:save', (_, cfg) => { config.save(cfg); return true })

// ── Sync ─────────────────────────────────────────────────────────────────
ipcMain.handle('sync:run', async (_, cfg) => {
  try { return await sync.run(cfg) }
  catch (e) { return { uploaded: 0, downloaded: 0, failed: [], log: [e.message], summary: `Error: ${e.message}` } }
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
