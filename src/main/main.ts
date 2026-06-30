import { join } from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import { PiSessionHost } from "./pi-session";
import type { PiEvent, StartSessionOptions } from "../shared/ipc";

let mainWindow: BrowserWindow | undefined;
const piHost = new PiSessionHost((event: PiEvent) => {
  mainWindow?.webContents.send("pi:event", event);
});

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    title: "Pi Agent",
    backgroundColor: "#18181e",
    webPreferences: {
      preload: join(__dirname, "../preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[renderer:load-error] ${errorCode} ${errorDescription} ${validatedURL}`);
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error(`[renderer:gone] ${details.reason}`);
  });
}

app.whenReady().then(() => {
  ipcMain.handle("pi:start-session", (_event, options?: StartSessionOptions) => piHost.start(options));
  ipcMain.handle("pi:send-prompt", (_event, prompt: string) => piHost.prompt(prompt));
  ipcMain.handle("pi:abort", () => piHost.abort());
  ipcMain.handle("pi:dispose-session", () => piHost.dispose());

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  void piHost.dispose();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
