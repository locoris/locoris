import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("locorisServerDesktop", {
  getNetworkSettings: () => ipcRenderer.invoke("locoris-server:network:get"),
  applyNetworkPort: (port) => ipcRenderer.invoke("locoris-server:network:apply-port", { port }),
  restart: () => ipcRenderer.invoke("locoris-server:restart")
});
