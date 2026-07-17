import { app, BrowserWindow, dialog, Menu, nativeImage, shell, Tray } from "electron";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const runtimeRoot = path.join(root, "dist-server");
let labels = null;

let mainWindow = null;
let tray = null;
let quitting = false;
let closeServer = null;
let serverClosed = false;
let serverShutdownPending = false;

function reservePort(preferredPort = 8787) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", () => {
      const fallback = net.createServer();
      fallback.once("error", reject);
      fallback.listen(0, "127.0.0.1", () => {
        const address = fallback.address();
        const port = typeof address === "object" && address ? address.port : preferredPort;
        fallback.close((error) => error ? reject(error) : resolve(port));
      });
    });
    probe.listen(preferredPort, "127.0.0.1", () => {
      probe.close((error) => error ? reject(error) : resolve(preferredPort));
    });
  });
}

async function waitForServer(baseUrl) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // The bundled runtime is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("LOCORIS_SERVER_START_TIMEOUT");
}

function updateTrayMenu() {
  if (!tray || !labels) return;
  const loginSettings = app.getLoginItemSettings();
  const startupItems = process.platform === "darwin" || process.platform === "win32"
    ? [
        {
          label: labels.autostart,
          type: "checkbox",
          checked: loginSettings.openAtLogin,
          click: (item) => {
            app.setLoginItemSettings({ openAtLogin: item.checked });
            updateTrayMenu();
          }
        },
        { type: "separator" }
      ]
    : [];
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: labels.show,
        click: () => {
          mainWindow?.show();
          mainWindow?.focus();
        }
      },
      ...startupItems,
      {
        label: labels.quit,
        click: () => {
          quitting = true;
          app.quit();
        }
      }
    ])
  );
}

function createWindow(startUrl) {
  mainWindow = new BrowserWindow({
    title: labels?.title ?? "Locoris Server",
    width: 1040,
    height: 780,
    minWidth: 680,
    minHeight: 560,
    show: false,
    backgroundColor: "#0c1020",
    autoHideMenuBar: true,
    icon: path.join(runtimeRoot, "icon.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("locoris://") || url.startsWith("https://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("locoris://")) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
  void mainWindow.loadURL(startUrl);
}

app.on("before-quit", (event) => {
  quitting = true;
  if (serverClosed || !closeServer) {
    return;
  }

  event.preventDefault();
  if (serverShutdownPending) {
    return;
  }

  serverShutdownPending = true;
  void Promise.resolve(closeServer())
    .catch(() => undefined)
    .finally(() => {
      serverClosed = true;
      app.quit();
    });
});

const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) {
  app.quit();
} else {
  app.on("second-instance", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  await app.whenReady();
  const isRussian = app.getLocale().toLowerCase().startsWith("ru");
  labels = isRussian
    ? {
        show: "Открыть Locoris Server",
        autostart: "Запускать при входе в систему",
        quit: "Завершить сервер",
        title: "Locoris Server"
      }
    : {
        show: "Open Locoris Server",
        autostart: "Start at system login",
        quit: "Quit server",
        title: "Locoris Server"
      };
  try {
    const port = await reservePort(Number(process.env.PORT) || 8787);
    const baseUrl = `http://127.0.0.1:${port}`;
    process.env.PORT = String(port);
    process.env.LOCORIS_DESKTOP_SERVER = "1";
    process.env.SYNC_PRINT_QR = "0";
    process.env.SYNC_PUBLIC_URL = process.env.SYNC_PUBLIC_URL || baseUrl;
    process.env.SYNC_DATA_DIR = process.env.SYNC_DATA_DIR || path.join(app.getPath("userData"), "Server Data");
    const runtime = await import(pathToFileURL(path.join(runtimeRoot, "server.mjs")).href);
    closeServer = runtime.closePersonalServer;
    const ready = await runtime.personalServerReady;
    await waitForServer(baseUrl);

    const trayIcon = nativeImage.createFromPath(path.join(runtimeRoot, "icon.png"));
    tray = new Tray(trayIcon.resize({ width: 20, height: 20 }));
    tray.setToolTip(labels.title);
    tray.on("double-click", () => {
      mainWindow?.show();
      mainWindow?.focus();
    });
    updateTrayMenu();
    createWindow(ready.bootstrapUrl || baseUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox(labels.title, message);
    app.quit();
  }

  app.on("activate", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
  app.on("window-all-closed", () => undefined);
}
