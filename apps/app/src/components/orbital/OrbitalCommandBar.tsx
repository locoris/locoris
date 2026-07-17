import { useEffect, useRef, useState, type CSSProperties } from "react";

import LocalVaultSwitcher, { type LocalVaultSwitcherItem } from "../LocalVaultSwitcher";
import type { LocalVaultKind } from "../../lib/localVaults";
import "./OrbitalCommandBar.css";

type OrbitalSurfaceMode = "map" | "planner";
type CommandChipTone = "default" | "success" | "warning" | "error";
type CommandIconKind =
  | "map"
  | "planner"
  | "play"
  | "pause"
  | "plan"
  | "trash"
  | "settings"
  | "zoom-in"
  | "zoom-out"
  | "center"
  | "reset"
  | "close"
  | "account"
  | "cloud"
  | "sync-time"
  | "focus"
  | "autofocus"
  | "update";

interface CommandChip {
  tone: CommandChipTone;
  text: string;
  compactText?: string;
  title?: string;
  description?: string;
  primaryActionLabel?: string;
  secondaryActionLabel?: string;
  metaItems?: CommandAccountMetaItem[];
  meters?: CommandAccountMeter[];
  notice?: string;
}

interface CommandAccountMetaItem {
  label: string;
  value: string;
  tone?: CommandChipTone;
}

interface CommandAccountMeter {
  label: string;
  valueLabel: string;
  ratio: number | null;
  tone?: CommandChipTone;
}

interface OrbitalCommandBarLabels {
  title: string;
  subtitle: string;
  close: string;
  mapMode: string;
  plannerMode: string;
  pause: string;
  resume: string;
  zoomIn: string;
  zoomOut: string;
  resetView: string;
  centerSelection: string;
  focusMode: string;
  autoFocus: string;
  settings: string;
  trash: string;
  localVault: string;
}

interface OrbitalCommandBarProps {
  labels: OrbitalCommandBarLabels;
  surfaceMode: OrbitalSurfaceMode;
  plannerAvailable: boolean;
  activeVaultLabel: string;
  localVaultOptions: LocalVaultSwitcherItem[];
  activeLocalVaultId: string;
  autoFocusEnabled: boolean;
  sceneFocusActive: boolean;
  syncStatusChip?: CommandChip;
  syncTransportChip?: CommandChip | null;
  webAccessChip?: CommandChip | null;
  updateChip?: {
    text: string;
    title?: string;
  } | null;
  hasTrash: boolean;
  hasSettings: boolean;
  showClose: boolean;
  onSurfaceModeChange: (mode: OrbitalSurfaceMode) => void;
  onSelectLocalVault: (localVaultId: string) => void;
  onCreateLocalVault?: (input: {
    name: string;
    vaultKind: LocalVaultKind;
    passphrase?: string;
  }) => string | void | Promise<string | void>;
  onOpenTrash: () => void;
  onOpenSettings: () => void;
  onOpenWebAccess?: () => void;
  onClose: () => void;
}

function CommandIcon({ kind }: { kind: CommandIconKind }) {
  return <span className={`orbital-command-icon is-${kind}`} aria-hidden="true" />;
}

function CommandIconButton({
  icon,
  label,
  active = false,
  danger = false,
  disabled = false,
  onClick
}: {
  icon: CommandIconKind;
  label: string;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`orbital-command-button orbital-command-icon-button ${active ? "is-active" : ""} ${
        danger ? "is-danger" : ""
      }`}
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      disabled={disabled}
    >
      <CommandIcon kind={icon} />
    </button>
  );
}

