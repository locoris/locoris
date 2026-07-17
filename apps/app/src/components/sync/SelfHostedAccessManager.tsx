import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { useTranslation } from "react-i18next";

import { createDateTimeFormatter, useLocale } from "../../localization";
import {
  createPersonalServerInvite,
  decidePersonalServerPairingRequest,
  loadPersonalServerAccess,
  revokePersonalServerDevice,
  revokePersonalServerInvite,
  type PersonalServerAccessOverview,
  type PersonalServerDevice,
  type PersonalServerPairingRequest
} from "../../lib/sync";
import type { SyncConnection, SyncRemoteVault } from "../../types";
import "./SelfHostedAccessManager.css";

type AccessTab = "devices" | "invites";
type InviteKind = "owner_device" | "guest";

type GeneratedInvite = {
  code: string;
  expiresAt: number;
  connectionPackage: string;
  url: string;
};

type SelfHostedAccessManagerProps = {
  connection: SyncConnection;
  remoteVaults: SyncRemoteVault[];
  translateError: (message: string) => string;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "SERVER_ERROR";
}

function DeviceGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="3.5" width="16" height="13" rx="2" />
      <path d="M8 20.5h8M12 16.5v4" />
    </svg>
  );
}

function InviteGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 12.5V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6.5" />
      <path d="M14.5 9.5h5M17 7v5M3 18h6M6 15v6" />
    </svg>
  );
}

function ShieldGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 20 6.2v5.2c0 5-3.1 8.3-8 9.8-4.9-1.5-8-4.8-8-9.8V6.2L12 3Z" />
      <path d="m8.8 12.1 2 2 4.5-4.6" />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m5 5 10 10M15 5 5 15" />
    </svg>
  );
}

