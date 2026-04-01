const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('servizephyrDesktop', {
  getRuntimeInfo: () => ipcRenderer.invoke('desktop:get-runtime-info'),
  offline: {
    getNamespace: (payload) => ipcRenderer.invoke('desktop:offline:get-namespace', payload),
    getNamespaces: (payload) => ipcRenderer.invoke('desktop:offline:get-namespaces', payload),
    setNamespace: (payload) => ipcRenderer.invoke('desktop:offline:set-namespace', payload),
    patchNamespace: (payload) => ipcRenderer.invoke('desktop:offline:patch-namespace', payload),
    upsertCollectionItem: (payload) => ipcRenderer.invoke('desktop:offline:upsert-collection-item', payload),
    removeCollectionItem: (payload) => ipcRenderer.invoke('desktop:offline:remove-collection-item', payload),
    appendQueueItem: (payload) => ipcRenderer.invoke('desktop:offline:append-queue-item', payload),
    listQueueItems: (payload) => ipcRenderer.invoke('desktop:offline:list-queue-items', payload),
    removeQueueItem: (payload) => ipcRenderer.invoke('desktop:offline:remove-queue-item', payload),
    getDebugInfo: () => ipcRenderer.invoke('desktop:offline:get-debug-info'),
  },
  print: {
    silentHtml: (payload) => ipcRenderer.invoke('desktop:print:silent-html', payload),
  },
  updates: {
    getState: () => ipcRenderer.invoke('desktop:update:get-state'),
    checkNow: () => ipcRenderer.invoke('desktop:update:check-now'),
    installNow: () => ipcRenderer.invoke('desktop:update:install-now'),
  },
});
