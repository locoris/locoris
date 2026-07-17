import type { ReactNode, Ref } from "react";
import { createPortal } from "react-dom";
import MobileGlassHeader from "../MobileGlassHeader";
import SettingsSurface from "../SettingsSurface";
import "./SyncSettingsLayout.css";

interface SyncSettingsLayoutProps {
  title: string;
  kicker: ReactNode;
  caption: string;
  backLabel: string;
  closeLabel: string;
  backIcon: ReactNode;
  closeIcon: ReactNode;
  stageRef: Ref<HTMLDivElement>;
  wires: ReactNode;
  bindingHint?: ReactNode;
  children: ReactNode;
  onBack: () => void;
  onClose: () => void;
}

interface SyncSettingsDialogProps {
  open: boolean;
  kicker: ReactNode;
  title: ReactNode;
  closeLabel: string;
  closeIcon: ReactNode;
  children: ReactNode;
  onClose: () => void;
}

export function SyncSettingsLayout({
  title,
  kicker,
  caption: _caption,
  backLabel,
  closeLabel,
  backIcon,
  closeIcon,
  stageRef,
  wires,
  bindingHint,
  children,
  onBack,
  onClose
}: SyncSettingsLayoutProps) {
  return (
    <SettingsSurface className="sync-settings-panel-shell">
      <MobileGlassHeader
        className="settings-panel-header sync-settings-panel-header has-back-action"
        kicker={kicker}
        title={title}
        backLabel={backLabel}
        closeLabel={closeLabel}
        backIcon={backIcon}
        closeIcon={closeIcon}
        onBack={onBack}
        onClose={onClose}
      />
      <div className="sync-settings-workspace" ref={stageRef}>
        {wires}
        {children}
      </div>

      {bindingHint}
    </SettingsSurface>
  );
}

export function SyncSettingsDialog({
  open,
  kicker,
  title,
  closeLabel,
  closeIcon,
  children,
  onClose
}: SyncSettingsDialogProps) {
  if (!open) {
    return null;
  }

  const dialog = (
    <div className="sync-settings-modal-layer sync-settings-premium-dialog" role="dialog" aria-modal="true">
      <button className="sync-settings-modal-dim" aria-label={closeLabel} onClick={onClose} />
      <div className="sync-settings-modal-card">
        <MobileGlassHeader
          className="settings-panel-header sync-settings-dialog-header"
          kicker={kicker}
          title={title}
          closeLabel={closeLabel}
          closeIcon={closeIcon}
          onClose={onClose}
        />
        {children}
      </div>
    </div>
  );

  if (typeof document === "undefined") {
    return dialog;
  }

  return createPortal(dialog, document.body);
}
