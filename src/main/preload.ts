import { contextBridge, ipcRenderer } from "electron";
import type { PiBridge, StartRpcOptions } from "../shared/ipc";
import type { RpcCommand, RpcEnvelope } from "../shared/rpc";

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: T): void => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.off(channel, wrapped);
}

const bridge: PiBridge = {
  startRpc: (options?: StartRpcOptions) => ipcRenderer.invoke("pi:start-rpc", options),
  sendRpc: (command: RpcCommand) => ipcRenderer.invoke("pi:send-rpc", command),
  stopRpc: () => ipcRenderer.invoke("pi:stop-rpc"),
  listSessions: () => ipcRenderer.invoke("pi:list-sessions"),
  pickFolder: () => ipcRenderer.invoke("pi:pick-folder"),
  onRpc: (listener: (event: RpcEnvelope) => void) => subscribe("pi:rpc", listener),
  onRpcError: (listener: (message: string) => void) => subscribe("pi:rpc-error", listener),
  onRpcStderr: (listener: (message: string) => void) => subscribe("pi:rpc-stderr", listener),
  onRpcExit: (listener: (code: number | null) => void) => subscribe("pi:rpc-exit", listener),
};

contextBridge.exposeInMainWorld("pi", bridge);
