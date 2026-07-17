import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import qrcode from "qrcode-terminal";
import QRCode from "qrcode";

import {
  applyChangeSetToSnapshot,
  buildChangeSetFromSnapshots,
  collapseChangeSets,
  collectBody,
  createEmptyChangeSet,
  fileExists,
  getBearerToken,
  handleOptimisticSyncRoute,
  isChangeSetEmpty,
  isEncryptedEnvelope,
  normalizeEncryptedPayload,
  normalizeChangeSet,
  sendCorsNoContent,
  sendJson,
  sendText,
  serveStaticAsset
} from "../../packages/sync-core/common.mjs";
import {
  PersonalServerStorage,
  hashToken,
  sanitizeDisplayName,
  sanitizeVaultId
} from "./personal-server-storage.mjs";
import { VaultFileStore } from "./vault-file-store.mjs";

const PORT = Number.parseInt(process.env.PORT ?? "8787", 10);
const SERVER_FILE = fileURLToPath(import.meta.url);
const SERVER_DIR = path.dirname(SERVER_FILE);
const IS_DIRECT_RUN = process.argv[1] ? path.resolve(process.argv[1]) === SERVER_FILE : false;
const PUBLIC_URL = String(process.env.SYNC_PUBLIC_URL ?? "").trim().replace(/\/+$/, "");
const PRINT_PAIRING_QR = process.env.SYNC_PRINT_QR !== "0";
const BOOTSTRAP_INVITE_TTL_MS = 24 * 60 * 60 * 1000;
const PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CONFIRMATION_WORDS = [
  "AURORA",
  "EMBER",
  "FOREST",
  "HARBOR",
  "LUMEN",
  "MINT",
  "NOVA",
  "ORBIT",
  "RIVER",
  "SOLAR",
  "VELVET",
  "WAVE"
];

function resolveDefaultDataDir() {
  const home = os.homedir();

  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Locoris", "Personal Server");
  }

  if (process.platform === "win32") {
    const baseDir = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    return path.join(baseDir, "Locoris", "Personal Server");
  }

  const baseDir = process.env.XDG_DATA_HOME || path.join(home, ".local", "share");
  return path.join(baseDir, "locoris", "personal-server");
}

function listDesktopNetworkUrls(port) {
  if (process.env.LOCORIS_DESKTOP_SERVER !== "1") {
    return [];
  }

  const urls = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) {
        urls.push(`http://${entry.address}:${port}`);
      }
    }
  }
  return [...new Set(urls)].sort();
}

