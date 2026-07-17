import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  loadPersonalServerVaults,
  pollPersonalServerPairing,
  redeemPersonalServerInvite
} from "../../lib/sync";
import {
  clearPendingSelfHostedPairing,
  createSelfHostedClaimSecret,
  createSelfHostedDeviceSecret,
  normalizeSelfHostedPairingCode,
  parseSelfHostedConnectionPackage,
  readPendingSelfHostedPairing,
  writePendingSelfHostedPairing,
  type PendingSelfHostedPairing
} from "../../lib/selfHostedPairing";
import type { SyncConnection, SyncRemoteVault } from "../../types";
import "./SelfHostedConnectionWizard.css";

type ConnectionMode = "package" | "code" | "legacy";

type ConnectedResult = {
  serverUrl: string;
  deviceCredential: string;
  label: string;
  deviceId: string | null;
  role: "owner" | "guest" | null;
  serverId: string | null;
  remoteVaults: SyncRemoteVault[];
};

type SelfHostedConnectionWizardProps = {
  connection: SyncConnection | null;
  deviceName: string;
  platform: string;
  initialConnectionPackage?: string;
  translateError: (message: string) => string;
  onConnected: (result: ConnectedResult) => void | Promise<void>;
  onCancel: () => void;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "SERVER_ERROR";
}

function LinkGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9.5 14.5 14.5 9.5" />
      <path d="m7.8 17.2-1.2 1.2a3.5 3.5 0 0 1-5-5l3.1-3.1a3.5 3.5 0 0 1 5 0" />
      <path d="m16.2 6.8 1.2-1.2a3.5 3.5 0 1 1 5 5l-3.1 3.1a3.5 3.5 0 0 1-5 0" />
    </svg>
  );
}

function KeyGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="8" cy="12" r="4" />
      <path d="M12 12h9M17 12v3M20 12v2" />
    </svg>
  );
}

function ShieldGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.8 20 6v5.2c0 5.1-3.1 8.5-8 10-4.9-1.5-8-4.9-8-10V6l8-3.2Z" />
      <path d="m8.5 12 2.2 2.2 4.8-5" />
    </svg>
  );
}

