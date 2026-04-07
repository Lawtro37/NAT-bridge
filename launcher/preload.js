const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("launcherApi", {
    browseConfig: () => ipcRenderer.invoke("launcher:browseConfig"),
    toggle: (payload) => ipcRenderer.invoke("launcher:toggle", payload),
    onLog: (handler) => ipcRenderer.on("launcher:log", (_e, p) => handler(p)),
    onStatus: (handler) => ipcRenderer.on("launcher:status", (_e, p) => handler(p)),
});
