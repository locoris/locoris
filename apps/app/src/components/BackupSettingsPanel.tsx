import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  createLocorisBackupBlob,
  createReadableVaultZipBlob,
  getReadableVaultZipFileName,
  getVaultBackupFileName,
  parseLocorisBackupBlob,
  restoreLocorisBackupBlob,
  type VaultBackupParseResult
} from "../lib/exportImport/vaultBackup";
import {
  openBlobFileWithDialog,
  saveBlobFileWithDialog
} from "../lib/nativeFileIntegration";
import type { LocalVaultKind } from "../lib/localVaults";
import type { AppLanguage } from "../types";
import { createDateTimeFormatter, getCurrentLocaleRuntime } from "../localization";
import useAutoDismissNotice from "../lib/useAutoDismissNotice";
import ActionFeedbackToast, { useActionFeedbackAnchor } from "./ActionFeedbackToast";
import ConfirmDialog from "./ConfirmDialog";
import {
  usePrivateVaultWarning,
  type PrivateVaultWarningContext
} from "./PrivateVaultWarningDialog";
import "./BackupSettingsPanel.css";

type BackupBusyState = "backup" | "readable" | "restore" | null;
type BackupFeedback = {
  tone: "success" | "error" | "info";
  text: string;
} | null;

interface BackupSettingsPanelProps {
  activeLocalVaultId: string;
  vaultName: string;
  vaultKind: LocalVaultKind;
  language: AppLanguage;
}

