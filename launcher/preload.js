const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("launcherApi", {
    browseConfig: () => ipcRenderer.invoke("launcher:browseConfig"),
    toggle: (payload) => ipcRenderer.invoke("launcher:toggle", payload),
    onStatus: (handler) => ipcRenderer.on("launcher:status", (_e, p) => handler(p)),
    openAdvanced: (open) => ipcRenderer.invoke("launcher:openAdvanced", open),
});
