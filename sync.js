const { app } = require('electron')
const fs = require('fs')
const path = require('path')
const hetzner = require('./hetzner')
const config = require('./config')

function docDir() {
  const dir = path.join(app.getPath('documents'), 'DocVault')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function mergeByUUID(local, remote, timestamp) {
  const map = new Map()
  for (const item of [...local, ...remote]) {
    const existing = map.get(item.id)
    if (!existing || timestamp(item) > timestamp(existing)) map.set(item.id, item)
  }
  return Array.from(map.values())
}

function mergeBookmarks(local, remote) {
  return mergeByUUID(local, remote, b => b.deletedAt > 0 ? b.deletedAt : b.addedAt)
}

async function run(cfg) {
  const basePath = (cfg.hetznerBasePath || '/docvault').replace(/\/$/, '')
  const device = cfg.deviceName || 'desktop'
  const dir = docDir()
  const log = []
  let uploaded = 0, downloaded = 0
  const failed = []

  // ── Clips sync ──────────────────────────────────────────────────────────
  try {
    const clipsPath = `${basePath}/.clips.json`
    const localClips = config.getLocalClips()
    const remoteJson = await hetzner.downloadText(cfg, clipsPath)
    const remoteClips = remoteJson ? JSON.parse(remoteJson) : []
    const mergedClips = mergeByUUID(localClips, remoteClips, c => c.deletedAt > 0 ? c.deletedAt : c.addedAt)
    config.saveLocalClips(mergedClips)
    await hetzner.uploadText(cfg, clipsPath, JSON.stringify(mergedClips))
    log.push(`Clips: merged ${mergedClips.length}`)
  } catch (e) { log.push(`Clips error: ${e.message}`) }

  // ── Bookmarks sync ──────────────────────────────────────────────────────
  try {
    const bookmarkPath = `${basePath}/.bookmarks.json`
    const local = config.getLocalBookmarks()
    const remoteJson = await hetzner.downloadText(cfg, bookmarkPath)
    const remote = remoteJson ? JSON.parse(remoteJson) : []
    const merged = mergeBookmarks(local, remote)
    config.saveLocalBookmarks(merged)
    await hetzner.uploadText(cfg, bookmarkPath, JSON.stringify(merged))
    log.push(`Bookmarks: merged ${merged.size || merged.length} (local=${local.length} remote=${remote.length})`)
  } catch (e) {
    log.push(`Bookmarks error: ${e.message}`)
  }

  // ── Phase 1: Upload pending events ──────────────────────────────────────
  if (cfg.syncDirection !== 'download') {
    const events = config.getPendingEvents()
    const logLines = []
    const retry = []

    for (const event of events) {
      let ok = false
      if (event.action === 'create') {
        const f = path.join(dir, event.path)
        if (fs.existsSync(f)) {
          ok = await hetzner.uploadFile(cfg, `${basePath}/${event.path}`, f)
          if (ok) { logLines.push(event); uploaded++; log.push(`↑ ${event.path}`) }
          else { failed.push(path.basename(f)); log.push(`↑ ${event.path} FAILED`) }
        } else {
          logLines.push({ action: 'delete', path: event.path })
          ok = true
        }
      } else if (event.action === 'delete') {
        await hetzner.deleteFile(cfg, `${basePath}/${event.path}`)
        logLines.push(event)
        ok = true
        log.push(`✕ ${event.path}`)
      } else if (event.action === 'move') {
        const newPath = event.newPath
        if (newPath) {
          const f = path.join(dir, newPath)
          if (fs.existsSync(f)) {
            ok = await hetzner.uploadFile(cfg, `${basePath}/${newPath}`, f)
            if (ok) {
              await hetzner.deleteFile(cfg, `${basePath}/${event.path}`)
              logLines.push(event); uploaded++
              log.push(`→ ${event.path} → ${newPath}`)
            }
          } else { ok = true }
        } else { ok = true }
      }
      if (!ok) retry.push(event)
    }

    if (logLines.length > 0) await hetzner.appendToLog(cfg, basePath, device, logLines)
    config.clearPendingEvents()
    config.setPendingEvents(retry)
  }

  // ── Phase 2: Process peer journals ──────────────────────────────────────
  if (cfg.syncDirection !== 'upload') {
    const peers = await hetzner.listLogDevices(cfg, basePath)
    const cursors = config.getCursors()

    for (const peer of peers) {
      const allLines = await hetzner.downloadLog(cfg, basePath, peer)
      const processed = cursors[peer] || 0
      const newLines = allLines.slice(processed)

      const succeededNames = new Set()
      const pendingFailed = []

      for (const line of newLines) {
        let event
        try { event = JSON.parse(line) } catch (_) { continue }

        if (event.action === 'create') {
          const f = path.join(dir, event.path)
          const isPeer = peer !== device
          if (isPeer || !fs.existsSync(f)) {
            const ok = await hetzner.downloadFile(cfg, `${basePath}/${event.path}`, f)
            if (ok) { downloaded++; succeededNames.add(path.basename(f)); log.push(`↓ ${event.path}`) }
            else { try { if (fs.statSync(f).size === 0) fs.unlinkSync(f) } catch (_) {}; pendingFailed.push(path.basename(f)) }
          }
        } else if (event.action === 'delete') {
          const f = path.join(dir, event.path)
          if (fs.existsSync(f)) { fs.unlinkSync(f); log.push(`✕ ${event.path}`) }
        } else if (event.action === 'move' && event.newPath) {
          const src = path.join(dir, event.path)
          const dst = path.join(dir, event.newPath)
          if (fs.existsSync(src) && !fs.existsSync(dst)) {
            fs.mkdirSync(path.dirname(dst), { recursive: true })
            fs.renameSync(src, dst)
            succeededNames.add(path.basename(dst))
            log.push(`→ ${event.path} → ${event.newPath}`)
          } else if (!fs.existsSync(dst)) {
            const ok = await hetzner.downloadFile(cfg, `${basePath}/${event.newPath}`, dst)
            if (ok) { downloaded++; succeededNames.add(path.basename(dst)); log.push(`↓ ${event.newPath}`) }
          }
        }
      }

      for (const name of pendingFailed) {
        if (!succeededNames.has(name)) failed.push(name)
      }

      cursors[peer] = allLines.length
    }

    config.setCursors(cursors)
  }

  return {
    uploaded, downloaded, failed,
    log,
    summary: buildSummary(uploaded, downloaded, failed)
  }
}

function buildSummary(up, down, failed) {
  const parts = []
  if (up > 0) parts.push(`↑ ${up} uploaded`)
  if (down > 0) parts.push(`↓ ${down} downloaded`)
  if (failed.length > 0) parts.push(`Failed: ${failed.join(', ')}`)
  return parts.length > 0 ? parts.join('  ') : 'Already up to date'
}

module.exports = { run }
