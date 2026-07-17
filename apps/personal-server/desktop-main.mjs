import { app, BrowserWindow, dialog, Menu, nativeImage, shell, Tray } from "electron";
import { appendFile, mkdir } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const runtimeRoot = path.join(root, "dist-server");
const smokeTest = process.env.LOCORIS_DESKTOP_SMOKE_TEST === "1";
let labels = null;

let mainWindow = null;
let tray = null;
let quitting = false;
let closeServer = null;
let serverClosed = false;
let serverShutdownPending = false;
let logFile = null;

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
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // The bundled runtime is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error("LOCORIS_SERVER_START_TIMEOUT");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderLaunchPage(state, detail = "") {
  const copy = labels ?? {
    title: "Locoris Server",
    starting: "Starting your private sync server",
    startingDetail: "Preparing secure local storage and the connection panel.",
    failed: "The server could not start",
    failedDetail: "Quit Locoris Server and open it again. Diagnostic details are saved locally.",
    diagnostics: "Diagnostics"
  };
  const failed = state === "failed";
  const title = failed ? copy.failed : copy.starting;
  const description = failed ? copy.failedDetail : copy.startingDetail;
  const diagnostic = failed && detail
    ? `<div class="diagnostic"><strong>${escapeHtml(copy.diagnostics)}</strong><span>${escapeHtml(detail)}</span></div>`
    : "";
  return `<!doctype html>
<html lang="${copy.locale ?? "en"}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:" />
    <title>${escapeHtml(copy.title)}</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; color: #f7f4fb; background: #090d18; overflow: hidden; }
      body::before { content: ""; position: fixed; inset: -22%; background: radial-gradient(circle at 24% 34%, rgba(115, 237, 218, .2), transparent 28%), radial-gradient(circle at 76% 66%, rgba(197, 118, 237, .22), transparent 30%), radial-gradient(circle at 62% 20%, rgba(255, 213, 122, .14), transparent 24%); filter: blur(42px); animation: drift 8s ease-in-out infinite alternate; }
      main { position: relative; width: min(620px, calc(100vw - 48px)); padding: 42px; border: 1px solid rgba(154, 225, 221, .3); border-radius: 28px; background: linear-gradient(145deg, rgba(33, 51, 68, .84), rgba(25, 24, 47, .9)); box-shadow: 0 30px 90px rgba(0, 0, 0, .45), inset 0 1px rgba(255, 255, 255, .12); backdrop-filter: blur(28px); }
      .brand { margin: 0 0 14px; color: #91f4df; font-size: 13px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; }
      h1 { margin: 0; font-size: clamp(28px, 4vw, 42px); line-height: 1.04; letter-spacing: 0; }
      p { margin: 18px 0 0; max-width: 48ch; color: #b9c2d8; font-size: 17px; line-height: 1.55; }
      .orbit { width: 62px; height: 62px; margin-bottom: 28px; border: 1px solid rgba(145, 244, 223, .5); border-radius: 50%; position: relative; animation: spin 2.4s linear infinite; }
      .orbit::before, .orbit::after { content: ""; position: absolute; border-radius: 50%; }
      .orbit::before { inset: 10px -8px; border: 2px solid rgba(217, 151, 239, .65); transform: rotate(52deg); }
      .orbit::after { width: 10px; height: 10px; top: 1px; left: 25px; background: #ffe29a; box-shadow: 0 0 18px rgba(255, 226, 154, .7); }
      .diagnostic { display: grid; gap: 7px; margin-top: 24px; padding: 16px 18px; border: 1px solid rgba(255, 142, 170, .36); border-radius: 16px; background: rgba(75, 27, 48, .28); color: #f3b9ca; font-size: 13px; line-height: 1.45; overflow-wrap: anywhere; }
      @keyframes spin { to { transform: rotate(360deg); } }
      @keyframes drift { to { transform: translate3d(4%, -3%, 0) scale(1.05); } }
      @media (prefers-reduced-motion: reduce) { .orbit, body::before { animation: none; } }
    </style>
  </head>
  <body><main><div class="orbit" aria-hidden="true"></div><div class="brand">Locoris Server</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p>${diagnostic}</main></body>
</html>`;
}

async function writeLog(event, detail = "") {
  try {
    if (!logFile) {
      const logsDir = app.getPath("logs");
      await mkdir(logsDir, { recursive: true });
      logFile = path.join(logsDir, "locoris-server.log");
    }
    const suffix = detail ? `: ${detail}` : "";
    await appendFile(logFile, `${new Date().toISOString()} ${event}${suffix}\n`, "utf8");
  } catch {
    // Logging must never prevent the server shell from opening.
  }
}

function showWindow() {
  if (smokeTest) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.show();
  mainWindow.focus();
}

