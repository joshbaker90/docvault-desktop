const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  config: {
    get:  ()    => ipcRenderer.invoke('config:get'),
    save: (cfg) => ipcRenderer.invoke('config:save', cfg)
  },
  sync: {
    run:    (cfg) => ipcRenderer.invoke('sync:run', cfg),
    reset:  ()    => ipcRenderer.invoke('sync:reset'),
    getLog: ()    => ipcRenderer.invoke('sync:get-log'),
    onAutoDone: (cb) => ipcRenderer.on('auto-sync-done', (_, r) => cb(r))
  },
  files: {
    list:        (cfg, remotePath) => ipcRenderer.invoke('files:list', cfg, remotePath),
    open:        (cfg, remotePath, name) => ipcRenderer.invoke('files:open', cfg, remotePath, name),
    upload:      (cfg, currentPath) => ipcRenderer.invoke('files:upload', cfg, currentPath),
    delete:      (cfg, remotePath, localRel) => ipcRenderer.invoke('files:delete', cfg, remotePath, localRel),
    openLocal:   (localPath) => ipcRenderer.invoke('files:open-local', localPath)
  },
  bookmarks: {
    get:    ()         => ipcRenderer.invoke('bookmarks:get'),
    add:    (b)        => ipcRenderer.invoke('bookmarks:add', b),
    update: (b)        => ipcRenderer.invoke('bookmarks:update', b),
    delete: (id)       => ipcRenderer.invoke('bookmarks:delete', id),
    openUrl:(url)      => ipcRenderer.invoke('bookmarks:open-url', url)
  },
  clips: {
    get:    ()         => ipcRenderer.invoke('clips:get'),
    add:    (c)        => ipcRenderer.invoke('clips:add', c),
    delete: (id)       => ipcRenderer.invoke('clips:delete', id)
  }
})