function isLoopbackRequest(request) {
  const address = request.socket.remoteAddress ?? "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

const DATA_DIR = process.env.SYNC_DATA_DIR
  ? path.resolve(process.env.SYNC_DATA_DIR)
  : resolveDefaultDataDir();
const STATIC_DIR = path.join(SERVER_DIR, "public");
const LEGACY_SYNC_TOKEN = String(process.env.SYNC_TOKEN ?? "").trim();
const ENV_MANAGEMENT_TOKEN = String(process.env.SYNC_MANAGEMENT_TOKEN ?? "").trim();
const JOURNAL_MAX_BYTES = process.env.SYNC_JOURNAL_MAX_BYTES;

function createVaultSyncToken(vaultId) {
  return `zpt_${vaultId}_${randomUUID().replace(/-/g, "")}`;
}

function createPairingSecret(prefix) {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

function createPairingCode() {
  const bytes = randomBytes(8);
  let code = "";
  for (let index = 0; index < bytes.length; index += 1) {
    code += PAIRING_CODE_ALPHABET[bytes[index] % PAIRING_CODE_ALPHABET.length];
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

function normalizePairingCode(value) {
  return String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function createConfirmationCode() {
  const bytes = randomBytes(3);
  const first = CONFIRMATION_WORDS[bytes[0] % CONFIRMATION_WORDS.length];
  const second = CONFIRMATION_WORDS[bytes[1] % CONFIRMATION_WORDS.length];
  const number = String((bytes[2] % 90) + 10);
  return `${first} · ${second} · ${number}`;
}

function encodeConnectionPackage(payload) {
  return `lcrs1_${Buffer.from(JSON.stringify({ v: 1, ...payload }), "utf8").toString("base64url")}`;
}

function buildConnectionLink(serverUrl, invite) {
  const connectionPackage = encodeConnectionPackage({
    serverUrl,
    secret: invite.secret,
    code: invite.code,
    serverId: storage.getConfig().serverId
  });
  return {
    connectionPackage,
    url: `${serverUrl}/connect#lcrs=${encodeURIComponent(connectionPackage)}`
  };
}

function sanitizeDeviceName(value) {
  return sanitizeDisplayName(value, "Locoris device").slice(0, 120);
}

function sanitizePlatform(value) {
  return sanitizeDisplayName(value, "Unknown platform").slice(0, 80);
}

function createInviteMaterial(input) {
  const code = createPairingCode();
  const secret = createPairingSecret("zpi");
  const invite = storage.createPairingInvite({
    ...input,
    code: normalizePairingCode(code),
    secret
  });
  return { ...invite, code, secret };
}

function buildVaultList(registry) {
  return registry.vaults
    .map((vault) => ({
      ...vault,
      tokenCount: registry.tokens.filter((token) => token.vaultId === vault.id).length
    }))
    .sort((left, right) => left.createdAt - right.createdAt);
}

function buildTokenMeta(token) {
  return {
    id: token.id,
    vaultId: token.vaultId,
    label: token.label,
    createdAt: token.createdAt,
    lastUsedAt: token.lastUsedAt ?? null
  };
}

function buildSnapshotFallbackFeed(envelope) {
  return {
    mode: "snapshot",
    revision: envelope.revision,
    baseRevision: null,
    changes: null,
    encryptedChanges: null,
    snapshot: isEncryptedEnvelope(envelope) ? null : envelope.snapshot,
    metadata: envelope.metadata ?? null
  };
}

function resolveEnvelopeVaultKind(envelope) {
  return envelope?.metadata?.payloadMode === "encrypted" ? "private" : "regular";
}

const SETUP_PAGE_COPY = {
  en: {
    title: "Locoris Personal Server",
    eyebrow: "Locoris Personal Server",
    heroTitle: "Your private sync space is ready.",
    heroDescription: "Connect Locoris with a one-time invitation. The permanent recovery token stays on the server.",
    inviteEyebrow: "One-time invitation",
    inviteTitle: "Connect this device",
    inviteDescription: "Open Locoris directly, copy the invitation link, or enter the short code with the server address. The QR is only a shortcut.",
    setupCode: "One-time setup code",
    qrAlt: "QR code for this one-time Locoris invitation",
    qrCaption: "Scan from a phone or tablet",
    openLocoris: "Open in Locoris",
    copyLink: "Copy invitation link",
    packageSummary: "Connection package for manual paste",
    copyPackage: "Copy package",
    serverSetup: "Server setup",
    storageBackend: "Storage backend",
    storageValue: "SQLite metadata + atomic vault files",
    pairing: "Pairing",
    ownerConnected: "Owner device connected",
    waitingOwner: "Waiting for the first owner device",
    networkAccess: "Network access",
    networkValue: "Protected by per-device credentials",
    reachableAddresses: "Addresses for devices on this network",
    dataVolume: "Data volume",
    backupComplete: "Back up the complete server data directory",
    snapshots: "Vault snapshots and bounded delta journals live in vaults/",
    legacy: "Legacy JSON metadata is imported once and archived under legacy-json/",
    privateVaults: "Private vault passphrases and plaintext never reach the server",
    copiedLink: "Invitation link copied.",
    copyAddress: "Copy the address from your browser.",
    copiedPackage: "Connection package copied.",
    copySelection: "Copy the selected connection package.",
    useInvite: "Use invitation link"
  },
  ru: {
    title: "Персональный сервер Locoris",
    eyebrow: "Персональный сервер Locoris",
    heroTitle: "Личное пространство синхронизации готово.",
    heroDescription: "Подключи Locoris одноразовым приглашением. Постоянный recovery token останется только на сервере.",
    inviteEyebrow: "Одноразовое приглашение",
    inviteTitle: "Подключить это устройство",
    inviteDescription: "Открой Locoris, скопируй ссылку или введи короткий код вместе с адресом сервера. QR нужен только для ускорения.",
    setupCode: "Одноразовый код подключения",
    qrAlt: "QR-код одноразового приглашения Locoris",
    qrCaption: "Отсканируй с телефона или планшета",
    openLocoris: "Открыть в Locoris",
    copyLink: "Скопировать приглашение",
    packageSummary: "Пакет для ручной вставки",
    copyPackage: "Скопировать пакет",
    serverSetup: "Состояние сервера",
    storageBackend: "Хранение данных",
    storageValue: "SQLite-метаданные + атомарные файлы хранилищ",
    pairing: "Подключение",
    ownerConnected: "Устройство владельца подключено",
    waitingOwner: "Ожидается первое устройство владельца",
    networkAccess: "Сетевой доступ",
    networkValue: "Защищён отдельными credentials устройств",
    reachableAddresses: "Адреса для устройств в этой сети",
    dataVolume: "Данные сервера",
    backupComplete: "Создавай резервную копию всей папки данных сервера",
    snapshots: "Снимки хранилищ и ограниченные delta-журналы находятся в vaults/",
    legacy: "Старые JSON-метаданные один раз импортируются и архивируются в legacy-json/",
    privateVaults: "Кодовые фразы и открытые данные приватных хранилищ не попадают на сервер",
    copiedLink: "Ссылка-приглашение скопирована.",
    copyAddress: "Скопируй адрес из браузера.",
    copiedPackage: "Пакет подключения скопирован.",
    copySelection: "Скопируй выделенный пакет подключения.",
    useInvite: "Используй ссылку-приглашение"
  }
};

function renderSetupPage(storage, language = "en", networkUrls = [], qrDataUrl = "") {
  const locale = language === "ru" ? "ru" : "en";
  const copy = SETUP_PAGE_COPY[locale];
  const clientCopy = JSON.stringify({
    copiedLink: copy.copiedLink,
    copyAddress: copy.copyAddress,
    copiedPackage: copy.copiedPackage,
    copySelection: copy.copySelection,
    useInvite: copy.useInvite
  });
  return `<!doctype html>
<html lang="${locale}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'unsafe-inline'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'" />
    <title>${copy.title}</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <main class="shell">
      <section class="hero">
        <span class="eyebrow">${copy.eyebrow}</span>
        <h1>${copy.heroTitle}</h1>
        <p>${copy.heroDescription}</p>
      </section>

      <section class="card connection-card" id="connection-card" hidden>
        <span class="eyebrow">${copy.inviteEyebrow}</span>
        <h2>${copy.inviteTitle}</h2>
        <p class="connection-copy">${copy.inviteDescription}</p>
        <div class="pairing-code-shell">
          <span>${copy.setupCode}</span>
          <strong id="pairing-code">••••-••••</strong>
        </div>
        ${qrDataUrl ? `
        <figure class="pairing-qr">
          <img src="${qrDataUrl}" alt="${copy.qrAlt}" width="216" height="216" />
          <figcaption>${copy.qrCaption}</figcaption>
        </figure>` : ""}
        <div class="connection-actions">
          <button type="button" class="primary-action" id="open-locoris">${copy.openLocoris}</button>
          <button type="button" class="secondary-action" id="copy-link">${copy.copyLink}</button>
        </div>
        <details class="connection-details">
          <summary>${copy.packageSummary}</summary>
          <code class="connection-package" id="connection-package"></code>
          <button type="button" class="text-action" id="copy-package">${copy.copyPackage}</button>
        </details>
        <p class="copy-status" id="copy-status" aria-live="polite"></p>
      </section>

      <section class="card">
        <h2>${copy.serverSetup}</h2>
        <dl class="details">
          <div>
            <dt>${copy.storageBackend}</dt>
            <dd>${copy.storageValue}</dd>
          </div>
          <div>
            <dt>${copy.pairing}</dt>
            <dd>${storage.countActiveOwnerDevices() > 0 ? copy.ownerConnected : copy.waitingOwner}</dd>
          </div>
          <div>
            <dt>${copy.networkAccess}</dt>
            <dd>${copy.networkValue}</dd>
          </div>
          ${networkUrls.length > 0 ? `
          <div>
            <dt>${copy.reachableAddresses}</dt>
            <dd>${networkUrls.map((url) => `<code>${url}</code>`).join("<br />")}</dd>
          </div>` : ""}
        </dl>
      </section>

      <section class="card">
        <h2>${copy.dataVolume}</h2>
        <ul class="feature-list">
          <li>${copy.backupComplete}</li>
          <li>${copy.snapshots}</li>
          <li>${copy.legacy}</li>
          <li>${copy.privateVaults}</li>
        </ul>
      </section>
    </main>
    <script>
      (() => {
        const copy = ${clientCopy};
        const params = new URLSearchParams(window.location.hash.slice(1));
        const payload = params.get("lcrs");
        if (!payload) return;
        const card = document.getElementById("connection-card");
        const output = document.getElementById("connection-package");
        const status = document.getElementById("copy-status");
        const pairingCode = document.getElementById("pairing-code");
        card.hidden = false;
        output.textContent = payload;
        try {
          const encoded = payload.replace(/^lcrs1_/, "").replace(/-/g, "+").replace(/_/g, "/");
          const decoded = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=")));
          pairingCode.textContent = decoded.code || "••••-••••";
        } catch {
          pairingCode.textContent = copy.useInvite;
        }
        document.getElementById("open-locoris").addEventListener("click", () => {
          window.location.href = "locoris://self-hosted/connect?payload=" + encodeURIComponent(payload);
        });
        document.getElementById("copy-link").addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(window.location.href);
            status.textContent = copy.copiedLink;
          } catch {
            status.textContent = copy.copyAddress;
          }
        });
        document.getElementById("copy-package").addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(payload);
            status.textContent = copy.copiedPackage;
          } catch {
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(output);
            selection.removeAllRanges();
            selection.addRange(range);
            status.textContent = copy.copySelection;
          }
        });
      })();
    </script>
  </body>
</html>`;
}

const storage = new PersonalServerStorage(DATA_DIR, {
  managementToken: ENV_MANAGEMENT_TOKEN,
  legacySyncToken: LEGACY_SYNC_TOKEN
});
const vaultFiles = new VaultFileStore(DATA_DIR, {
  journalMaxBytes: JOURNAL_MAX_BYTES
});

await vaultFiles.initialize();
const bootstrap = await storage.initialize();
await vaultFiles.recoverInterruptedDeletions(bootstrap.registry.vaults.map((vault) => vault.id));
const bootstrapPairingInvite =
  storage.countActiveOwnerDevices() === 0
    ? createInviteMaterial({
        kind: "bootstrap",
        role: "owner",
        label: "First owner device",
        requiresApproval: false,
        maxUses: 1,
        expiresAt: Date.now() + BOOTSTRAP_INVITE_TTL_MS,
        vaultAccess: []
      })
    : null;

let resolvePersonalServerReady;
let rejectPersonalServerReady;
export const personalServerReady = new Promise((resolve, reject) => {
  resolvePersonalServerReady = resolve;
  rejectPersonalServerReady = reject;
});
for (const vault of bootstrap.registry.vaults) {
  const stateFileExists = await fileExists(vaultFiles.getStateFile(vault.id));
  if (!stateFileExists && vault.lastRevision) {
    throw new Error(
      `INCOMPLETE_DATA_VOLUME: vault snapshot is missing for ${vault.id}; restore the complete data-volume backup`
    );
  }

  await vaultFiles.ensureVault(vault.id);
  const envelope = await vaultFiles.readEnvelope(vault.id);
  if (envelope.revision && envelope.revision !== vault.lastRevision) {
    storage.updateVaultMeta(vault.id, {
      lastRevision: envelope.revision,
      vaultKind: resolveEnvelopeVaultKind(envelope)
    });
  }
}

async function createVault(payload) {
  return vaultFiles.withManagementLock(async () => {
    const name = sanitizeDisplayName(payload?.name, "New vault");
    const requestedId = sanitizeVaultId(payload?.id ?? "");
    const vaultId = requestedId || sanitizeVaultId(name) || `vault-${randomUUID().slice(0, 8)}`;

    if (storage.getVault(vaultId)) {
      return { statusCode: 409, error: "VAULT_ALREADY_EXISTS" };
    }

    await vaultFiles.ensureVault(vaultId);
    return storage.createVault({ id: vaultId, name, vaultKind: "regular" });
  });
}

async function renameVault(vaultId, nextName) {
  return vaultFiles.withManagementLock(() =>
    vaultFiles.withVaultLock(vaultId, async () => {
      if (!storage.getVault(vaultId)) {
        return { statusCode: 404, error: "VAULT_NOT_FOUND" };
      }

      const previousEnvelope = await vaultFiles.syncEnvelopeName(vaultId, nextName);

      try {
        const vault = storage.renameVault(vaultId, nextName);
        return { statusCode: 200, vault };
      } catch (error) {
        if (previousEnvelope) {
          await vaultFiles.writeEnvelope(vaultId, previousEnvelope);
        }
        throw error;
      }
    })
  );
}

async function deleteVault(vaultId) {
  return vaultFiles.withManagementLock(() =>
    vaultFiles.withVaultLock(vaultId, async () => {
      if (!storage.getVault(vaultId)) {
        return { statusCode: 404, error: "VAULT_NOT_FOUND" };
      }

      if (storage.getRegistry().vaults.length <= 1) {
        return { statusCode: 409, error: "LAST_VAULT_REQUIRED" };
      }

      const staged = await vaultFiles.stageDeletion(vaultId);

      try {
        const result = storage.deleteVault(vaultId);
        if (result.error) {
          await vaultFiles.restoreDeletion(staged);
          return result;
        }
        await vaultFiles.finalizeDeletion(staged).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`Vault ${vaultId} was deleted; deferred trash cleanup: ${message}`);
        });
        return result;
      } catch (error) {
        await vaultFiles.restoreDeletion(staged);
        throw error;
      }
    })
  );
}

async function issueVaultToken(vaultId, labelValue, deviceId = null) {
  return vaultFiles.withManagementLock(async () => {
    if (!storage.getVault(vaultId)) {
      return { statusCode: 404, error: "VAULT_NOT_FOUND" };
    }

    const tokenValue = createVaultSyncToken(vaultId);
    const label = sanitizeDisplayName(labelValue, "Client token");
    const result = storage.issueVaultToken(vaultId, label, tokenValue, deviceId);

    return {
      ...result,
      token: tokenValue,
      tokenMeta: result.tokenRecord ? buildTokenMeta(result.tokenRecord) : null
    };
  });
}

async function handleChangesRoute({ request, response, url, vaultId }) {
  await vaultFiles.withVaultLock(vaultId, async () => {
    const vault = storage.getVault(vaultId);
    if (!vault) {
      sendJson(response, 404, { error: "VAULT_NOT_FOUND" });
      return;
    }

    const tokenRecord = storage.findVaultToken(vaultId, getBearerToken(request));
    if (!tokenRecord) {
      sendJson(response, 401, { error: "UNAUTHORIZED" });
      return;
    }

    if (request.method === "POST" && !storage.canVaultTokenWrite(tokenRecord)) {
      sendJson(response, 403, { error: "VAULT_READ_ONLY" });
      return;
    }

    storage.markTokenUsed(tokenRecord.id);
    const currentEnvelope = await vaultFiles.readEnvelope(vaultId);

    if (request.method === "GET") {
      const sinceRevision = url.searchParams.get("since")?.trim() ?? "";

      if (!sinceRevision || !currentEnvelope.revision) {
        sendJson(response, 200, buildSnapshotFallbackFeed(currentEnvelope));
        return;
      }

      if (sinceRevision === currentEnvelope.revision) {
        sendJson(response, 200, {
          mode: "delta",
          revision: currentEnvelope.revision,
          baseRevision: sinceRevision,
          changes:
            currentEnvelope.metadata?.payloadMode === "encrypted"
              ? null
              : createEmptyChangeSet("server"),
          encryptedChanges: currentEnvelope.metadata?.payloadMode === "encrypted" ? [] : null,
          snapshot: null,
          metadata: currentEnvelope.metadata ?? null
        });
        return;
      }

      const journal = await vaultFiles.readJournal(vaultId);
      const cursorIndex = journal.findIndex((entry) => entry.revision === sinceRevision);

      if (cursorIndex === -1 || journal.at(-1)?.revision !== currentEnvelope.revision) {
        sendJson(response, 200, buildSnapshotFallbackFeed(currentEnvelope));
        return;
      }

      if (currentEnvelope.metadata?.payloadMode === "encrypted") {
        const entries = journal.slice(cursorIndex + 1);
        const batches = entries.map((entry) => entry.encryptedChanges).filter(Boolean);

        if (batches.length !== entries.length) {
          sendJson(response, 200, buildSnapshotFallbackFeed(currentEnvelope));
          return;
        }

        sendJson(response, 200, {
          mode: "delta",
          revision: currentEnvelope.revision,
          baseRevision: sinceRevision,
          changes: null,
          encryptedChanges: batches,
          snapshot: null,
          metadata: currentEnvelope.metadata ?? null
        });
        return;
      }

      sendJson(response, 200, {
        mode: "delta",
        revision: currentEnvelope.revision,
        baseRevision: sinceRevision,
        changes: collapseChangeSets(journal.slice(cursorIndex + 1).map((entry) => entry.changes)),
        encryptedChanges: null,
        snapshot: null,
        metadata: currentEnvelope.metadata ?? null
      });
      return;
    }

    const payload = await collectBody(request);
    const baseRevision =
      payload && typeof payload === "object" && "baseRevision" in payload
        ? payload.baseRevision ?? null
        : null;
    const rawChanges =
      payload && typeof payload === "object" && "changes" in payload ? payload.changes : null;
    const encryptedChanges =
      payload && typeof payload === "object" && "encryptedChanges" in payload
        ? normalizeEncryptedPayload(payload.encryptedChanges)
        : null;
    const encryptedSnapshot =
      payload && typeof payload === "object" && "encryptedSnapshot" in payload
        ? normalizeEncryptedPayload(payload.encryptedSnapshot)
        : null;
    const metadata =
      payload && typeof payload === "object" && payload.metadata && typeof payload.metadata === "object"
        ? {
            schemaVersion:
              typeof payload.metadata.schemaVersion === "number" ? payload.metadata.schemaVersion : 1,
            payloadMode: payload.metadata.payloadMode === "encrypted" ? "encrypted" : "plain",
            vault:
              payload.metadata.vault && typeof payload.metadata.vault === "object"
                ? payload.metadata.vault
                : null,
            encryption:
              payload.metadata.encryption && typeof payload.metadata.encryption === "object"
                ? payload.metadata.encryption
                : null
          }
        : null;
    const changes = normalizeChangeSet(rawChanges, "server");

    if (currentEnvelope.metadata?.payloadMode === "encrypted") {
      if (!encryptedChanges || !encryptedSnapshot || metadata?.payloadMode !== "encrypted") {
        sendJson(response, 400, { error: "ENCRYPTED_DELTA_PAYLOAD_REQUIRED" });
        return;
      }

      if (currentEnvelope.revision !== baseRevision) {
        sendJson(response, 409, {
          error: "SYNC_REVISION_CONFLICT",
          revision: currentEnvelope.revision
        });
        return;
      }

      const nextEnvelope = {
        revision: `rev-${Date.now()}-${randomUUID()}`,
        encryptedSnapshot,
        metadata
      };

      await vaultFiles.writeEnvelope(vaultId, nextEnvelope);
      await vaultFiles.appendJournalEntry(vaultId, {
        revision: nextEnvelope.revision,
        baseRevision,
        createdAt: Date.now(),
        encryptedChanges
      });
      storage.updateVaultMeta(vaultId, {
        lastRevision: nextEnvelope.revision,
        lastSyncAt: Date.now(),
        vaultKind: "private"
      });
      sendJson(response, 200, { revision: nextEnvelope.revision });
      return;
    }

    if (encryptedChanges || encryptedSnapshot || metadata?.payloadMode === "encrypted") {
      sendJson(response, 409, {
        error: "DELTA_SYNC_UNAVAILABLE",
        revision: currentEnvelope.revision
      });
      return;
    }

    if (currentEnvelope.revision !== baseRevision) {
      sendJson(response, 409, {
        error: "SYNC_REVISION_CONFLICT",
        revision: currentEnvelope.revision
      });
      return;
    }

    if (isChangeSetEmpty(changes)) {
      sendJson(response, 200, { revision: currentEnvelope.revision });
      return;
    }

    const nextSnapshot = applyChangeSetToSnapshot(currentEnvelope.snapshot, changes);
    const nextEnvelope = {
      ...currentEnvelope,
      revision: `rev-${Date.now()}-${randomUUID()}`,
      snapshot: {
        ...nextSnapshot,
        exportedAt: Date.now()
      }
    };

    await vaultFiles.writeEnvelope(vaultId, nextEnvelope);
    await vaultFiles.appendJournalEntry(vaultId, {
      revision: nextEnvelope.revision,
      baseRevision,
      createdAt: Date.now(),
      changes: {
        ...changes,
        exportedAt: nextEnvelope.snapshot.exportedAt
      }
    });
    storage.updateVaultMeta(vaultId, {
      lastRevision: nextEnvelope.revision,
      lastSyncAt: Date.now(),
      vaultKind: "regular"
    });
    sendJson(response, 200, { revision: nextEnvelope.revision });
  });
}

async function handleStateRoute({ request, response, vaultId }) {
  await vaultFiles.withVaultLock(vaultId, async () => {
    const vault = storage.getVault(vaultId);
    if (!vault) {
      sendJson(response, 404, { error: "VAULT_NOT_FOUND" });
      return;
    }

    const tokenRecord = storage.findVaultToken(vaultId, getBearerToken(request));
    if (!tokenRecord) {
      sendJson(response, 401, { error: "UNAUTHORIZED" });
      return;
    }

    if (request.method === "PUT" && !storage.canVaultTokenWrite(tokenRecord)) {
      sendJson(response, 403, { error: "VAULT_READ_ONLY" });
      return;
    }

    storage.markTokenUsed(tokenRecord.id);

    await handleOptimisticSyncRoute({
      request,
      response,
      readEnvelope: () => vaultFiles.readEnvelope(vaultId),
      writeEnvelope: (envelope) => vaultFiles.writeEnvelope(vaultId, envelope),
      onAfterWrite: async (envelope, previousEnvelope) => {
        if (isEncryptedEnvelope(envelope) || isEncryptedEnvelope(previousEnvelope)) {
          await vaultFiles.writeJournal(vaultId, []);
          storage.updateVaultMeta(vaultId, {
            lastRevision: envelope.revision,
            lastSyncAt: Date.now(),
            vaultKind: resolveEnvelopeVaultKind(envelope)
          });
          return;
        }

        const changeSet = buildChangeSetFromSnapshots(previousEnvelope?.snapshot, envelope.snapshot);
        if (!isChangeSetEmpty(changeSet)) {
          await vaultFiles.appendJournalEntry(vaultId, {
            revision: envelope.revision,
            baseRevision: previousEnvelope?.revision ?? null,
            createdAt: Date.now(),
            changes: changeSet
          });
        }

        storage.updateVaultMeta(vaultId, {
          lastRevision: envelope.revision,
          lastSyncAt: Date.now(),
          vaultKind: resolveEnvelopeVaultKind(envelope)
        });
      }
    });
  });
}

const pairingAttemptsByAddress = new Map();

function consumePairingAttempt(request) {
  const address = request.socket.remoteAddress ?? "unknown";
  const timestamp = Date.now();
  const windowMs = 10 * 60 * 1000;
  const entry = pairingAttemptsByAddress.get(address);
  const active = entry && entry.startedAt > timestamp - windowMs ? entry : { startedAt: timestamp, count: 0 };
  active.count += 1;
  pairingAttemptsByAddress.set(address, active);
  return active.count <= 20;
}

function getRequestOrigin(request) {
  if (PUBLIC_URL) {
    return PUBLIC_URL;
  }

  const forwardedProto = String(request.headers["x-forwarded-proto"] ?? "").split(",")[0].trim();
  const protocol = forwardedProto === "https" ? "https" : "http";
  return `${protocol}://${request.headers.host ?? `localhost:${PORT}`}`.replace(/\/+$/, "");
}

function normalizeAdvertisedUrl(value, fallbackUrl) {
  const candidate = String(value ?? "").trim() || fallbackUrl;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("PAIRING_SERVER_URL_INVALID");
  }

  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("PAIRING_SERVER_URL_INVALID");
  }
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/+$/, "");
}