export default function SelfHostedAccessManager({
  connection,
  remoteVaults,
  translateError
}: SelfHostedAccessManagerProps) {
  const { t } = useTranslation();
  const { runtime: localeRuntime } = useLocale();
  const [tab, setTab] = useState<AccessTab>("devices");
  const [overview, setOverview] = useState<PersonalServerAccessOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteKind, setInviteKind] = useState<InviteKind | null>(null);
  const [inviteLabel, setInviteLabel] = useState("");
  const [invitationServerUrl, setInvitationServerUrl] = useState(connection.serverUrl);
  const [selectedVaultIds, setSelectedVaultIds] = useState<string[]>([]);
  const [generatedInvite, setGeneratedInvite] = useState<GeneratedInvite | null>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState("");
  const [armedDeviceId, setArmedDeviceId] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");

  const formatter = createDateTimeFormatter(localeRuntime, {
    dateStyle: "medium",
    timeStyle: "short"
  });

  const loadOverview = async () => {
    setLoading(true);
    setError(null);
    try {
      setOverview(await loadPersonalServerAccess(connection.serverUrl, connection.managementToken));
    } catch (loadError) {
      setError(translateError(getErrorMessage(loadError)));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadOverview();
  }, [connection.id, connection.managementToken, connection.serverUrl]);

  useEffect(() => {
    if (!generatedInvite?.url) {
      setQrCodeUrl("");
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(generatedInvite.url, {
      width: 320,
      margin: 2,
      color: { dark: "#071019", light: "#f7f5f1" },
      errorCorrectionLevel: "M"
    }).then((value) => {
      if (!cancelled) setQrCodeUrl(value);
    });
    return () => {
      cancelled = true;
    };
  }, [generatedInvite?.url]);

  const activeDevices = (overview?.devices ?? []).filter((device) => !device.revokedAt);
  const activeInvites = (overview?.invites ?? []).filter(
    (invite) => !invite.revokedAt && invite.expiresAt > Date.now() && invite.useCount < invite.maxUses
  );
  const pendingRequests = (overview?.requests ?? []).filter((request) => request.status === "pending");

  const openInvite = (kind: InviteKind) => {
    setInviteKind(kind);
    setInviteLabel("");
    setInvitationServerUrl(connection.serverUrl);
    setSelectedVaultIds(kind === "guest" && remoteVaults.length === 1 ? [remoteVaults[0].id] : []);
    setGeneratedInvite(null);
    setQrCodeUrl("");
    setCopyState("idle");
    setError(null);
  };

  const closeInvite = () => {
    setInviteKind(null);
    setGeneratedInvite(null);
    setQrCodeUrl("");
  };

  const handleCreateInvite = async () => {
    if (!inviteKind) return;
    if (inviteKind === "guest" && selectedVaultIds.length === 0) {
      setError(t("settings.selfHostedInviteVaultRequired"));
      return;
    }
    setBusyKey("create-invite");
    setError(null);
    try {
      const result = await createPersonalServerInvite(
        connection.serverUrl,
        connection.managementToken,
        {
          kind: inviteKind,
          label: inviteLabel.trim() || undefined,
          vaultIds: inviteKind === "guest" ? selectedVaultIds : undefined,
          permission: inviteKind === "guest" ? "write" : undefined,
          expiresInMs: inviteKind === "guest" ? 24 * 60 * 60 * 1000 : 15 * 60 * 1000,
          serverUrl: invitationServerUrl.trim()
        }
      );
      setGeneratedInvite({
        code: result.invite.code,
        expiresAt: result.invite.expiresAt,
        connectionPackage: result.connection.connectionPackage,
        url: result.connection.url
      });
      await loadOverview();
    } catch (createError) {
      setError(translateError(getErrorMessage(createError)));
    } finally {
      setBusyKey(null);
    }
  };

  const handleDecision = async (request: PersonalServerPairingRequest, approve: boolean) => {
    setBusyKey(`request:${request.id}`);
    setError(null);
    try {
      await decidePersonalServerPairingRequest(
        connection.serverUrl,
        connection.managementToken,
        request.id,
        approve
      );
      await loadOverview();
    } catch (decisionError) {
      setError(translateError(getErrorMessage(decisionError)));
    } finally {
      setBusyKey(null);
    }
  };

  const handleRevokeDevice = async (device: PersonalServerDevice) => {
    if (armedDeviceId !== device.id) {
      setArmedDeviceId(device.id);
      return;
    }
    setBusyKey(`device:${device.id}`);
    setError(null);
    try {
      await revokePersonalServerDevice(
        connection.serverUrl,
        connection.managementToken,
        device.id
      );
      setArmedDeviceId(null);
      await loadOverview();
    } catch (revokeError) {
      setError(translateError(getErrorMessage(revokeError)));
    } finally {
      setBusyKey(null);
    }
  };

  const handleRevokeInvite = async (inviteId: string) => {
    setBusyKey(`invite:${inviteId}`);
    setError(null);
    try {
      await revokePersonalServerInvite(
        connection.serverUrl,
        connection.managementToken,
        inviteId
      );
      await loadOverview();
    } catch (revokeError) {
      setError(translateError(getErrorMessage(revokeError)));
    } finally {
      setBusyKey(null);
    }
  };

  const copyInvite = async () => {
    if (!generatedInvite) return;
    try {
      await navigator.clipboard.writeText(generatedInvite.url);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1800);
    } catch {
      setError(t("settings.selfHostedInviteCopyFailed"));
    }
  };

  const inviteLayer = inviteKind && typeof document !== "undefined"
    ? createPortal(
        <div className="self-hosted-access-layer" role="dialog" aria-modal="true">
          <button type="button" className="self-hosted-access-dim" aria-label={t("orbit.closeModal")} onClick={closeInvite} />
          <section className="self-hosted-invite-sheet">
            <header>
              <div>
                <span>{inviteKind === "guest" ? t("settings.selfHostedGuestKicker") : t("settings.selfHostedDeviceKicker")}</span>
                <h3>{inviteKind === "guest" ? t("settings.selfHostedGuestTitle") : t("settings.selfHostedDeviceInviteTitle")}</h3>
              </div>
              <button type="button" className="self-hosted-sheet-close" aria-label={t("orbit.closeModal")} onClick={closeInvite}>
                <CloseGlyph />
              </button>
            </header>

            {generatedInvite ? (
              <div className="self-hosted-invite-result">
                <div className="self-hosted-invite-result-main">
                  <div className="self-hosted-invite-code">
                    <span>{t("settings.selfHostedPairingCode")}</span>
                    <strong>{generatedInvite.code}</strong>
                  </div>
                  <p>{t("settings.selfHostedInviteShareHint")}</p>
                  <button type="button" className="sync-settings-primary-action" onClick={() => void copyInvite()}>
                    {copyState === "copied" ? t("settings.selfHostedInviteCopied") : t("settings.selfHostedInviteCopy")}
                  </button>
                  <small>{t("settings.selfHostedInviteExpires", { date: formatter.format(generatedInvite.expiresAt) })}</small>
                </div>
                {qrCodeUrl ? (
                  <div className="self-hosted-invite-qr">
                    <img src={qrCodeUrl} alt={t("settings.selfHostedInviteQrAlt")} />
                    <span>{t("settings.selfHostedInviteQrOptional")}</span>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="self-hosted-invite-form">
                <label>
                  <span>{t("settings.selfHostedInviteLabel")}</span>
                  <input value={inviteLabel} onChange={(event) => setInviteLabel(event.target.value)} placeholder={t("settings.selfHostedInviteLabelPlaceholder")} autoFocus />
                </label>

                <label>
                  <span>{t("settings.selfHostedInviteServerAddress")}</span>
                  <input
                    value={invitationServerUrl}
                    onChange={(event) => setInvitationServerUrl(event.target.value)}
                    placeholder="https://sync.example.com"
                    inputMode="url"
                    autoCapitalize="none"
                    autoCorrect="off"
                  />
                  <small>{t("settings.selfHostedInviteServerAddressHint")}</small>
                </label>

                {inviteKind === "guest" ? (
                  <>
                    <fieldset>
                      <legend>{t("settings.selfHostedInviteVaults")}</legend>
                      <div className="self-hosted-vault-options">
                        {remoteVaults.map((vault) => (
                          <label key={vault.id}>
                            <input
                              type="checkbox"
                              checked={selectedVaultIds.includes(vault.id)}
                              onChange={() => setSelectedVaultIds((current) => current.includes(vault.id) ? current.filter((id) => id !== vault.id) : [...current, vault.id])}
                            />
                            <span><strong>{vault.name}</strong><small>{vault.id}</small></span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  </>
                ) : (
                  <div className="self-hosted-invite-note"><ShieldGlyph /><span>{t("settings.selfHostedOwnerInviteWarning")}</span></div>
                )}

                {error ? <div className="self-hosted-access-error" role="alert">{error}</div> : null}
                <div className="self-hosted-invite-actions">
                  <button type="button" className="sync-settings-inline-action" onClick={closeInvite}>{t("dialog.cancel")}</button>
                  <button type="button" className="sync-settings-primary-action" disabled={busyKey !== null} onClick={() => void handleCreateInvite()}>{busyKey === "create-invite" ? t("sync.syncing") : t("settings.selfHostedInviteCreate")}</button>
                </div>
              </div>
            )}
          </section>
        </div>,
        document.body
      )
    : null;

  return (
    <div className="self-hosted-access-manager">
      <div className="self-hosted-access-summary">
        <div className="self-hosted-access-summary-icon"><ShieldGlyph /></div>
        <div>
          <span>{t("settings.selfHostedAccessServer")}</span>
          <strong>{overview?.server.name ?? connection.label}</strong>
          <small>{connection.serverUrl}</small>
        </div>
        <span className="self-hosted-role-chip">{t("settings.selfHostedOwnerRole")}</span>
      </div>

      <div className="self-hosted-access-tabs" role="tablist">
        <button type="button" className={tab === "devices" ? "is-active" : ""} onClick={() => setTab("devices")}>
          <DeviceGlyph /><span>{t("settings.selfHostedDevices")}</span><small>{activeDevices.length}</small>
        </button>
        <button type="button" className={tab === "invites" ? "is-active" : ""} onClick={() => setTab("invites")}>
          <InviteGlyph /><span>{t("settings.selfHostedInvites")}</span><small>{activeInvites.length + pendingRequests.length}</small>
        </button>
      </div>

      <div className="self-hosted-access-toolbar">
        <div>
          <strong>{tab === "devices" ? t("settings.selfHostedDevicesTitle") : t("settings.selfHostedInvitesTitle")}</strong>
          <span>{tab === "devices" ? t("settings.selfHostedDevicesDescription") : t("settings.selfHostedInvitesDescription")}</span>
        </div>
        <div className="self-hosted-access-toolbar-actions">
          <button type="button" className="sync-settings-inline-action" onClick={() => openInvite("guest")}>{t("settings.selfHostedInviteGuest")}</button>
          <button type="button" className="sync-settings-primary-action" onClick={() => openInvite("owner_device")}>{t("settings.selfHostedInviteDevice")}</button>
        </div>
      </div>

      {error && !inviteKind ? <div className="self-hosted-access-error" role="alert">{error}<button type="button" onClick={() => void loadOverview()}>{t("settings.remoteVaultRefreshShort")}</button></div> : null}
      {loading ? <div className="self-hosted-access-empty">{t("settings.remoteVaultLoading")}</div> : null}

      {!loading && tab === "devices" ? (
        <div className="self-hosted-device-list">
          {activeDevices.map((device) => {
            const current = device.id === overview?.currentDeviceId;
            return (
              <article key={device.id} className="self-hosted-device-row">
                <span className="self-hosted-row-icon"><DeviceGlyph /></span>
                <div className="self-hosted-row-copy">
                  <div><strong>{device.name}</strong>{current ? <span>{t("settings.selfHostedCurrentDevice")}</span> : null}</div>
                  <small>{device.platform} · {device.role === "owner" ? t("settings.selfHostedOwnerRole") : t("settings.selfHostedGuestRole")}</small>
                  <small>{device.lastUsedAt ? t("settings.selfHostedLastSeen", { date: formatter.format(device.lastUsedAt) }) : t("settings.selfHostedNeverUsed")}</small>
                </div>
                {!current ? (
                  <button type="button" className={`sync-settings-inline-action ${armedDeviceId === device.id ? "is-danger" : ""}`} disabled={busyKey !== null} onClick={() => void handleRevokeDevice(device)}>
                    {armedDeviceId === device.id ? t("settings.selfHostedRevokeConfirm") : t("settings.selfHostedRevoke")}
                  </button>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}

      {!loading && tab === "invites" ? (
        <div className="self-hosted-invite-list">
          {pendingRequests.map((request) => (
            <article key={request.id} className="self-hosted-request-row">
              <div className="self-hosted-request-copy">
                <span>{t("settings.selfHostedApprovalRequired")}</span>
                <strong>{request.deviceName}</strong>
                <small>{request.platform}</small>
              </div>
              <div className="self-hosted-request-code"><span>{t("settings.selfHostedPairingConfirmation")}</span><strong>{request.confirmationCode}</strong></div>
              <div className="self-hosted-request-actions">
                <button type="button" className="sync-settings-inline-action" disabled={busyKey !== null} onClick={() => void handleDecision(request, false)}>{t("settings.selfHostedDeny")}</button>
                <button type="button" className="sync-settings-primary-action" disabled={busyKey !== null} onClick={() => void handleDecision(request, true)}>{t("settings.selfHostedApprove")}</button>
              </div>
            </article>
          ))}
          {activeInvites.map((invite) => (
            <article key={invite.id} className="self-hosted-device-row">
              <span className="self-hosted-row-icon"><InviteGlyph /></span>
              <div className="self-hosted-row-copy">
                <div><strong>{invite.label}</strong><span>{invite.role === "owner" ? t("settings.selfHostedOwnerRole") : t("settings.selfHostedGuestRole")}</span></div>
                <small>{t("settings.selfHostedInviteCodeEnding", { code: invite.codeHint })}</small>
                <small>{t("settings.selfHostedInviteExpires", { date: formatter.format(invite.expiresAt) })}</small>
              </div>
              <button type="button" className="sync-settings-inline-action is-danger" disabled={busyKey !== null} onClick={() => void handleRevokeInvite(invite.id)}>{t("settings.selfHostedRevoke")}</button>
            </article>
          ))}
          {pendingRequests.length === 0 && activeInvites.length === 0 ? <div className="self-hosted-access-empty">{t("settings.selfHostedNoInvites")}</div> : null}
        </div>
      ) : null}

      {inviteLayer}
    </div>
  );
}