export default function SelfHostedConnectionWizard({
  connection,
  deviceName,
  platform,
  initialConnectionPackage = "",
  translateError,
  onConnected,
  onCancel
}: SelfHostedConnectionWizardProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<ConnectionMode>(connection ? "code" : "package");
  const [connectionPackage, setConnectionPackage] = useState(initialConnectionPackage);
  const [serverUrl, setServerUrl] = useState(connection?.serverUrl ?? "");
  const [pairingCode, setPairingCode] = useState("");
  const [legacyToken, setLegacyToken] = useState(connection?.managementToken ?? "");
  const [label, setLabel] = useState(connection?.label ?? "");
  const [pending, setPending] = useState<PendingSelfHostedPairing | null>(() =>
    readPendingSelfHostedPairing()
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pendingExpired = useMemo(
    () => Boolean(pending && Date.now() - pending.startedAt > 24 * 60 * 60 * 1000),
    [pending]
  );

  const completeConnection = async (input: {
    serverUrl: string;
    deviceCredential: string;
    serverId: string | null;
    deviceId: string | null;
    role: "owner" | "guest" | null;
  }) => {
    const remoteVaults = (await loadPersonalServerVaults(
      input.serverUrl,
      input.deviceCredential
    )).vaults;
    clearPendingSelfHostedPairing();
    setPending(null);
    await onConnected({
      ...input,
      label: label.trim(),
      remoteVaults
    });
  };

  useEffect(() => {
    if (!pending || pendingExpired) {
      if (pendingExpired) {
        clearPendingSelfHostedPairing();
        setPending(null);
        setError(t("settings.selfHostedPairingExpired"));
      }
      return;
    }

    let cancelled = false;
    let timeoutId: number | null = null;
    const poll = async () => {
      try {
        const result = await pollPersonalServerPairing(
          pending.serverUrl,
          pending.requestId,
          pending.claimSecret
        );
        if (cancelled) return;
        if (result.status === "approved" && result.device) {
          setBusy(true);
          await completeConnection({
            serverUrl: pending.serverUrl,
            deviceCredential: pending.deviceSecret,
            serverId: result.server.id,
            deviceId: result.device.id,
            role: result.device.role
          });
          return;
        }
        if (result.status === "denied" || result.status === "expired") {
          clearPendingSelfHostedPairing();
          setPending(null);
          setError(
            result.status === "denied"
              ? t("settings.selfHostedPairingDenied")
              : t("settings.selfHostedPairingExpired")
          );
          return;
        }
      } catch (pollError) {
        if (!cancelled) {
          const message = getErrorMessage(pollError);
          if (message !== "SERVER_UNAVAILABLE") {
            setError(translateError(message));
          }
        }
      } finally {
        if (!cancelled) {
          setBusy(false);
          timeoutId = window.setTimeout(poll, 2500);
        }
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [pending, pendingExpired]);

  const connectWithInvite = async () => {
    setError(null);
    setBusy(true);
    try {
      let targetServerUrl = serverUrl.trim().replace(/\/+$/, "");
      let code = normalizeSelfHostedPairingCode(pairingCode);
      let secret = "";

      if (mode === "package") {
        const parsed = parseSelfHostedConnectionPackage(connectionPackage);
        targetServerUrl = parsed.serverUrl;
        code = parsed.code;
        secret = parsed.secret;
      } else if (!targetServerUrl || code.replace(/-/g, "").length !== 8) {
        throw new Error(!targetServerUrl ? "SYNC_SERVER_URL_REQUIRED" : "PAIRING_CODE_INVALID");
      }

      const deviceSecret = createSelfHostedDeviceSecret();
      const claimSecret = createSelfHostedClaimSecret();
      const result = await redeemPersonalServerInvite(targetServerUrl, {
        code: secret ? undefined : code,
        secret: secret || undefined,
        deviceSecret,
        claimSecret,
        deviceName,
        platform
      });

      if (result.status === "connected" && result.device) {
        await completeConnection({
          serverUrl: targetServerUrl,
          deviceCredential: deviceSecret,
          serverId: result.server.id,
          deviceId: result.device.id,
          role: result.device.role
        });
        return;
      }

      if (!result.request) {
        throw new Error("PAIRING_REQUEST_NOT_FOUND");
      }
      const nextPending: PendingSelfHostedPairing = {
        serverUrl: targetServerUrl,
        serverId: result.server.id,
        deviceSecret,
        claimSecret,
        requestId: result.request.id,
        confirmationCode: result.request.confirmationCode,
        startedAt: Date.now()
      };
      writePendingSelfHostedPairing(nextPending);
      setPending(nextPending);
    } catch (connectError) {
      setError(translateError(getErrorMessage(connectError)));
    } finally {
      setBusy(false);
    }
  };

  const connectLegacy = async () => {
    setError(null);
    setBusy(true);
    try {
      const normalizedUrl = serverUrl.trim().replace(/\/+$/, "");
      const normalizedToken = legacyToken.trim();
      if (!normalizedUrl || !normalizedToken) {
        throw new Error(!normalizedUrl ? "SYNC_SERVER_URL_REQUIRED" : "SYNC_TOKEN_REQUIRED");
      }
      await completeConnection({
        serverUrl: normalizedUrl,
        deviceCredential: normalizedToken,
        serverId: connection?.selfHostedServerId ?? null,
        deviceId: connection?.selfHostedDeviceId ?? null,
        role: connection?.selfHostedRole ?? null
      });
    } catch (connectError) {
      setError(translateError(getErrorMessage(connectError)));
    } finally {
      setBusy(false);
    }
  };

  if (pending) {
    return (
      <div className="self-hosted-wizard is-pending">
        <div className="self-hosted-wizard-state-icon"><ShieldGlyph /></div>
        <span className="self-hosted-wizard-kicker">{t("settings.selfHostedPairingPendingKicker")}</span>
        <h3>{t("settings.selfHostedPairingPendingTitle")}</h3>
        <p>{t("settings.selfHostedPairingPendingDescription")}</p>
        <div className="self-hosted-confirmation-code">
          <span>{t("settings.selfHostedPairingConfirmation")}</span>
          <strong>{pending.confirmationCode}</strong>
        </div>
        <div className="self-hosted-waiting-row">
          <span className="self-hosted-waiting-dot" aria-hidden="true" />
          <span>{t("settings.selfHostedPairingWaiting")}</span>
        </div>
        {error ? <div className="self-hosted-wizard-error" role="alert">{error}</div> : null}
        <div className="self-hosted-wizard-actions">
          <button type="button" className="sync-settings-inline-action" onClick={onCancel}>
            {t("settings.selfHostedPairingContinueLater")}
          </button>
          <button
            type="button"
            className="sync-settings-inline-action is-danger"
            onClick={() => {
              clearPendingSelfHostedPairing();
              setPending(null);
            }}
          >
            {t("dialog.cancel")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="self-hosted-wizard">
      <div className="self-hosted-mode-switch" role="tablist" aria-label={t("settings.selfHostedConnectMethod")}>
        <button type="button" className={mode === "package" ? "is-active" : ""} onClick={() => setMode("package")}>
          <LinkGlyph />
          <span>{t("settings.selfHostedConnectLink")}</span>
        </button>
        <button type="button" className={mode === "code" ? "is-active" : ""} onClick={() => setMode("code")}>
          <KeyGlyph />
          <span>{t("settings.selfHostedConnectCode")}</span>
        </button>
      </div>

      {mode === "package" ? (
        <label className="self-hosted-field">
          <span>{t("settings.selfHostedConnectionPackage")}</span>
          <textarea
            value={connectionPackage}
            onChange={(event) => {
              setConnectionPackage(event.target.value);
              setError(null);
            }}
            placeholder={t("settings.selfHostedConnectionPackagePlaceholder")}
            autoFocus
          />
          <small>{t("settings.selfHostedConnectionPackageHint")}</small>
        </label>
      ) : null}

      {mode === "code" || mode === "legacy" ? (
        <label className="self-hosted-field">
          <span>{t("sync.endpoint")}</span>
          <input
            value={serverUrl}
            onChange={(event) => {
              setServerUrl(event.target.value);
              setError(null);
            }}
            placeholder={t("sync.endpointPlaceholder")}
            autoFocus
          />
        </label>
      ) : null}

      {mode === "code" ? (
        <label className="self-hosted-field">
          <span>{t("settings.selfHostedPairingCode")}</span>
          <input
            className="is-code"
            value={pairingCode}
            onChange={(event) => {
              setPairingCode(normalizeSelfHostedPairingCode(event.target.value));
              setError(null);
            }}
            placeholder="ABCD-EFGH"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="one-time-code"
          />
          <small>{t("settings.selfHostedPairingCodeHint")}</small>
        </label>
      ) : null}

      {mode === "legacy" ? (
        <label className="self-hosted-field">
          <span>{t("sync.managementToken")}</span>
          <input
            type="password"
            value={legacyToken}
            onChange={(event) => {
              setLegacyToken(event.target.value);
              setError(null);
            }}
            placeholder={t("sync.managementTokenPlaceholder")}
          />
          <small>{t("settings.selfHostedLegacyHint")}</small>
        </label>
      ) : null}

      <label className="self-hosted-field">
        <span>{t("settings.connectionLabelOptional")}</span>
        <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder={t("settings.selfHostedLabelPlaceholder")} />
      </label>

      <div className="self-hosted-device-preview">
        <ShieldGlyph />
        <div>
          <strong>{deviceName}</strong>
          <span>{t("settings.selfHostedDeviceCredentialHint")}</span>
        </div>
      </div>

      {error ? <div className="self-hosted-wizard-error" role="alert">{error}</div> : null}

      <button
        type="button"
        className="self-hosted-legacy-toggle"
        onClick={() => {
          setMode((current) => (current === "legacy" ? "code" : "legacy"));
          setError(null);
        }}
      >
        {mode === "legacy" ? t("settings.selfHostedUseInvite") : t("settings.selfHostedUseLegacy")}
      </button>

      <div className="self-hosted-wizard-actions">
        <button type="button" className="sync-settings-inline-action" onClick={onCancel}>
          {t("dialog.cancel")}
        </button>
        <button
          type="button"
          className="sync-settings-primary-action"
          disabled={busy || (mode === "package" && !connectionPackage.trim())}
          onClick={() => void (mode === "legacy" ? connectLegacy() : connectWithInvite())}
        >
          {busy ? t("sync.syncing") : t("settings.selfHostedConnectAction")}
        </button>
      </div>
    </div>
  );
}