function getManagementPrincipal(request) {
  return storage.findManagementPrincipal(getBearerToken(request));
}

function requireManagementPrincipal(request, response, options = {}) {
  const principal = getManagementPrincipal(request);
  if (!principal) {
    sendJson(response, 401, { error: "UNAUTHORIZED" });
    return null;
  }
  if (options.owner && !storage.canPrincipalManageServer(principal)) {
    sendJson(response, 403, { error: "OWNER_ACCESS_REQUIRED" });
    return null;
  }
  if (
    options.vaultId &&
    !storage.canPrincipalAccessVault(principal, options.vaultId, options.permission ?? "read")
  ) {
    sendJson(response, 403, { error: "VAULT_ACCESS_DENIED" });
    return null;
  }
  return principal;
}

function buildPairingDeviceResponse(device) {
  return {
    id: device.id,
    name: device.name,
    platform: device.platform,
    role: device.role,
    createdAt: device.createdAt,
    lastUsedAt: device.lastUsedAt,
    revokedAt: device.revokedAt,
    vaultAccess: device.vaultAccess
  };
}

function buildAccessOverview(principal) {
  return {
    server: {
      id: storage.getConfig().serverId,
      name: "Locoris Personal Server"
    },
    currentDeviceId: principal.deviceId,
    role: principal.role,
    devices: storage.listDevices().map(buildPairingDeviceResponse),
    invites: storage.listPairingInvites(),
    requests: storage.listPairingRequests()
  };
}

