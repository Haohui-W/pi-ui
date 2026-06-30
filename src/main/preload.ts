import { contextBridge, ipcRenderer } from "electron";
import type { PiBridge, PiEvent, StartSessionOptions } from "../shared/ipc";

const bridge: PiBridge = {
  startSession: (options?: StartSessionOptions) => ipcRenderer.invoke("pi:start-session", options),
  sendPrompt: (prompt: string) => ipcRenderer.invoke("pi:send-prompt", prompt),
  abort: () => ipcRenderer.invoke("pi:abort"),
  disposeSession: () => ipcRenderer.invoke("pi:dispose-session"),
  onEvent: (listener: (event: PiEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: PiEvent) => listener(payload);
    ipcRenderer.on("pi:event", handler);
    return () => ipcRenderer.off("pi:event", handler);
  }
};

contextBridge.exposeInMainWorld("pi", bridge);
