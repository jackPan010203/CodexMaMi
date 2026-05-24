const { app, BrowserWindow, dialog, shell } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const APP_NAME = "CodexMaMi";
const HOST = "127.0.0.1";
const DEFAULT_PORT = Number(process.env.PORT || 4173);
const MAX_PORT_OFFSET = 50;

let mainWindow = null;
let backendServer = null;

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.setName(APP_NAME);

  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady()
    .then(async () => {
      const backend = await startBackend();
      backendServer = backend.server;
      createWindow(backend.url);
    })
    .catch((error) => {
      dialog.showErrorBox(
        `${APP_NAME} startup failed`,
        `The local CodexMaMi service could not start.\n\n${error.message}`
      );
      app.quit();
    });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && backendServer) {
      const address = backendServer.address();
      const port = typeof address === "object" && address ? address.port : DEFAULT_PORT;
      createWindow(`http://${HOST}:${port}`);
    }
  });

  app.on("before-quit", () => {
    if (backendServer) {
      backendServer.close();
      backendServer = null;
    }
  });
}

async function startBackend() {
  const serverPath = path.join(__dirname, "..", "server.mjs");
  const { startServer } = await import(pathToFileURL(serverPath).href);
  let lastError = null;

  for (let port = DEFAULT_PORT; port <= DEFAULT_PORT + MAX_PORT_OFFSET; port += 1) {
    try {
      process.env.PORT = String(port);
      const server = await startServer({ host: HOST, port });
      return {
        server,
        port,
        url: `http://${HOST}:${port}`
      };
    } catch (error) {
      lastError = error;
      if (error.code !== "EADDRINUSE") throw error;
    }
  }

  throw new Error(`No free local port found from ${DEFAULT_PORT} to ${DEFAULT_PORT + MAX_PORT_OFFSET}. ${lastError?.message || ""}`);
}

function createWindow(url) {
  const iconPath = path.join(__dirname, "..", "resources", "icon.ico");
  mainWindow = new BrowserWindow({
    title: APP_NAME,
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    show: false,
    icon: iconPath,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    shell.openExternal(targetUrl);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    if (targetUrl.startsWith(url)) return;
    event.preventDefault();
    shell.openExternal(targetUrl);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.loadURL(url);
}
