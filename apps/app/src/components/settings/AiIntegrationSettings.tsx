import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import {
  deleteGeminiApiKey,
  GEMINI_MODEL_OPTIONS,
  isValidGeminiModelId,
  readGeminiApiKey,
  readStoredGeminiCanvasGenerationMode,
  readStoredGeminiEditorApplyMode,
  readStoredGeminiEditorFormat,
  readStoredGeminiModel,
  sanitizeGeminiModelId,
  testGeminiConnection,
  writeGeminiApiKey,
  writeStoredGeminiCanvasGenerationMode,
  writeStoredGeminiEditorApplyMode,
  writeStoredGeminiEditorFormat,
  writeStoredGeminiModel,
  type GeminiCanvasGenerationMode,
  type GeminiEditorApplyMode,
  type GeminiEditorFormat
} from "../../lib/aiIntegration";
import { useAndroidBackHandler } from "../../lib/useAndroidBackHandler";
import useAutoDismissNotice from "../../lib/useAutoDismissNotice";
import SettingsSubpageLayer from "../SettingsSubpageLayer";
import TransientNotice from "../TransientNotice";
import "./AiIntegrationSettings.css";

type AiFeedbackState = {
  tone: "success" | "error";
  text: string;
} | null;

type AiModelCheckFeedbackState = {
  tone: "success" | "error";
  text: string;
  modelId?: string;
} | null;

type AiBusyState = "saving" | "testing" | "checkingModel" | "disconnecting" | null;
type AiModelPickerTab = "presets" | "advanced";

interface AiIntegrationSettingsProps {
  onConnectionChange?: (connected: boolean) => void;
}

function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.2l1.9 5.1 5.1 1.9-5.1 1.9L12 17.2l-1.9-5.1L5 10.2l5.1-1.9L12 3.2Z" />
      <path d="M18.4 14.6l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8.8-2.1Z" />
      <path d="M5.7 15.5l.6 1.7 1.7.6-1.7.6-.6 1.7-.6-1.7-1.7-.6 1.7-.6.6-1.7Z" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14.3 9.7a4.2 4.2 0 1 1-2.5-2.5 4.2 4.2 0 0 1 2.5 2.5Z" />
      <path d="M14.2 9.8 21 3l-1.4-1.4M17.2 6.8l1.7 1.7M15.4 8.6l1.4 1.4" />
    </svg>
  );
}

function ModelIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7.5 4.5h9l3 5.2L12 21 4.5 9.7l3-5.2Z" />
      <path d="M4.7 9.8h14.6M8 5l4 16M16 5l-4 16" />
    </svg>
  );
}

function EditorIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 4.5h14v15H5z" />
      <path d="M8 8h8M8 11.5h6M8 15h7" />
    </svg>
  );
}

function CanvasIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4.5 6.5h15v11h-15z" />
      <path d="M8 15l3-3 2.2 2.2 2.6-3.4 3.7 4.7" />
      <path d="M8.3 9.2h.1" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.5 19 6v5.2c0 4.4-2.8 7.4-7 9.3-4.2-1.9-7-4.9-7-9.3V6l7-2.5Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function FlowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6.5 5.5h4v4h-4zM13.5 14.5h4v4h-4z" />
      <path d="M10.5 7.5h2.4c2.6 0 4.6 2.1 4.6 4.6v2.4M12 16.5H9.8a3.3 3.3 0 0 1-3.3-3.3V9.5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m5.5 12.5 4.2 4.2 8.8-9.4" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 7h9v9" />
      <path d="M17 7 7 17" />
      <path d="M14.5 18.5H5.5v-9" />
    </svg>
  );
}

