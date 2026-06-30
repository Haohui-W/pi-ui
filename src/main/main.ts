import { app, BrowserWindow, ipcMain } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StringDecoder } from "node:string_decoder";
import type { StartRpcOptions } from "../shared/ipc";
import type { RpcCommand, RpcEnvelope } from "../shared/rpc";

const __dirname = dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let rpcProcess: ChildProcessWithoutNullStreams | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    title: "Pi Agent",
    backgroundColor: "#15161d",
    webPreferences: {
      preload: join(__dirname, "../preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function emit(channel: string, payload: unknown): void {
  mainWindow?.webContents.send(channel, payload);
}

ipcMain.handle("pi:start-rpc", (_event, options?: StartRpcOptions) => {
  startRpc(options ?? {});
});

ipcMain.handle("pi:send-rpc", (_event, command: RpcCommand) => {
  if (!rpcProcess?.stdin.writable) {
    throw new Error("pi RPC process is not running");
  }
  rpcProcess.stdin.write(`${JSON.stringify(command)}\n`);
});

ipcMain.handle("pi:stop-rpc", () => {
  stopRpc();
});

function startRpc(options: StartRpcOptions): void {
  stopRpc();

  const args = ["--mode", "rpc"];
  if (options.continueRecent) args.push("--continue");

  rpcProcess = spawn(options.piCommand ?? "pi", args, {
    cwd: options.cwd || process.cwd(),
    shell: process.platform === "win32",
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });

  pipeJsonLines(rpcProcess, (event) => emit("pi:rpc", event), (message) => emit("pi:rpc-error", message));
  pipeTextLines(rpcProcess.stderr, (message) => emit("pi:rpc-stderr", message));

  rpcProcess.on("error", (error) => emit("pi:rpc-error", error.message));
  rpcProcess.on("exit", (code) => {
    emit("pi:rpc-exit", code);
    rpcProcess = null;
  });
}

function stopRpc(): void {
  if (!rpcProcess) return;
  rpcProcess.removeAllListeners("exit");
  rpcProcess.kill();
  rpcProcess = null;
}

function pipeJsonLines(
  child: ChildProcessWithoutNullStreams,
  onEvent: (event: RpcEnvelope) => void,
  onError: (message: string) => void
): void {
  const decoder = new StringDecoder("utf8");
  let buffer = "";

  child.stdout.on("data", (chunk: Buffer) => {
    buffer += decoder.write(chunk);
    let lineEnd = buffer.indexOf("\n");
    while (lineEnd !== -1) {
      const rawLine = buffer.slice(0, lineEnd).replace(/\r$/, "");
      buffer = buffer.slice(lineEnd + 1);
      parseJsonLine(rawLine, onEvent, onError);
      lineEnd = buffer.indexOf("\n");
    }
  });

  child.stdout.on("end", () => {
    buffer += decoder.end();
    if (buffer.trim()) parseJsonLine(buffer.replace(/\r$/, ""), onEvent, onError);
  });
}

function parseJsonLine(line: string, onEvent: (event: RpcEnvelope) => void, onError: (message: string) => void): void {
  if (!line.trim()) return;
  try {
    onEvent(JSON.parse(line) as RpcEnvelope);
  } catch (error) {
    onError(`Failed to parse pi RPC output: ${error instanceof Error ? error.message : String(error)}\n${line}`);
  }
}

function pipeTextLines(stream: NodeJS.ReadableStream, onLine: (line: string) => void): void {
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  stream.on("data", (chunk: Buffer) => {
    buffer += decoder.write(chunk);
    let lineEnd = buffer.indexOf("\n");
    while (lineEnd !== -1) {
      const line = buffer.slice(0, lineEnd).replace(/\r$/, "");
      buffer = buffer.slice(lineEnd + 1);
      onLine(line);
      lineEnd = buffer.indexOf("\n");
    }
  });
}

app.whenReady().then(createWindow);

app.on("before-quit", stopRpc);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
