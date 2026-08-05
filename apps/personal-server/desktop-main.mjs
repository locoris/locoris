import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from "electron";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  DEFAULT_LOCORIS_SERVER_PORT,
  MAX_USER_SERVER_PORT,
  MIN_USER_SERVER_PORT,
  normalizeServerPort,
  probeDesktopServerPort,
  readDesktopServerPortConfig,
  resolveDesktopServerPort,
  saveDesktopServerPortConfig
} from "./desktop-port.mjs";
import { getServerLocalePack } from "./locales/index.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const runtimeRoot = path.join(root, "dist-server");
const smokeTest = process.env.LOCORIS_DESKTOP_SMOKE_TEST === "1";
const explicitPortFromEnvironment = process.env.PORT?.trim() || null;
const publicUrlFromEnvironment = process.env.SYNC_PUBLIC_URL?.trim() || null;
let labels = null;

let mainWindow = null;
let tray = null;
let quitting = false;
let closeServer = null;
let serverClosed = false;
let serverShutdownPending = false;
let logFile = null;
let activeServerPort = null;
let portStateFile = null;

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
    diagnostics: "Diagnostics",
    portConflict: "The listening port is already in use",
    portConflictDetail: "Locoris Server will not switch to a random address. Stop the other service or choose another port.",
    listeningPort: "Listening port",
    portRange: `Use a port from ${MIN_USER_SERVER_PORT} to ${MAX_USER_SERVER_PORT}.`,
    restartOnPort: "Save and restart",
    retry: "Try again",
    environmentPort: "This port is controlled by the PORT environment variable. Change it in your service configuration and restart Locoris Server."
  };
  const portConflict = state === "port-conflict";
  const failed = state === "failed";
  const title = portConflict ? copy.portConflict : failed ? copy.failed : copy.starting;
  const description = portConflict ? copy.portConflictDetail : failed ? copy.failedDetail : copy.startingDetail;
  const occupiedPort = Number(String(detail).split(":").at(-1)) || DEFAULT_LOCORIS_SERVER_PORT;
  const diagnostic = failed && detail
    ? `<div class="diagnostic"><strong>${escapeHtml(copy.diagnostics)}</strong><span>${escapeHtml(detail)}</span></div>`
    : "";
  const conflictControls = portConflict
    ? `<div class="port-panel">
        <label for="port-input">${escapeHtml(copy.listeningPort)}</label>
        <div class="port-row">
          <input id="port-input" type="number" inputmode="numeric" min="${MIN_USER_SERVER_PORT}" max="${MAX_USER_SERVER_PORT}" value="${occupiedPort}" />
          <button id="port-save" type="button">${escapeHtml(copy.restartOnPort)}</button>
        </div>
        <span class="port-hint" id="port-hint">${escapeHtml(copy.portRange)}</span>
        <button class="retry-action" id="port-retry" type="button">${escapeHtml(copy.retry)}</button>
      </div>`
    : "";
  return `<!doctype html>
<html lang="${copy.locale ?? "en"}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:" />
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
      .port-panel { display: grid; gap: 12px; margin-top: 26px; padding: 20px; border: 1px solid rgba(145, 244, 223, .28); border-radius: 18px; background: rgba(5, 10, 22, .44); }
      .port-panel label { color: #dce5f6; font-size: 13px; font-weight: 800; }
      .port-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; }
      .port-row input, .port-row button, .retry-action { min-height: 48px; border-radius: 14px; font: inherit; }
      .port-row input { min-width: 0; padding: 0 15px; border: 1px solid rgba(185, 194, 216, .28); color: #fff; background: rgba(8, 13, 27, .76); outline: none; }
      .port-row input:focus { border-color: rgba(145, 244, 223, .74); box-shadow: 0 0 0 4px rgba(145, 244, 223, .1); }
      .port-row button { padding: 0 18px; border: 1px solid rgba(145, 244, 223, .6); color: #07131b; font-weight: 850; background: linear-gradient(135deg, #ffe29a, #91f4df); cursor: pointer; }
      .port-row button:disabled { opacity: .55; cursor: wait; }
      .port-hint { color: #aab5cb; font-size: 12px; line-height: 1.45; }
      .port-hint.is-error { color: #ffb0c4; }
      .retry-action { justify-self: start; padding: 0; border: 0; color: #91f4df; font-weight: 800; background: transparent; cursor: pointer; }
      @keyframes spin { to { transform: rotate(360deg); } }
      @keyframes drift { to { transform: translate3d(4%, -3%, 0) scale(1.05); } }
      @media (prefers-reduced-motion: reduce) { .orbit, body::before { animation: none; } }
    </style>
  </head>
  <body><main><div class="orbit" aria-hidden="true"></div><div class="brand">Locoris Server</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p>${diagnostic}${conflictControls}</main>
  ${portConflict ? `<script>
    (() => {
      const bridge = window.locorisServerDesktop;
      const input = document.getElementById("port-input");
      const save = document.getElementById("port-save");
      const retry = document.getElementById("port-retry");
      const hint = document.getElementById("port-hint");
      if (!bridge) return;
      bridge.getNetworkSettings().then((settings) => {
        if (!settings.environmentManaged) return;
        input.disabled = true;
        save.disabled = true;
        hint.textContent = ${JSON.stringify(copy.environmentPort)};
      });
      save.addEventListener("click", async () => {
        save.disabled = true;
        hint.classList.remove("is-error");
        const result = await bridge.applyNetworkPort(Number(input.value));
        if (!result?.ok) {
          hint.textContent = result?.message || ${JSON.stringify(copy.portRange)};
          hint.classList.add("is-error");
          save.disabled = false;
        }
      });
      retry.addEventListener("click", () => bridge.restart());
    })();
  </script>` : ""}</body>
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
      sandbox: true,
      preload: path.join(root, "desktop-preload.mjs")
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

function prepareEnvironmentForRelaunch() {
  if (!explicitPortFromEnvironment) {
    delete process.env.PORT;
  }
  if (!publicUrlFromEnvironment) {
    delete process.env.SYNC_PUBLIC_URL;
  }
}

function restartDesktop() {
  prepareEnvironmentForRelaunch();
  quitting = true;
  app.relaunch();
  app.quit();
}

function registerNetworkIpc() {
  ipcMain.handle("locoris-server:network:get", async () => {
    const persisted = await readDesktopServerPortConfig(portStateFile);
    const environmentPort = normalizeServerPort(explicitPortFromEnvironment);
    return {
      defaultPort: DEFAULT_LOCORIS_SERVER_PORT,
      listeningPort: activeServerPort ?? environmentPort ?? persisted.port,
      configuredPort: environmentPort ?? persisted.port,
      source: environmentPort ? "environment" : persisted.source,
      environmentManaged: Boolean(environmentPort),
      publicUrl: publicUrlFromEnvironment,
      minimumPort: MIN_USER_SERVER_PORT,
      maximumPort: MAX_USER_SERVER_PORT
    };
  });

  ipcMain.handle("locoris-server:network:apply-port", async (_event, payload) => {
    if (explicitPortFromEnvironment) {
      return { ok: false, code: "PORT_ENVIRONMENT_MANAGED", message: labels.environmentPort };
    }

    const port = normalizeServerPort(payload?.port, { userSelectable: true });
    if (!port) {
      return { ok: false, code: "PORT_INVALID", message: labels.portRange };
    }

    if (port !== activeServerPort && !(await probeDesktopServerPort(port))) {
      return { ok: false, code: "PORT_IN_USE", message: labels.portStillInUse.replace("{port}", String(port)) };
    }

    await saveDesktopServerPortConfig(portStateFile, port);
    setTimeout(restartDesktop, 180).unref?.();
    return { ok: true, restarting: true };
  });

  ipcMain.handle("locoris-server:restart", () => {
    setTimeout(restartDesktop, 80).unref?.();
    return { ok: true };
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
  const explicitPort = explicitPortFromEnvironment;
  const port = await resolveDesktopServerPort({
    stateFile: portStateFile,
    explicitPort
  });
  activeServerPort = port;
  const expectedBaseUrl = `http://127.0.0.1:${port}`;
  process.env.PORT = String(port);
  process.env.LOCORIS_DESKTOP_SERVER = "1";
  process.env.LOCORIS_DESKTOP_PUBLIC_URL_AUTOMATIC = publicUrlFromEnvironment ? "0" : "1";
  process.env.SYNC_PRINT_QR = "0";
  process.env.SYNC_PRINT_PAIRING_DETAILS = "0";
  process.env.SYNC_PUBLIC_URL = publicUrlFromEnvironment || expectedBaseUrl;
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
  labels = getServerLocalePack(app.getLocale()).desktop;

  portStateFile = path.join(app.getPath("userData"), "desktop-server.json");
  registerNetworkIpc();

  createWindow();
  await loadLaunchPage("starting");
  await writeLog("desktop-shell-starting", `electron=${process.versions.electron}; platform=${process.platform}-${process.arch}`);
  await createTray();

  try {
    await startServerRuntime();
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    await writeLog("startup-failed", message);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isPortConflict = errorMessage.startsWith("LOCORIS_SERVER_PORT_IN_USE:");
    await loadLaunchPage(isPortConflict ? "port-conflict" : "failed", errorMessage);
    if (smokeTest) {
      quitting = true;
      await Promise.resolve(closeServer?.()).catch(() => undefined);
      serverClosed = true;
      app.exit(1);
    } else if (!isPortConflict) {
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