export default function BackupSettingsPanel({
  activeLocalVaultId,
  vaultName,
  vaultKind,
  language
}: BackupSettingsPanelProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<BackupBusyState>(null);
  const [feedback, setFeedback] = useState<BackupFeedback>(null);
  const [pendingRestore, setPendingRestore] = useState<{
    fileName: string;
    blob: Blob;
    parsed: VaultBackupParseResult;
  } | null>(null);
  const feedbackAnchor = useActionFeedbackAnchor([".backup-settings-layout", ".confirm-dialog"]);
  useAutoDismissNotice(feedback, setFeedback);
  const readableDate = useMemo(
    () => createDateTimeFormatter(getCurrentLocaleRuntime(), {
      dateStyle: "medium",
      timeStyle: "short"
    }),
    [language]
  );
  const privateVaultWarningContext: PrivateVaultWarningContext = {
    localVaultId: activeLocalVaultId,
    vaultKind,
    vaultName
  };
  const { confirmPrivateVaultAction, privateVaultWarningDialog } =
    usePrivateVaultWarning(privateVaultWarningContext);

  const handleSaveExactBackup = async () => {
    if (!(await confirmPrivateVaultAction("backupExact"))) {
      return;
    }

    setBusy("backup");
    setFeedback(null);

    try {
      const blob = await createLocorisBackupBlob({
        localVaultId: activeLocalVaultId,
        vaultName
      });
      const didSave = await saveBlobFileWithDialog({
        defaultPath: getVaultBackupFileName(vaultName),
        filters: [
          {
            name: "Locoris Backup",
            extensions: ["locorisbackup"]
          }
        ],
        blob,
        preferredExtension: "locorisbackup"
      });

      if (didSave) {
        setFeedback({ tone: "success", text: t("settings.backupCreated") });
      }
    } catch {
      setFeedback({ tone: "error", text: t("settings.backupCreateFailed") });
    } finally {
      setBusy(null);
    }
  };

  const handleSaveReadableZip = async () => {
    if (!(await confirmPrivateVaultAction("backupReadable"))) {
      return;
    }

    setBusy("readable");
    setFeedback(null);

    try {
      const blob = await createReadableVaultZipBlob({
        localVaultId: activeLocalVaultId,
        vaultName,
        language
      });
      const didSave = await saveBlobFileWithDialog({
        defaultPath: getReadableVaultZipFileName(vaultName),
        filters: [
          {
            name: "ZIP",
            extensions: ["zip"]
          }
        ],
        blob,
        preferredExtension: "zip"
      });

      if (didSave) {
        setFeedback({ tone: "success", text: t("settings.backupReadableCreated") });
      }
    } catch {
      setFeedback({ tone: "error", text: t("settings.backupReadableFailed") });
    } finally {
      setBusy(null);
    }
  };

  const handlePickRestoreBackup = async () => {
    setBusy("restore");
    setFeedback(null);

    try {
      const file = await openBlobFileWithDialog({
        filters: [
          {
            name: "Locoris Backup",
            extensions: ["locorisbackup", "zip", "json"]
          }
        ]
      });

      if (!file) {
        return;
      }

      const parsed = await parseLocorisBackupBlob(file.blob);
      setPendingRestore({ fileName: file.fileName, blob: file.blob, parsed });
      setFeedback({ tone: "info", text: t("settings.backupValidated") });
    } catch {
      setFeedback({ tone: "error", text: t("settings.backupInvalid") });
    } finally {
      setBusy(null);
    }
  };

  const handleConfirmRestore = async () => {
    if (!pendingRestore) {
      return;
    }

    setBusy("restore");
    setFeedback(null);

    try {
      await restoreLocorisBackupBlob({
        localVaultId: activeLocalVaultId,
        blob: pendingRestore.blob
      });
      setPendingRestore(null);
      setFeedback({ tone: "success", text: t("settings.backupRestored") });
    } catch {
      setFeedback({ tone: "error", text: t("settings.backupRestoreFailed") });
    } finally {
      setBusy(null);
    }
  };

  const restoreDate = pendingRestore?.parsed.manifest?.exportedAt
    ? readableDate.format(pendingRestore.parsed.manifest.exportedAt)
    : pendingRestore?.parsed.backup.savedAt
      ? readableDate.format(pendingRestore.parsed.backup.savedAt)
      : "";

  return (
    <>
      <div className="backup-settings-layout">
        <section className="settings-panel-block backup-settings-card-grid">
          <button
            type="button"
            className="backup-settings-card"
            onClick={() => void handleSaveExactBackup()}
            disabled={busy !== null}
          >
            <span className="backup-settings-card-head">
              <strong>{t("settings.backupExactTitle")}</strong>
              <span>{busy === "backup" ? t("settings.backupWorking") : t("settings.backupExactChip")}</span>
            </span>
            <p>{t("settings.backupExactDescription")}</p>
          </button>

          <button
            type="button"
            className="backup-settings-card"
            onClick={() => void handlePickRestoreBackup()}
            disabled={busy !== null}
          >
            <span className="backup-settings-card-head">
              <strong>{t("settings.backupRestoreTitle")}</strong>
              <span>{busy === "restore" ? t("settings.backupWorking") : t("settings.backupRestoreChip")}</span>
            </span>
            <p>{t("settings.backupRestoreDescription")}</p>
          </button>

          <button
            type="button"
            className="backup-settings-card"
            onClick={() => void handleSaveReadableZip()}
            disabled={busy !== null}
          >
            <span className="backup-settings-card-head">
              <strong>{t("settings.backupReadableTitle")}</strong>
              <span>{busy === "readable" ? t("settings.backupWorking") : t("settings.backupReadableChip")}</span>
            </span>
            <p>{t("settings.backupReadableDescription")}</p>
          </button>
        </section>

        <section className="settings-panel-block backup-settings-note">
          <span>{t("settings.backupSafetyTitle")}</span>
          <p>{t("settings.backupSafetyDescription")}</p>
        </section>
      </div>

      {feedback ? (
        <ActionFeedbackToast
          anchor={feedbackAnchor}
          tone={feedback.tone}
          dismissLabel={t("orbit.closeModal")}
          onDismiss={() => setFeedback(null)}
        >
          {feedback.text}
        </ActionFeedbackToast>
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingRestore)}
        kicker={t("settings.backupRestoreKicker")}
        title={t("settings.backupRestoreConfirmTitle")}
        message={
          pendingRestore
            ? t("settings.backupRestoreConfirmMessage", {
                fileName: pendingRestore.fileName,
                vaultName: pendingRestore.parsed.manifest?.vaultName ?? pendingRestore.parsed.backup.localVaultId,
                date: restoreDate
              })
            : ""
        }
        details={[t("settings.backupRestoreConfirmDetail")]}
        confirmLabel={t("settings.backupRestoreConfirm")}
        cancelLabel={t("dialog.cancel")}
        tone="danger"
        onCancel={() => setPendingRestore(null)}
        onConfirm={() => void handleConfirmRestore()}
      />
      {privateVaultWarningDialog}
    </>
  );
}