async function loadLaunchPage(state, detail = "") {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const document = renderLaunchPage(state, detail);
  await mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(document)}`);
  showWindow();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: labels?.title ?? "Locoris Server",
    width: 1040,
    height: 780,
    minWidth: 680,
    minHeight: 560,
    show: false,
    backgroundColor: "#090d18",
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
  mainWindow.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  const revealFallback = setTimeout(showWindow, 1_200);
  revealFallback.unref?.();
  mainWindow.once("ready-to-show", () => {
    clearTimeout(revealFallback);
    showWindow();
  });
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
        click: showWindow
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

async function createTray() {
  try {
    const trayIcon = nativeImage.createFromPath(path.join(runtimeRoot, "icon.png"));
    if (trayIcon.isEmpty()) {
      throw new Error("LOCORIS_SERVER_TRAY_ICON_EMPTY");
    }
    tray = new Tray(trayIcon.resize({ width: 20, height: 20 }));
    tray.setToolTip(labels.title);
    tray.on("double-click", showWindow);
    updateTrayMenu();
  } catch (error) {
    await writeLog("tray-unavailable", error instanceof Error ? error.message : String(error));
  }
}

async function startServerRuntime() {
  const port = await reservePort(Number(process.env.PORT) || 8787);
  const expectedBaseUrl = `http://127.0.0.1:${port}`;
  process.env.PORT = String(port);
  process.env.LOCORIS_DESKTOP_SERVER = "1";
  process.env.SYNC_PRINT_QR = "0";
  process.env.SYNC_PRINT_PAIRING_DETAILS = "0";
  process.env.SYNC_PUBLIC_URL = process.env.SYNC_PUBLIC_URL || expectedBaseUrl;
  process.env.SYNC_DATA_DIR = process.env.SYNC_DATA_DIR || path.join(app.getPath("userData"), "Server Data");

  const runtime = await import(pathToFileURL(path.join(runtimeRoot, "server.mjs")).href);
  closeServer = runtime.closePersonalServer;
  const ready = await runtime.personalServerReady;
  const baseUrl = ready.baseUrl || expectedBaseUrl;
  await waitForServer(baseUrl);
  await mainWindow.loadURL(ready.bootstrapUrl || baseUrl);
  showWindow();
  await writeLog("server-ready", new URL(baseUrl).origin);

  if (smokeTest) {
    await writeLog("packaged-smoke-test-passed");
    quitting = true;
    await Promise.resolve(closeServer?.()).catch(() => undefined);
    serverClosed = true;
    app.exit(0);
  }
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

async function initializeDesktop() {
  const isRussian = app.getLocale().toLowerCase().startsWith("ru");
  labels = isRussian
    ? {
        locale: "ru",
        show: "Открыть Locoris Server",
        autostart: "Запускать при входе в систему",
        quit: "Завершить сервер",
        title: "Locoris Server",
        starting: "Запускаем приватную синхронизацию",
        startingDetail: "Подготавливаем защищённое локальное хранилище и панель подключения.",
        failed: "Не удалось запустить сервер",
        failedDetail: "Заверши Locoris Server и открой его снова. Диагностика сохранена локально.",
        diagnostics: "Диагностика"
      }
    : {
        locale: "en",
        show: "Open Locoris Server",
        autostart: "Start at system login",
        quit: "Quit server",
        title: "Locoris Server",
        starting: "Starting your private sync server",
        startingDetail: "Preparing secure local storage and the connection panel.",
        failed: "The server could not start",
        failedDetail: "Quit Locoris Server and open it again. Diagnostic details are saved locally.",
        diagnostics: "Diagnostics"
      };

  createWindow();
  await loadLaunchPage("starting");
  await writeLog("desktop-shell-starting", `electron=${process.versions.electron}; platform=${process.platform}-${process.arch}`);
  await createTray();

  try {
    await startServerRuntime();
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    await writeLog("startup-failed", message);
    await loadLaunchPage("failed", error instanceof Error ? error.message : String(error));
    if (smokeTest) {
      quitting = true;
      await Promise.resolve(closeServer?.()).catch(() => undefined);
      serverClosed = true;
      app.exit(1);
    } else {
      dialog.showErrorBox(labels.title, error instanceof Error ? error.message : String(error));
    }
  }

  app.on("activate", showWindow);
  app.on("window-all-closed", () => undefined);
}

const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) {
  app.quit();
} else {
  app.on("second-instance", showWindow);
  void app.whenReady()
    .then(initializeDesktop)
    .catch(async (error) => {
      const message = error instanceof Error ? error.stack || error.message : String(error);
      await writeLog("desktop-initialization-failed", message);
      app.exit(1);
    });
}