const server = createServer(async (request, response) => {
  try {
    if (!request.url) {
      sendJson(response, 400, { error: "INVALID_REQUEST" });
      return;
    }

    if (request.method === "OPTIONS") {
      sendCorsNoContent(response);
      return;
    }

    const config = storage.getConfig();
    const registry = storage.getRegistry();
    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
    const pathname = url.pathname;

    if ((pathname === "/" || pathname === "/connect") && request.method === "GET") {
      const setupLanguage = String(request.headers["accept-language"] ?? "")
        .toLowerCase()
        .startsWith("ru")
        ? "ru"
        : "en";
      const address = server.address();
      const activePort = address && typeof address === "object" ? address.port : PORT;
      const networkUrls = isLoopbackRequest(request) ? listDesktopNetworkUrls(activePort) : [];
      const requestServerUrl = PUBLIC_URL || `${url.protocol}//${url.host}`;
      const setupConnection = bootstrapPairingInvite
        ? buildConnectionLink(requestServerUrl, bootstrapPairingInvite)
        : null;
      const qrDataUrl = setupConnection
        ? await QRCode.toDataURL(setupConnection.url, {
            width: 216,
            margin: 1,
            color: { dark: "#101827ff", light: "#effffaff" }
          })
        : "";
      sendText(
        response,
        200,
        "text/html; charset=utf-8",
        renderSetupPage(storage, setupLanguage, networkUrls, qrDataUrl)
      );
      return;
    }

    if (pathname === "/styles.css" && request.method === "GET") {
      await serveStaticAsset(response, STATIC_DIR, "styles.css", "text/css; charset=utf-8");
      return;
    }

    if (pathname === "/health" && request.method === "GET") {
      sendJson(response, 200, {
        ok: true,
        mode: "personal",
        defaultVaultId: config.defaultVaultId || null,
        vaultCount: registry.vaults.length,
        storage: storage.getHealth()
      });
      return;
    }

    if (pathname === "/v1/capabilities" && request.method === "GET") {
      sendJson(response, 200, {
        mode: "personal",
        product: "Locoris Personal Sync",
        serverId: config.serverId,
        features: {
          selfHosted: true,
          hostedAccounts: false,
          adminUi: false,
          accountPortal: false,
          multiUser: false,
          multiVault: true,
          standaloneRegistry: true,
          managementApi: true,
          devicePairing: true,
          scopedInvites: true,
          deviceRevocation: true,
          deltaSync: true,
          sqliteMetadata: true,
          fileSnapshots: true
        },
        defaultVaultId: config.defaultVaultId || null
      });
      return;
    }

    if (pathname === "/v1/pairing/info" && request.method === "GET") {
      sendJson(response, 200, {
        serverId: config.serverId,
        product: "Locoris Personal Server",
        ownerConnected: storage.countActiveOwnerDevices() > 0,
        setupAvailable: storage.countActiveOwnerDevices() === 0,
        pairingVersion: 1
      });
      return;
    }

    if (pathname === "/v1/pairing/redeem" && request.method === "POST") {
      if (!consumePairingAttempt(request)) {
        sendJson(response, 429, { error: "PAIRING_RATE_LIMITED" });
        return;
      }

      const payload = await collectBody(request);
      const code = normalizePairingCode(payload?.code);
      const secret = String(payload?.secret ?? "").trim();
      const deviceSecret = String(payload?.deviceSecret ?? "").trim();
      const claimSecret = String(payload?.claimSecret ?? "").trim();
      const invite = storage.findActivePairingInvite({ code, secret });

      if (!invite) {
        sendJson(response, 401, { error: "PAIRING_INVITE_INVALID" });
        return;
      }
      if (invite.kind === "bootstrap" && storage.countActiveOwnerDevices() > 0) {
        sendJson(response, 409, { error: "PAIRING_SETUP_ALREADY_COMPLETED" });
        return;
      }
      if (!deviceSecret.startsWith("zpd_") || deviceSecret.length < 32) {
        sendJson(response, 400, { error: "PAIRING_DEVICE_SECRET_INVALID" });
        return;
      }

      const deviceName = sanitizeDeviceName(payload?.deviceName);
      const platform = sanitizePlatform(payload?.platform);

      if (invite.requiresApproval) {
        if (!claimSecret.startsWith("zpc_") || claimSecret.length < 32) {
          sendJson(response, 400, { error: "PAIRING_CLAIM_SECRET_INVALID" });
          return;
        }

        const pairingRequest = storage.createPairingRequest(invite, {
          claimSecret,
          deviceSecret,
          deviceName,
          platform,
          confirmationCode: createConfirmationCode()
        });
        sendJson(response, 202, {
          status: "pending",
          request: pairingRequest,
          server: { id: config.serverId, name: "Locoris Personal Server" }
        });
        return;
      }

      const device = storage.createDeviceFromInvite(invite, {
        deviceName,
        platform,
        deviceTokenHash: hashToken(deviceSecret)
      });
      sendJson(response, 201, {
        status: "connected",
        device: buildPairingDeviceResponse(device),
        server: { id: config.serverId, name: "Locoris Personal Server" }
      });
      return;
    }

    const pairingStatusMatch = pathname.match(/^\/v1\/pairing\/requests\/([a-f0-9-]+)\/status$/i);
    if (pairingStatusMatch && request.method === "POST") {
      const payload = await collectBody(request);
      const pairingRequest = storage.getPairingRequestByClaim(
        pairingStatusMatch[1],
        String(payload?.claimSecret ?? "").trim()
      );
      if (!pairingRequest) {
        sendJson(response, 404, { error: "PAIRING_REQUEST_NOT_FOUND" });
        return;
      }
      sendJson(response, 200, {
        status: pairingRequest.status,
        request: pairingRequest,
        device: pairingRequest.deviceId
          ? buildPairingDeviceResponse(storage.getDevice(pairingRequest.deviceId))
          : null,
        server: { id: config.serverId, name: "Locoris Personal Server" }
      });
      return;
    }

    if (pathname === "/v1/personal/access" && request.method === "GET") {
      const principal = requireManagementPrincipal(request, response, { owner: true });
      if (!principal) return;
      sendJson(response, 200, buildAccessOverview(principal));
      return;
    }

    if (pathname === "/v1/personal/invites" && request.method === "POST") {
      const principal = requireManagementPrincipal(request, response, { owner: true });
      if (!principal) return;
      const payload = await collectBody(request);
      const kind = payload?.kind === "guest" ? "guest" : "owner_device";
      const role = kind === "guest" ? "guest" : "owner";
      const requestedVaultIds = Array.isArray(payload?.vaultIds)
        ? [...new Set(payload.vaultIds.map(sanitizeVaultId).filter(Boolean))]
        : [];
      const permission = payload?.permission === "read" ? "read" : "write";
      if (kind === "guest" && requestedVaultIds.length === 0) {
        sendJson(response, 400, { error: "PAIRING_VAULT_REQUIRED" });
        return;
      }
      if (requestedVaultIds.some((vaultId) => !storage.getVault(vaultId))) {
        sendJson(response, 404, { error: "VAULT_NOT_FOUND" });
        return;
      }
      const defaultTtl = kind === "guest" ? 24 * 60 * 60 * 1000 : 15 * 60 * 1000;
      const requestedTtl = Number(payload?.expiresInMs);
      const expiresInMs = Number.isFinite(requestedTtl)
        ? Math.min(7 * 24 * 60 * 60 * 1000, Math.max(5 * 60 * 1000, requestedTtl))
        : defaultTtl;
      const invitationServerUrl = normalizeAdvertisedUrl(
        payload?.serverUrl,
        getRequestOrigin(request)
      );
      const material = createInviteMaterial({
        kind,
        role,
        label: sanitizeDisplayName(
          payload?.label,
          kind === "guest" ? "Guest invitation" : "Owner device"
        ),
        requiresApproval: kind === "guest",
        maxUses: 1,
        createdByDeviceId: principal.deviceId,
        expiresAt: Date.now() + expiresInMs,
        vaultAccess: requestedVaultIds.map((vaultId) => ({ vaultId, permission }))
      });
      const link = buildConnectionLink(invitationServerUrl, material);
      sendJson(response, 201, {
        invite: material,
        connection: link
      });
      return;
    }

    const inviteRevokeMatch = pathname.match(/^\/v1\/personal\/invites\/([a-f0-9-]+)$/i);
    if (inviteRevokeMatch && request.method === "DELETE") {
      const principal = requireManagementPrincipal(request, response, { owner: true });
      if (!principal) return;
      const revoked = storage.revokePairingInvite(inviteRevokeMatch[1]);
      sendJson(response, revoked ? 200 : 404, revoked ? { ok: true } : { error: "PAIRING_INVITE_NOT_FOUND" });
      return;
    }

    const requestDecisionMatch = pathname.match(
      /^\/v1\/personal\/pairing-requests\/([a-f0-9-]+)\/decision$/i
    );
    if (requestDecisionMatch && request.method === "POST") {
      const principal = requireManagementPrincipal(request, response, { owner: true });
      if (!principal) return;
      const payload = await collectBody(request);
      const result = storage.decidePairingRequest(requestDecisionMatch[1], payload?.approve === true);
      if (result.error) {
        sendJson(response, result.error === "PAIRING_REQUEST_NOT_FOUND" ? 404 : 409, {
          error: result.error
        });
      } else {
        sendJson(response, 200, result);
      }
      return;
    }

    const deviceRevokeMatch = pathname.match(/^\/v1\/personal\/devices\/([a-f0-9-]+)$/i);
    if (deviceRevokeMatch && request.method === "DELETE") {
      const principal = requireManagementPrincipal(request, response, { owner: true });
      if (!principal) return;
      const result = storage.revokeDevice(deviceRevokeMatch[1], principal.deviceId);
      if (result.error) {
        sendJson(response, result.error === "DEVICE_NOT_FOUND" ? 404 : 409, { error: result.error });
      } else {
        sendJson(response, 200, result);
      }
      return;
    }

    if (pathname === "/v1/personal/vaults" && request.method === "GET") {
      const principal = requireManagementPrincipal(request, response);
      if (!principal) return;
      const allowedIds = new Set(storage.listVaultsForPrincipal(principal).map((vault) => vault.id));
      sendJson(response, 200, {
        vaults: buildVaultList(storage.getRegistry()).filter((vault) => allowedIds.has(vault.id)),
        access: { role: principal.role, deviceId: principal.deviceId }
      });
      return;
    }

    if (pathname === "/v1/personal/vaults" && request.method === "POST") {
      const principal = requireManagementPrincipal(request, response, { owner: true });
      if (!principal) return;

      const created = await createVault(await collectBody(request));
      if (created.error) {
        sendJson(response, created.statusCode, { error: created.error });
      } else {
        sendJson(response, created.statusCode, {
          vault: buildVaultList(storage.getRegistry()).find((vault) => vault.id === created.vault.id) ?? null
        });
      }
      return;
    }

    const personalVaultMatch = pathname.match(/^\/v1\/personal\/vaults\/([a-z0-9-_]{1,64})$/i);
    if (personalVaultMatch && request.method === "PATCH") {
      const principal = requireManagementPrincipal(request, response, { owner: true });
      if (!principal) return;

      const vaultId = sanitizeVaultId(personalVaultMatch[1]);
      const payload = await collectBody(request);
      const nextName = sanitizeDisplayName(payload?.name, "");
      if (!nextName) {
        sendJson(response, 400, { error: "VAULT_NAME_REQUIRED" });
        return;
      }

      const renamed = await renameVault(vaultId, nextName);
      if (renamed.error) {
        sendJson(response, renamed.statusCode, { error: renamed.error });
      } else {
        sendJson(response, 200, {
          vault: buildVaultList(storage.getRegistry()).find((vault) => vault.id === vaultId) ?? null
        });
      }
      return;
    }

    if (personalVaultMatch && request.method === "DELETE") {
      const principal = requireManagementPrincipal(request, response, { owner: true });
      if (!principal) return;

      const removed = await deleteVault(sanitizeVaultId(personalVaultMatch[1]));
      if (removed.error) {
        sendJson(response, removed.statusCode, { error: removed.error });
      } else {
        sendJson(response, 200, { ok: true, vaultId: removed.vaultId });
      }
      return;
    }

    const tokenMatch = pathname.match(/^\/v1\/personal\/vaults\/([a-z0-9-_]{1,64})\/tokens$/i);
    if (tokenMatch && request.method === "GET") {
      const principal = requireManagementPrincipal(request, response, { owner: true });
      if (!principal) return;

      const vaultId = sanitizeVaultId(tokenMatch[1]);
      if (!storage.getVault(vaultId)) {
        sendJson(response, 404, { error: "VAULT_NOT_FOUND" });
        return;
      }

      sendJson(response, 200, {
        tokens: storage
          .getRegistry()
          .tokens.filter((token) => token.vaultId === vaultId)
          .map(buildTokenMeta)
      });
      return;
    }

    if (tokenMatch && request.method === "POST") {
      const vaultId = sanitizeVaultId(tokenMatch[1]);
      const principal = requireManagementPrincipal(request, response, { vaultId });
      if (!principal) return;
      const payload = await collectBody(request);
      const issued = await issueVaultToken(vaultId, payload?.label, principal.deviceId);
      if (issued.error) {
        sendJson(response, issued.statusCode, { error: issued.error });
      } else {
        sendJson(response, issued.statusCode, {
          token: issued.token,
          tokenMeta: issued.tokenMeta
        });
      }
      return;
    }

    const changesMatch = pathname.match(/^\/v1\/vaults\/([a-z0-9-_]{1,64})\/changes$/i);
    const legacyChangesVaultId = pathname === "/v1/changes" ? config.defaultVaultId : "";
    const changesVaultId = sanitizeVaultId(changesMatch?.[1] ?? legacyChangesVaultId);
    if (changesVaultId && (request.method === "GET" || request.method === "POST")) {
      await handleChangesRoute({ request, response, url, vaultId: changesVaultId });
      return;
    }

    const stateMatch = pathname.match(/^\/v1\/vaults\/([a-z0-9-_]{1,64})\/state$/i);
    const legacyStateVaultId = pathname === "/v1/state" ? config.defaultVaultId : "";
    const stateVaultId = sanitizeVaultId(stateMatch?.[1] ?? legacyStateVaultId);
    if (stateVaultId && (request.method === "GET" || request.method === "PUT")) {
      await handleStateRoute({ request, response, vaultId: stateVaultId });
      return;
    }

    sendJson(response, 404, { error: "NOT_FOUND" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SERVER_ERROR";
    const statusCode = message === "PAYLOAD_TOO_LARGE"
      ? 413
      : message === "PAIRING_SERVER_URL_INVALID"
        ? 400
        : 500;
    sendJson(response, statusCode, { error: message });
  }
});

let shuttingDown = false;
let closePromise = null;
let storageClosed = false;

function closeStorageOnce() {
  if (!storageClosed) {
    storage.close();
    storageClosed = true;
  }
}

export function closePersonalServer() {
  if (closePromise) {
    return closePromise;
  }

  closePromise = new Promise((resolve, reject) => {
    server.close((error) => {
      closeStorageOnce();
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
  return closePromise;
}

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  const forceExit = setTimeout(() => {
    closeStorageOnce();
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  try {
    await closePersonalServer();
    clearTimeout(forceExit);
    console.log(`Locoris Personal Sync stopped (${signal})`);
    process.exit(0);
  } catch (error) {
    console.error(error);
    closeStorageOnce();
    process.exit(1);
  }
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

server.once("error", (error) => {
  closeStorageOnce();
  if (error?.code === "EADDRINUSE") {
    const suggestedPort = PORT + 1;
    console.error(`Locoris Personal Sync could not start: port ${PORT} is already in use.`);
    console.error(
      `Stop the service using that port or start Locoris on another one, for example: PORT=${suggestedPort} SYNC_PUBLIC_URL=http://localhost:${suggestedPort} npm run sync-server`
    );
  } else {
    console.error(`Locoris Personal Sync could not start: ${error?.message ?? String(error)}`);
  }
  rejectPersonalServerReady?.(error);
});

if (IS_DIRECT_RUN) {
  void personalServerReady.catch(() => {
    process.exitCode = 1;
  });
}

server.listen(PORT, () => {
  const address = server.address();
  const actualPort = address && typeof address === "object" ? address.port : PORT;
  const serverUrl = PUBLIC_URL || `http://localhost:${actualPort}`;
  const bootstrapConnection = bootstrapPairingInvite
    ? buildConnectionLink(serverUrl, bootstrapPairingInvite)
    : null;

  resolvePersonalServerReady?.({
    baseUrl: `http://127.0.0.1:${actualPort}`,
    publicUrl: serverUrl,
    bootstrapUrl: bootstrapConnection?.url ?? null,
    bootstrapConnectionPackage: bootstrapConnection?.connectionPackage ?? null
  });

  console.log(`Locoris Personal Sync listening on http://localhost:${actualPort}`);
  console.log(`Data dir: ${DATA_DIR}`);
  console.log(`Storage: ${bootstrap.databaseFile} + vault files`);
  console.log(`Default vault: ${bootstrap.config.defaultVaultId || "none"}`);

  if (bootstrap.managementTokenWasGenerated) {
    console.log(`Recovery management token stored in: ${bootstrap.managementTokenFile}`);
  } else {
    console.log(`Management token source: ${ENV_MANAGEMENT_TOKEN ? "environment" : bootstrap.managementTokenFile}`);
  }

  if (bootstrapPairingInvite) {
    const connection = bootstrapConnection;
    console.log("");
    console.log("Connect the first owner device:");
    console.log(`Open: ${connection.url}`);
    console.log(`Server: ${serverUrl}`);
    console.log(`Setup code: ${bootstrapPairingInvite.code}`);
    console.log(`Connection package: ${connection.connectionPackage}`);
    console.log("This one-time invitation expires in 24 hours or immediately after use.");
    if (PRINT_PAIRING_QR) {
      qrcode.generate(connection.url, { small: true }, (qr) => console.log(qr));
    }
  }

  if (bootstrap.legacyImport.imported) {
    console.log(`Legacy JSON metadata migrated to SQLite (${bootstrap.legacyImport.archivedFiles.length} files archived)`);
  }
  for (const warning of bootstrap.legacyImport.warnings) {
    console.warn(warning);
  }
});
