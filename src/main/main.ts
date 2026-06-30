import { app, BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { StringDecoder } from "node:string_decoder";
import type { PiSessionSummary, StartRpcOptions } from "../shared/ipc";
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

ipcMain.handle("pi:list-sessions", () => listSessions());

ipcMain.handle("pi:pick-folder", async () => {
  const options: OpenDialogOptions = {
    properties: ["openDirectory"],
  };
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
  return result.canceled ? undefined : result.filePaths[0];
});

function startRpc(options: StartRpcOptions): void {
  stopRpc();

  const args = ["--mode", "rpc"];
  if (options.sessionPath) args.push("--session", options.sessionPath);
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

async function listSessions(): Promise<PiSessionSummary[]> {
  const sessionsDir = join(homedir(), ".pi", "agent", "sessions");
  if (!existsSync(sessionsDir)) return [];

  const files = await findSessionFiles(sessionsDir);
  const summaries = await Promise.all(files.map((file) => readSessionSummary(file)));
  return summaries
    .filter((session): session is PiSessionSummary => session !== undefined)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

async function findSessionFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await findSessionFiles(path)));
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      found.push(path);
    }
  }
  return found;
}

async function readSessionSummary(filePath: string): Promise<PiSessionSummary | undefined> {
  try {
    const fileStat = await stat(filePath);
    let id = "";
    let cwd = "";
    let createdAt = "";
    let title = "";
    let firstMessage = "";
    let messageCount = 0;
    let updatedAt = fileStat.mtime.toISOString();

    const rl = createInterface({
      input: createReadStream(filePath, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) continue;
      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (entry.type === "session") {
        id = typeof entry.id === "string" ? entry.id : "";
        cwd = typeof entry.cwd === "string" ? entry.cwd : "";
        createdAt = typeof entry.timestamp === "string" ? entry.timestamp : fileStat.birthtime.toISOString();
        continue;
      }

      if (entry.type === "session_info" && typeof entry.name === "string") {
        title = entry.name.trim();
      }

      if (entry.type === "message") {
        messageCount++;
        const timestamp = typeof entry.timestamp === "string" ? entry.timestamp : undefined;
        if (timestamp) updatedAt = timestamp;

        const message = entry.message as Record<string, unknown> | undefined;
        if (!firstMessage && message?.role === "user") {
          firstMessage = extractMessageText(message.content);
        }
      }
    }

    if (!id) return undefined;
    return {
      id,
      path: filePath,
      cwd,
      title: title || firstMessage || "Untitled session",
      firstMessage: firstMessage || "(no prompt yet)",
      messageCount,
      createdAt: createdAt || fileStat.birthtime.toISOString(),
      updatedAt,
    };
  } catch {
    return undefined;
  }
}

function extractMessageText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const item = part as { type?: unknown; text?: unknown };
      return item.type === "text" && typeof item.text === "string" ? item.text : "";
    })
    .join(" ")
    .trim();
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
