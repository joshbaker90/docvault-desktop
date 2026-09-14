const { app } = require('electron')
const fs = require('fs')
const path = require('path')
const os = require('os')

function configPath() {
  return path.join(app.getPath('userData'), 'config.json')
}

function pendingPath() {
  return path.join(app.getPath('userData'), 'pending-events.json')
}

function cursorsPath() {
  return path.join(app.getPath('userData'), 'cursors.json')
}

function bookmarksPath() {
  return path.join(app.getPath('userData'), 'bookmarks.json')
}

function clipsPath() {
  return path.join(app.getPath('userData'), 'clips.json')
}

function load() {
  try {
    if (fs.existsSync(configPath())) {
      return JSON.parse(fs.readFileSync(configPath(), 'utf8'))
    }
  } catch (_) {}
  return {
    hetznerHost:     'https://u663296.your-storagebox.de',
    hetznerUser:     '',
    hetznerPassword: '',
    hetznerBasePath: '/docvault',
    deviceName:      os.hostname().replace(/[^a-zA-Z0-9_-]/g, '-'),
    syncDirection:   'both',
    syncEnabled:     true
  }
}

function save(cfg) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true })
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2))
}

function getPendingEvents() {
  try {
    if (fs.existsSync(pendingPath())) return JSON.parse(fs.readFileSync(pendingPath(), 'utf8'))
  } catch (_) {}
  return []
}

function setPendingEvents(events) {
  fs.writeFileSync(pendingPath(), JSON.stringify(events))
}

function addPendingEvent(event) {
  const events = getPendingEvents()
  events.push(event)
  setPendingEvents(events)
}

function clearPendingEvents() {
  fs.writeFileSync(pendingPath(), '[]')
}

function getCursors() {
  try {
    if (fs.existsSync(cursorsPath())) return JSON.parse(fs.readFileSync(cursorsPath(), 'utf8'))
  } catch (_) {}
  return {}
}

function setCursors(cursors) {
  fs.writeFileSync(cursorsPath(), JSON.stringify(cursors))
}

function getLocalBookmarks() {
  try {
    if (fs.existsSync(bookmarksPath())) return JSON.parse(fs.readFileSync(bookmarksPath(), 'utf8'))
  } catch (_) {}
  return []
}

function saveLocalBookmarks(bookmarks) {
  fs.writeFileSync(bookmarksPath(), JSON.stringify(bookmarks))
}

function getLocalClips() {
  try {
    if (fs.existsSync(clipsPath())) return JSON.parse(fs.readFileSync(clipsPath(), 'utf8'))
  } catch (_) {}
  return []
}

function saveLocalClips(clips) {
  fs.writeFileSync(clipsPath(), JSON.stringify(clips))
}

module.exports = { load, save, getPendingEvents, setPendingEvents, addPendingEvent, clearPendingEvents, getCursors, setCursors, getLocalBookmarks, saveLocalBookmarks, bookmarksPath, getLocalClips, saveLocalClips }