export default function AiIntegrationSettings({
  onConnectionChange
}: AiIntegrationSettingsProps) {
  const { t } = useTranslation();
  const [aiKeyDraft, setAiKeyDraft] = useState("");
  const [aiModelId, setAiModelId] = useState(() => readStoredGeminiModel());
  const [aiModelDraft, setAiModelDraft] = useState(() => readStoredGeminiModel());
  const [aiEditorFormat, setAiEditorFormat] =
    useState<GeminiEditorFormat>(() => readStoredGeminiEditorFormat());
  const [aiEditorApplyMode, setAiEditorApplyMode] =
    useState<GeminiEditorApplyMode>(() => readStoredGeminiEditorApplyMode());
  const [aiCanvasGenerationMode, setAiCanvasGenerationMode] =
    useState<GeminiCanvasGenerationMode>(() => readStoredGeminiCanvasGenerationMode());
  const [aiFeedback, setAiFeedback] = useState<AiFeedbackState>(null);
  const [aiModelCheckFeedback, setAiModelCheckFeedback] =
    useState<AiModelCheckFeedbackState>(null);
  const [aiBusy, setAiBusy] = useState<AiBusyState>(null);
  const [aiKeyLoaded, setAiKeyLoaded] = useState(false);
  const [aiInstructionsOpen, setAiInstructionsOpen] = useState(false);
  const [aiModelPickerOpen, setAiModelPickerOpen] = useState(false);
  const [aiModelPickerTab, setAiModelPickerTab] = useState<AiModelPickerTab>("presets");

  useAutoDismissNotice(aiFeedback, setAiFeedback);

  const hasGeminiKey = aiKeyDraft.trim().length > 0;
  const selectedAiModelOption =
    GEMINI_MODEL_OPTIONS.find((model) => model.id === aiModelId) ?? null;
  const selectedAiModelLabel = selectedAiModelOption?.label ?? aiModelId;
  const selectedAiModelDescription = selectedAiModelOption
    ? t(selectedAiModelOption.descriptionKey)
    : t("settings.aiModelCustomDescription");
  const normalizedAiModelDraft = sanitizeGeminiModelId(aiModelDraft);
  const aiModelDraftInvalid =
    normalizedAiModelDraft.length > 0 && !isValidGeminiModelId(normalizedAiModelDraft);
  const advancedAiModelVerified =
    aiModelCheckFeedback?.tone === "success" &&
    aiModelCheckFeedback.modelId === normalizedAiModelDraft;
  const aiConnectionLabel = hasGeminiKey
    ? t("settings.aiConnected")
    : t("settings.aiNotConnected");
  const aiLayerOpen = aiInstructionsOpen || aiModelPickerOpen;

  useAndroidBackHandler(aiLayerOpen, () => {
    if (aiModelPickerOpen) {
      setAiModelPickerOpen(false);
      return;
    }

    setAiInstructionsOpen(false);
  });

  const openAiModelPicker = () => {
    setAiModelPickerTab(selectedAiModelOption ? "presets" : "advanced");
    setAiModelPickerOpen(true);
  };

  useEffect(() => {
    let cancelled = false;

    void readGeminiApiKey()
      .then((apiKey) => {
        if (cancelled) {
          return;
        }

        setAiKeyDraft(apiKey);
        setAiKeyLoaded(true);
        onConnectionChange?.(apiKey.trim().length > 0);
      })
      .catch(() => {
        if (!cancelled) {
          setAiKeyLoaded(true);
          onConnectionChange?.(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [onConnectionChange]);

  useEffect(() => {
    if (!aiInstructionsOpen && !aiModelPickerOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAiInstructionsOpen(false);
        setAiModelPickerOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [aiInstructionsOpen, aiModelPickerOpen]);

  const getAiModelFeatureChip = (modelId: string) => {
    if (modelId === "gemini-3.1-flash-lite") {
      return { key: "settings.aiModelChipHighLimits", tone: "is-quota" };
    }

    if (modelId === "gemini-2.5-flash") {
      return { key: "settings.aiModelChipStable", tone: "is-balanced" };
    }

    if (modelId === "gemma-4-31b-it") {
      return { key: "settings.aiModelChipOpen", tone: "is-open" };
    }

    if (modelId === "gemma-4-26b-a4b-it") {
      return { key: "settings.aiModelChipLean", tone: "is-fast" };
    }

    if (modelId === "gemini-2.5-flash-lite") {
      return { key: "settings.aiModelChipEconomy", tone: "is-quota" };
    }

    return { key: "settings.aiModelChipLowLimits", tone: "is-warning" };
  };

  const getAiModelBadgeTone = (modelId: string) => {
    if (modelId === "gemini-2.5-pro") {
      return "is-smart";
    }

    if (modelId.startsWith("gemma-")) {
      return "is-open";
    }

    if (modelId.includes("lite")) {
      return "is-fast";
    }

    return "is-balanced";
  };

  const renderAiModelChips = (
    model: (typeof GEMINI_MODEL_OPTIONS)[number] | null
  ) => {
    if (!model) {
      return (
        <span className="ai-settings-model-chip-row">
          <span className="ai-settings-model-chip is-live">
            {t("settings.aiModelCustomActive")}
          </span>
          <span className="ai-settings-model-chip is-quota">
            {t("settings.aiModelLiveCheckChip")}
          </span>
        </span>
      );
    }

    const featureChip = getAiModelFeatureChip(model.id);

    return (
      <span className="ai-settings-model-chip-row">
        <span className={`ai-settings-model-chip ${getAiModelBadgeTone(model.id)}`}>
          {t(model.badgeKey)}
        </span>
        <span className={`ai-settings-model-chip ${featureChip.tone}`}>
          {t(featureChip.key)}
        </span>
      </span>
    );
  };

  const selectAiModel = (modelId: string, closePicker = false) => {
    const normalizedModelId = sanitizeGeminiModelId(modelId);

    setAiModelId(normalizedModelId);
    setAiModelDraft(normalizedModelId);
    setAiFeedback(null);
    setAiModelCheckFeedback(null);

    if (closePicker) {
      setAiModelPickerOpen(false);
    }
  };

  const selectAiEditorFormat = (format: GeminiEditorFormat) => {
    setAiEditorFormat(format);
    writeStoredGeminiEditorFormat(format);
    setAiFeedback(null);
  };

  const selectAiEditorApplyMode = (mode: GeminiEditorApplyMode) => {
    setAiEditorApplyMode(mode);
    writeStoredGeminiEditorApplyMode(mode);
    setAiFeedback(null);
  };

  const selectAiCanvasGenerationMode = (mode: GeminiCanvasGenerationMode) => {
    setAiCanvasGenerationMode(mode);
    writeStoredGeminiCanvasGenerationMode(mode);
    setAiFeedback(null);
  };

  const handleUseAdvancedAiModel = () => {
    if (!isValidGeminiModelId(normalizedAiModelDraft)) {
      setAiModelCheckFeedback({
        tone: "error",
        text: t("settings.aiModelInvalid")
      });
      return;
    }

    if (!advancedAiModelVerified) {
      setAiModelCheckFeedback({
        tone: "error",
        text: t("settings.aiModelSelectRequiresCheck")
      });
      return;
    }

    selectAiModel(normalizedAiModelDraft, true);
    setAiFeedback({
      tone: "success",
      text: t("settings.aiModelSelectedAfterCheck", { model: normalizedAiModelDraft })
    });
  };

  const handleSaveAiIntegration = async () => {
    const apiKey = aiKeyDraft.trim();

    if (!apiKey) {
      setAiFeedback({
        tone: "error",
        text: t("settings.aiKeyRequired")
      });
      return;
    }

    if (!isValidGeminiModelId(aiModelId)) {
      setAiFeedback({
        tone: "error",
        text: t("settings.aiModelInvalid")
      });
      return;
    }

    setAiBusy("saving");
    setAiFeedback(null);

    try {
      await writeGeminiApiKey(apiKey);
      writeStoredGeminiModel(aiModelId);
      writeStoredGeminiEditorFormat(aiEditorFormat);
      writeStoredGeminiEditorApplyMode(aiEditorApplyMode);
      writeStoredGeminiCanvasGenerationMode(aiCanvasGenerationMode);
      onConnectionChange?.(true);
      setAiFeedback({
        tone: "success",
        text: t("settings.aiSaved")
      });
    } catch {
      setAiFeedback({
        tone: "error",
        text: t("settings.aiSaveFailed")
      });
    } finally {
      setAiBusy(null);
    }
  };

  const handleTestAiIntegration = async () => {
    const apiKey = aiKeyDraft.trim() || (await readGeminiApiKey());

    if (!apiKey) {
      setAiFeedback({
        tone: "error",
        text: t("settings.aiKeyRequired")
      });
      return;
    }

    if (!isValidGeminiModelId(aiModelId)) {
      setAiFeedback({
        tone: "error",
        text: t("settings.aiModelInvalid")
      });
      return;
    }

    setAiBusy("testing");
    setAiFeedback(null);

    try {
      writeStoredGeminiModel(aiModelId);
      writeStoredGeminiEditorFormat(aiEditorFormat);
      writeStoredGeminiEditorApplyMode(aiEditorApplyMode);
      writeStoredGeminiCanvasGenerationMode(aiCanvasGenerationMode);
      await testGeminiConnection(apiKey, aiModelId);
      onConnectionChange?.(true);
      setAiFeedback({
        tone: "success",
        text: t("settings.aiTestSuccess")
      });
    } catch {
      setAiFeedback({
        tone: "error",
        text: t("settings.aiTestFailed")
      });
    } finally {
      setAiBusy(null);
    }
  };

  const handleCheckAdvancedAiModel = async () => {
    const modelId = normalizedAiModelDraft;
    const apiKey = aiKeyDraft.trim() || (await readGeminiApiKey());

    if (!apiKey) {
      setAiModelCheckFeedback({
        tone: "error",
        text: t("settings.aiKeyRequired")
      });
      return;
    }

    if (!isValidGeminiModelId(modelId)) {
      setAiModelCheckFeedback({
        tone: "error",
        text: t("settings.aiModelInvalid")
      });
      return;
    }

    setAiBusy("checkingModel");
    setAiModelCheckFeedback(null);

    try {
      await testGeminiConnection(apiKey, modelId);
      setAiModelCheckFeedback({
        tone: "success",
        text: t("settings.aiModelCheckSuccess", { model: modelId }),
        modelId
      });
    } catch {
      setAiModelCheckFeedback({
        tone: "error",
        text: t("settings.aiModelCheckFailed", { model: modelId })
      });
    } finally {
      setAiBusy(null);
    }
  };

  const handleDisconnectAiIntegration = async () => {
    setAiBusy("disconnecting");
    setAiFeedback(null);

    try {
      await deleteGeminiApiKey();
      setAiKeyDraft("");
      onConnectionChange?.(false);
      setAiFeedback({
        tone: "success",
        text: t("settings.aiDisconnected")
      });
    } catch {
      setAiFeedback({
        tone: "error",
        text: t("settings.aiDisconnectFailed")
      });
    } finally {
      setAiBusy(null);
    }
  };

  const renderPreferenceOption = ({
    active,
    title,
    chip,
    description,
    icon,
    onClick
  }: {
    active: boolean;
    title: string;
    chip: string;
    description: string;
    icon: ReactNode;
    onClick: () => void;
  }) => (
    <button
      type="button"
      className={`ai-settings-choice ${active ? "is-active" : ""}`}
      onClick={onClick}
      role="radio"
      aria-checked={active}
    >
      <span className="ai-settings-choice-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="ai-settings-choice-copy">
        <span className="ai-settings-choice-head">
          <strong>{title}</strong>
          <em>{chip}</em>
        </span>
        <span>{description}</span>
      </span>
    </button>
  );

  return (
    <div className={`ai-settings-panel ${aiLayerOpen ? "is-layer-open" : ""}`}>
      <section className="ai-settings-hero-card">
        <div className="ai-settings-hero-main">
          <div className="ai-settings-orb" aria-hidden="true">
            <SparkIcon />
          </div>
          <div className="ai-settings-hero-copy">
            <p className="panel-kicker settings-panel-block-kicker">{t("settings.aiGemini")}</p>
            <h3>{t("settings.aiHeroTitle")}</h3>
            <p>{t("settings.aiHeroDescription")}</p>
          </div>
          <span className={`ai-settings-status ${hasGeminiKey ? "is-connected" : "is-empty"}`}>
            {aiConnectionLabel}
          </span>
        </div>

        <div className="ai-settings-connect-grid">
          <label className="ai-settings-field ai-settings-key-field">
            <span>{t("settings.aiApiKeyLabel")}</span>
            <input
              type="password"
              value={aiKeyDraft}
              onChange={(event) => {
                setAiKeyDraft(event.target.value);
                setAiFeedback(null);
              }}
              placeholder={
                aiKeyLoaded
                  ? t("settings.aiApiKeyPlaceholder")
                  : t("settings.aiLoadingKey")
              }
              autoComplete="off"
              spellCheck={false}
            />
          </label>

          <div className="ai-settings-connect-actions">
            <button
              type="button"
              className="ai-settings-soft-action"
              onClick={() => setAiInstructionsOpen(true)}
            >
              <KeyIcon />
              <span>{t("settings.aiGetKey")}</span>
            </button>
            <button
              type="button"
              className="settings-row-action ai-settings-primary-action"
              onClick={() => void handleSaveAiIntegration()}
              disabled={aiBusy !== null}
            >
              {aiBusy === "saving" ? t("settings.aiSaving") : t("settings.aiSave")}
            </button>
            <button
              type="button"
              className="settings-row-action settings-row-action-secondary"
              onClick={() => void handleTestAiIntegration()}
              disabled={aiBusy !== null}
            >
              {aiBusy === "testing" ? t("settings.aiTesting") : t("settings.aiTest")}
            </button>
            {hasGeminiKey ? (
              <button
                type="button"
                className="settings-row-action settings-row-action-danger"
                onClick={() => void handleDisconnectAiIntegration()}
                disabled={aiBusy !== null}
              >
                {aiBusy === "disconnecting"
                  ? t("settings.aiDisconnecting")
                  : t("settings.aiDisconnect")}
              </button>
            ) : null}
          </div>
        </div>

        {aiFeedback ? (
          <TransientNotice
            className="ai-settings-feedback"
            tone={aiFeedback.tone}
            dismissLabel={t("orbit.closeModal")}
            onDismiss={() => setAiFeedback(null)}
          >
            {aiFeedback.text}
          </TransientNotice>
        ) : null}
      </section>

      <div className="ai-settings-workspace">
        <main className="ai-settings-main">
          <section className="ai-settings-section">
            <div className="ai-settings-section-head">
              <div>
                <span className="ai-settings-section-kicker">{t("settings.aiModelLabel")}</span>
                <h3>{t("settings.aiSummaryModelTitle")}</h3>
              </div>
              <p>{t("settings.aiModelHint")}</p>
            </div>
            <button
              type="button"
              className="ai-settings-model-card"
              onClick={openAiModelPicker}
              aria-haspopup="dialog"
            >
              <span className="ai-settings-model-icon" aria-hidden="true">
                <ModelIcon />
              </span>
              <span className="ai-settings-model-copy">
                <small>{t("settings.aiModelSelected")}</small>
                <strong>{selectedAiModelLabel}</strong>
                <code>{aiModelId}</code>
                <span>{selectedAiModelDescription}</span>
              </span>
              <span className="ai-settings-model-side">
                {renderAiModelChips(selectedAiModelOption)}
                <em>{t("settings.aiModelChange")}</em>
              </span>
            </button>
          </section>

          <section className="ai-settings-section">
            <div className="ai-settings-section-head">
              <div>
                <span className="ai-settings-section-kicker">{t("settings.aiEditorBehaviorTitle")}</span>
                <h3>{t("settings.aiEditorFormatLabel")}</h3>
              </div>
              <p>{t("settings.aiEditorBehaviorDescription")}</p>
            </div>
            <div className="ai-settings-choice-grid" role="radiogroup" aria-label={t("settings.aiEditorFormatLabel")}>
              {renderPreferenceOption({
                active: aiEditorFormat === "markdown",
                title: t("settings.aiEditorFormatMarkdownTitle"),
                chip: t("settings.aiEditorFormatMarkdownChip"),
                description: t("settings.aiEditorFormatMarkdownDescription"),
                icon: <EditorIcon />,
                onClick: () => selectAiEditorFormat("markdown")
              })}
              {renderPreferenceOption({
                active: aiEditorFormat === "rich-json",
                title: t("settings.aiEditorFormatRichTitle"),
                chip: t("settings.aiEditorFormatRichChip"),
                description: t("settings.aiEditorFormatRichDescription"),
                icon: <EditorIcon />,
                onClick: () => selectAiEditorFormat("rich-json")
              })}
            </div>

            <div className="ai-settings-choice-grid" role="radiogroup" aria-label={t("settings.aiEditorApplyModeLabel")}>
              {renderPreferenceOption({
                active: aiEditorApplyMode === "diff",
                title: t("settings.aiEditorApplyModeDiffTitle"),
                chip: t("settings.aiEditorApplyModeDiffChip"),
                description: t("settings.aiEditorApplyModeDiffDescription"),
                icon: <FlowIcon />,
                onClick: () => selectAiEditorApplyMode("diff")
              })}
              {renderPreferenceOption({
                active: aiEditorApplyMode === "instant",
                title: t("settings.aiEditorApplyModeInstantTitle"),
                chip: t("settings.aiEditorApplyModeInstantChip"),
                description: t("settings.aiEditorApplyModeInstantDescription"),
                icon: <FlowIcon />,
                onClick: () => selectAiEditorApplyMode("instant")
              })}
            </div>
          </section>

          <section className="ai-settings-section">
            <div className="ai-settings-section-head">
              <div>
                <span className="ai-settings-section-kicker">{t("settings.aiCanvasGenerationModeLabel")}</span>
                <h3>{t("settings.aiSummaryCanvasTitle")}</h3>
              </div>
              <p>{t("settings.aiCanvasGenerationModeHint")}</p>
            </div>
            <div className="ai-settings-choice-grid" role="radiogroup" aria-label={t("settings.aiCanvasGenerationModeLabel")}>
              {renderPreferenceOption({
                active: aiCanvasGenerationMode === "mermaid",
                title: t("settings.aiCanvasGenerationMermaidTitle"),
                chip: t("settings.aiCanvasGenerationMermaidChip"),
                description: t("settings.aiCanvasGenerationMermaidDescription"),
                icon: <CanvasIcon />,
                onClick: () => selectAiCanvasGenerationMode("mermaid")
              })}
              {renderPreferenceOption({
                active: aiCanvasGenerationMode === "schema",
                title: t("settings.aiCanvasGenerationSchemaTitle"),
                chip: t("settings.aiCanvasGenerationSchemaChip"),
                description: t("settings.aiCanvasGenerationSchemaDescription"),
                icon: <CanvasIcon />,
                onClick: () => selectAiCanvasGenerationMode("schema")
              })}
            </div>
          </section>
        </main>
      </div>

      {aiModelPickerOpen ? (
        <SettingsSubpageLayer
          className="ai-settings-model-layer"
          contentClassName="ai-settings-model-subpage-content"
          kicker={t("settings.aiTitle")}
          title={t("settings.aiModelPickerTitle")}
          closeLabel={t("orbit.closeModal")}
          onClose={() => setAiModelPickerOpen(false)}
        >
          <nav className="ai-settings-model-tabs" role="tablist" aria-label={t("settings.aiModelPickerTitle")}>
            <button
              type="button"
              role="tab"
              className={aiModelPickerTab === "presets" ? "is-active" : ""}
              aria-selected={aiModelPickerTab === "presets"}
              onClick={() => setAiModelPickerTab("presets")}
            >
              <ModelIcon />
              <span>{t("settings.aiModelPresetTab")}</span>
            </button>
            <button
              type="button"
              role="tab"
              className={aiModelPickerTab === "advanced" ? "is-active" : ""}
              aria-selected={aiModelPickerTab === "advanced"}
              onClick={() => setAiModelPickerTab("advanced")}
            >
              <SparkIcon />
              <span>{t("settings.aiModelAdvancedTab")}</span>
            </button>
          </nav>

          {aiModelPickerTab === "presets" ? (
            <div key="presets" className="ai-settings-model-tab-panel" role="tabpanel">
              <div
                className="ai-settings-model-list"
                role="radiogroup"
                aria-label={t("settings.aiModelLabel")}
              >
                {GEMINI_MODEL_OPTIONS.map((model) => {
                  const active = aiModelId === model.id;

                  return (
                    <button
                      type="button"
                      key={model.id}
                      className={`ai-settings-model-option ${active ? "is-active" : ""}`}
                      onClick={() => selectAiModel(model.id, true)}
                      role="radio"
                      aria-checked={active}
                    >
                      <span className="ai-settings-model-active-dot" aria-hidden="true">
                        {active ? <CheckIcon /> : null}
                      </span>
                      <span className="ai-settings-model-option-head">
                        <span>
                          <strong>{model.label}</strong>
                          <code>{model.id}</code>
                        </span>
                        {renderAiModelChips(model)}
                      </span>
                      <small>{t(model.descriptionKey)}</small>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div key="advanced" className="ai-settings-model-tab-panel" role="tabpanel">
              <section className="ai-settings-advanced-model is-subpage-panel">
                <div className="ai-settings-advanced-head">
                  <span>{t("settings.aiModelAdvancedTitle")}</span>
                  <p>{t("settings.aiModelAdvancedDescription")}</p>
                </div>
                <label className="ai-settings-field">
                  <span>{t("settings.aiModelIdLabel")}</span>
                  <input
                    type="text"
                    value={aiModelDraft}
                    onChange={(event) => {
                      setAiModelDraft(event.target.value);
                      setAiFeedback(null);
                      setAiModelCheckFeedback(null);
                    }}
                    placeholder={t("settings.aiModelIdPlaceholder")}
                    autoComplete="off"
                    spellCheck={false}
                    className={aiModelDraftInvalid ? "is-invalid" : ""}
                  />
                </label>
                <div className="ai-settings-advanced-actions">
                  <button
                    type="button"
                    className="settings-row-action settings-row-action-secondary"
                    onClick={() => void handleCheckAdvancedAiModel()}
                    disabled={aiBusy !== null || normalizedAiModelDraft.length === 0}
                  >
                    {aiBusy === "checkingModel"
                      ? t("settings.aiModelChecking")
                      : t("settings.aiModelCheck")}
                  </button>
                  <button
                    type="button"
                    className="settings-row-action"
                    onClick={handleUseAdvancedAiModel}
                    disabled={aiBusy !== null || !advancedAiModelVerified}
                  >
                    {t("settings.aiModelUse")}
                  </button>
                </div>
                {aiModelCheckFeedback ? (
                  <p className={`ai-settings-feedback is-${aiModelCheckFeedback.tone}`}>
                    {aiModelCheckFeedback.text}
                  </p>
                ) : null}
                <p className="ai-settings-model-note">
                  {t("settings.aiModelAdvancedHint")}
                </p>
                <p className="ai-settings-model-note">
                  {t("settings.aiModelLimitsDisclaimer")}
                </p>
              </section>
            </div>
          )}
        </SettingsSubpageLayer>
      ) : null}

      {aiInstructionsOpen ? (
        <SettingsSubpageLayer
          className="ai-settings-guide-layer"
          contentClassName="ai-settings-guide-subpage-content"
          kicker={t("settings.aiTitle")}
          title={t("settings.aiInstructionsTitle")}
          closeLabel={t("orbit.closeModal")}
          onClose={() => setAiInstructionsOpen(false)}
        >
          <div className="ai-settings-guide-body">
            <ol className="ai-settings-steps">
              {[
                "settings.aiInstructionStep1",
                "settings.aiInstructionStep2",
                "settings.aiInstructionStep3",
                "settings.aiInstructionStep4",
                "settings.aiInstructionStep5"
              ].map((stepKey, index) => (
                <li key={stepKey}>
                  <span aria-hidden="true">{index + 1}</span>
                  <p>{t(stepKey)}</p>
                </li>
              ))}
            </ol>
            <div className="ai-settings-guide-card-grid">
              <article className="ai-settings-guide-card">
                <span className="ai-settings-summary-icon" aria-hidden="true">
                  <ShieldIcon />
                </span>
                <div>
                  <h4>{t("settings.aiPrivacyTitle")}</h4>
                  <p>{t("settings.aiPrivacyNote")}</p>
                </div>
              </article>
              <article className="ai-settings-guide-card">
                <span className="ai-settings-summary-icon" aria-hidden="true">
                  <FlowIcon />
                </span>
                <div>
                  <h4>{t("settings.aiFlowTitle")}</h4>
                  <p>{t("settings.aiFlowDescription")}</p>
                </div>
              </article>
            </div>
            <a
              className="ai-settings-external-action"
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noreferrer"
            >
              <ExternalIcon />
              <span>{t("settings.aiOpenGoogleAiStudio")}</span>
            </a>
          </div>
        </SettingsSubpageLayer>
      ) : null}
    </div>
  );
}