function StatusChip({
  icon,
  text,
  compactText,
  title,
  tone = "default",
  className,
  asButton = false,
  onClick
}: {
  icon: CommandIconKind;
  text: string;
  compactText?: string;
  title?: string;
  tone?: CommandChipTone | "accent";
  className?: string;
  asButton?: boolean;
  onClick?: () => void;
}) {
  const chipClassName = `orbital-command-status-chip is-${tone} ${className ?? ""}`;
  const content = (
    <>
      <CommandIcon kind={icon} />
      <span className="orbital-command-status-text">{text}</span>
      {compactText ? <span className="orbital-command-status-compact-text">{compactText}</span> : null}
    </>
  );

  if (asButton && onClick) {
    return (
      <button type="button" className={chipClassName} title={title ?? text} onClick={onClick}>
        {content}
      </button>
    );
  }

  return (
    <span className={chipClassName} title={title ?? text}>
      {content}
    </span>
  );
}

function AccountStatusButton({
  status,
  onOpen
}: {
  status: CommandChip;
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const actionLabel = status.primaryActionLabel ?? status.text;
  const metaItems = status.metaItems ?? [];
  const meters = status.meters ?? [];

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!shellRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="orbital-command-account" ref={shellRef}>
      <button
        type="button"
        className={`orbital-command-account-button is-${status.tone}`}
        title={status.title ?? status.text}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <CommandIcon kind="account" />
        <span className="orbital-command-account-text">{status.compactText ?? status.text}</span>
      </button>
      {open ? (
        <section className={`orbital-command-account-popover is-${status.tone}`} role="dialog">
          <div className="orbital-command-account-popover-head">
            <span className="orbital-command-account-popover-icon" aria-hidden="true">
              <CommandIcon kind="cloud" />
            </span>
            <div>
              <strong>{status.title ?? status.text}</strong>
              {status.description ? <p>{status.description}</p> : null}
            </div>
          </div>
          {metaItems.length ? (
            <div className="orbital-command-account-meta" aria-label={status.title ?? status.text}>
              {metaItems.map((item) => (
                <div key={`${item.label}-${item.value}`} className={`orbital-command-account-meta-item is-${item.tone ?? "default"}`}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
          ) : null}
          {meters.length ? (
            <div className="orbital-command-account-meters">
              {meters.map((meter) => {
                const clampedRatio =
                  meter.ratio === null || !Number.isFinite(meter.ratio)
                    ? 1
                    : Math.max(0, Math.min(1, meter.ratio));

                return (
                  <div
                    key={meter.label}
                    className={`orbital-command-account-meter is-${meter.tone ?? "default"} ${
                      meter.ratio === null ? "is-unlimited" : ""
                    }`}
                    style={{ "--account-meter-fill": `${clampedRatio * 100}%` } as CSSProperties}
                  >
                    <div className="orbital-command-account-meter-copy">
                      <span>{meter.label}</span>
                      <strong>{meter.valueLabel}</strong>
                    </div>
                    <span className="orbital-command-account-meter-track" aria-hidden="true">
                      <span />
                    </span>
                  </div>
                );
              })}
            </div>
          ) : null}
          {status.notice ? <p className="orbital-command-account-notice">{status.notice}</p> : null}
          {onOpen ? (
            <button
              type="button"
              className="orbital-command-account-action"
              onClick={() => {
                setOpen(false);
                onOpen();
              }}
            >
              {actionLabel}
            </button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

export default function OrbitalCommandBar({
  labels,
  surfaceMode,
  plannerAvailable,
  activeVaultLabel,
  localVaultOptions,
  activeLocalVaultId,
  autoFocusEnabled,
  sceneFocusActive,
  syncStatusChip,
  syncTransportChip,
  webAccessChip,
  updateChip,
  hasTrash,
  hasSettings,
  showClose,
  onSurfaceModeChange,
  onSelectLocalVault,
  onCreateLocalVault,
  onOpenTrash,
  onOpenSettings,
  onOpenWebAccess,
  onClose
}: OrbitalCommandBarProps) {
  const hasAmbientStatus =
    autoFocusEnabled ||
    sceneFocusActive ||
    Boolean(updateChip);
  const hasSyncStatus = Boolean(syncStatusChip) || Boolean(syncTransportChip);

  return (
    <header className="orbital-command-bar">
      <div className="orbital-command-left">
        <div className="orbital-command-brand-panel">
          <span className="orbital-command-brand-mark" aria-hidden="true">
            <span />
          </span>
          <div className="orbital-command-title">
            <h1 className="orbital-command-brand">{labels.title}</h1>
            <p className="orbital-command-subtitle">{labels.subtitle}</p>
          </div>
        </div>

        <div className="orbital-command-vault">
          <LocalVaultSwitcher
            label={labels.localVault}
            activeLabel={activeVaultLabel}
            items={localVaultOptions}
            activeVaultId={activeLocalVaultId}
            onSelect={onSelectLocalVault}
            onCreate={onCreateLocalVault}
          />
        </div>
      </div>

      <div className="orbital-command-center">
        {plannerAvailable ? (
          <div className="orbital-surface-switch" role="tablist" aria-label={labels.title}>
            <button
              type="button"
              className={surfaceMode === "map" ? "is-active" : ""}
              onClick={() => onSurfaceModeChange("map")}
              aria-selected={surfaceMode === "map"}
              role="tab"
            >
              <CommandIcon kind="map" />
              <span>{labels.mapMode}</span>
            </button>
            <button
              type="button"
              className={surfaceMode === "planner" ? "is-active" : ""}
              onClick={() => onSurfaceModeChange("planner")}
              aria-selected={surfaceMode === "planner"}
              role="tab"
            >
              <CommandIcon kind="planner" />
              <span>{labels.plannerMode}</span>
            </button>
          </div>
        ) : null}
      </div>

      <div className="orbital-command-right">
        {hasAmbientStatus ? (
          <div className="orbital-command-status" aria-label={labels.title}>
            {autoFocusEnabled ? <StatusChip icon="autofocus" text={labels.autoFocus} tone="accent" className="is-state-chip" /> : null}
            {sceneFocusActive ? <StatusChip icon="focus" text={labels.focusMode} tone="accent" className="is-state-chip" /> : null}
            {updateChip && hasSettings ? (
              <StatusChip
                icon="update"
                text={updateChip.text}
                title={updateChip.title}
                tone="warning"
                className="is-update-chip"
                asButton
                onClick={onOpenSettings}
              />
            ) : null}
          </div>
        ) : null}

        {hasSyncStatus ? (
          <div className="orbital-command-sync-cluster" aria-label={labels.title}>
            <span
              className={`orbital-command-transport-slot ${syncTransportChip ? "has-chip" : ""}`}
              aria-hidden={!syncTransportChip}
            >
              {syncTransportChip ? (
                <StatusChip
                  icon="cloud"
                  text={syncTransportChip.text}
                  title={syncTransportChip.title}
                  tone={syncTransportChip.tone}
                  className="is-transport-chip"
                />
              ) : null}
            </span>
            {syncStatusChip ? (
              <StatusChip
                icon="sync-time"
                text={syncStatusChip.text}
                compactText={syncStatusChip.compactText}
                title={syncStatusChip.title}
                tone={syncStatusChip.tone}
                className="is-sync-chip"
              />
            ) : null}
          </div>
        ) : null}

        {webAccessChip ? <AccountStatusButton status={webAccessChip} onOpen={onOpenWebAccess} /> : null}

        <div className="orbital-command-actions" aria-label={labels.title}>
          {(hasTrash || hasSettings) && (
            <div className="orbital-command-group" aria-label={labels.settings}>
              {hasTrash ? <CommandIconButton icon="trash" label={labels.trash} onClick={onOpenTrash} danger /> : null}
              {hasSettings ? <CommandIconButton icon="settings" label={labels.settings} onClick={onOpenSettings} /> : null}
            </div>
          )}

          {showClose ? (
            <CommandIconButton icon="close" label={labels.close} onClick={onClose} danger />
          ) : null}
        </div>
      </div>
    </header>
  );
}
