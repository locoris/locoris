import { useTranslation } from "react-i18next";
import { createDateTimeFormatter, getCurrentLocaleRuntime } from "../../localization";

import { isWebRuntime } from "../../lib/runtime";
import type { HostedAccountDevice } from "../../types";
import "./AccountCloudDeviceList.css";

type DeviceKind = "android" | "ios" | "mac" | "windows" | "linux" | "web" | "desktop";

interface AccountCloudDeviceListProps {
  devices: HostedAccountDevice[];
  currentDeviceId: string;
  language: string;
  busyDeviceId?: string | null;
  online: boolean;
  onRequestRevoke: (device: HostedAccountDevice, current: boolean) => void;
}

function resolveDeviceKind(device: HostedAccountDevice, current: boolean): DeviceKind {
  const signature = `${device.clientPlatform ?? ""} ${device.deviceName ?? ""}`.toLowerCase();

  if ((current && isWebRuntime()) || /web|browser|chrome|safari|firefox|edge/.test(signature)) return "web";
  if (/android/.test(signature)) return "android";
  if (/iphone|ipad|ios/.test(signature)) return "ios";
  if (/macos|macintosh|mac os/.test(signature)) return "mac";
  if (/windows|win32|win64/.test(signature)) return "windows";
  if (/linux|ubuntu|fedora|debian/.test(signature)) return "linux";
  return "desktop";
}

function DeviceIcon({ kind }: { kind: DeviceKind }) {
  if (kind === "android") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m8.2 6.3-1.5-2.1M15.8 6.3l1.5-2.1M6.5 9.2h11v7.4a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2V9.2Z" />
        <path d="M5 10.3v5.4M19 10.3v5.4M9.2 18.6v2M14.8 18.6v2" />
        <circle cx="9.5" cy="12.1" r=".55" /><circle cx="14.5" cy="12.1" r=".55" />
      </svg>
    );
  }

  if (kind === "ios") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="7" y="2.8" width="10" height="18.4" rx="2.4" />
        <path d="M10 5.3h4M10.6 18.5h2.8" />
      </svg>
    );
  }

  if (kind === "windows") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3.5 5.4 10.8 4v7.2H3.5V5.4ZM12.5 3.7l8-1.2v8.7h-8V3.7ZM3.5 12.9h7.3V20l-7.3-1.1v-6ZM12.5 12.9h8v8.6l-8-1.2v-7.4Z" />
      </svg>
    );
  }

  if (kind === "web") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="2.8" y="4" width="18.4" height="16" rx="2.4" />
        <path d="M3 8h18M6 6h.1M8.5 6h.1" />
      </svg>
    );
  }

  if (kind === "linux") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="4" width="18" height="14" rx="2.3" />
        <path d="m7 9 2.4 2L7 13M12 13h4M8 21h8" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4" width="18" height="13.5" rx="2.3" />
      <path d="M8 21h8M12 17.5V21" />
      {kind === "mac" ? <path d="M10.1 10.8c.7-1.4 3.2-1.5 3.8 0-.5.4-.8 1-.8 1.7 0 .8.4 1.5 1 1.8-.4.9-1 1.7-1.7 1.7-.5 0-.8-.3-1.3-.3s-.9.3-1.3.3c-.8 0-1.7-1.2-1.9-2.5-.2-1.2.3-2.3 1.2-2.7.4-.2.7-.2 1-.1ZM12.9 8.2c0 .6-.5 1.3-1.2 1.4 0-.7.4-1.3 1.2-1.4Z" /> : null}
    </svg>
  );
}

function getPlatformLabel(device: HostedAccountDevice) {
  return device.clientPlatform?.trim() || "Locoris";
}

function getDeviceIdentifier(device: HostedAccountDevice) {
  const source = device.deviceId?.replace(/^device-/, "") || device.id.replace(/^dev-/, "");
  return source ? source.slice(0, 8) : "";
}

function RevokeGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M7.4 7.4a6.5 6.5 0 1 0 9.2 0M12 3.2v8.1" />
    </svg>
  );
}

export default function AccountCloudDeviceList({
  devices,
  currentDeviceId,
  language,
  busyDeviceId = null,
  online,
  onRequestRevoke
}: AccountCloudDeviceListProps) {
  const { t } = useTranslation();
  void language;
  const dateFormatter = createDateTimeFormatter(getCurrentLocaleRuntime(), {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });

  return (
    <div className="account-cloud-device-list">
      {devices.map((device) => {
        const current = Boolean(device.deviceId && device.deviceId === currentDeviceId);
        const kind = resolveDeviceKind(device, current);
        const vaultCount = device.vaultCount ?? device.vaultNames?.length ?? (device.vaultId ? 1 : 0);
        const lastUsedLabel = device.lastUsedAt
          ? t("settings.accountCloudDeviceLastUsed", { date: dateFormatter.format(device.lastUsedAt) })
          : t("settings.accountCloudDeviceNeverUsed");

        return (
          <article key={device.id} className={`account-cloud-device is-${kind} ${current ? "is-current" : ""}`}>
            <span className="account-cloud-device-icon" aria-hidden="true">
              <DeviceIcon kind={kind} />
            </span>
            <div className="account-cloud-device-copy">
              <div className="account-cloud-device-titleline">
                <strong>{current ? t("settings.accountCloudCurrentDevice") : device.deviceName}</strong>
                <span className={`account-cloud-device-state ${device.active ? "is-active" : "is-inactive"}`}>
                  {device.active
                    ? t("settings.accountCloudDeviceActive")
                    : t("settings.accountCloudDeviceInactive")}
                </span>
              </div>
              <span className="account-cloud-device-meta">
                <span>{getPlatformLabel(device)}</span>
                {getDeviceIdentifier(device) ? <span>#{getDeviceIdentifier(device)}</span> : null}
                <span>{lastUsedLabel}</span>
              </span>
              <span className="account-cloud-device-vaults">
                {t("settings.accountCloudDeviceVaultCount", { count: vaultCount })}
              </span>
            </div>
            {device.active ? (
              <button
                type="button"
                className={`account-cloud-device-revoke ${current ? "is-current" : ""}`}
                disabled={!online || Boolean(busyDeviceId)}
                onClick={() => onRequestRevoke(device, current)}
              >
                <RevokeGlyph />
                <span>
                  {busyDeviceId === device.id
                    ? t("settings.accountCloudDeviceRevoking")
                    : current
                      ? t("settings.accountCloudSignOutThisDevice")
                      : t("settings.accountCloudRevokeDevice")}
                </span>
              </button>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
