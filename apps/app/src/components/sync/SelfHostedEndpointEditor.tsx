import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  loadPersonalServerAccess,
  loadPersonalServerPairingInfo,
  loadPersonalServerVaults
} from "../../lib/sync";
import {
  discoverSelfHostedServers,
  selfHostedDiscoveryAvailable,
  type DiscoveredSelfHostedServer
} from "../../lib/selfHostedDiscovery";
import { normalizeSelfHostedServerUrl } from "../../lib/selfHostedEndpointUpdates";
import type { SyncConnection, SyncRemoteVault } from "../../types";
import "./SelfHostedEndpointEditor.css";

type SelfHostedEndpointEditorProps = {
  connection: SyncConnection;
  initialServerUrl?: string;
  translateError: (message: string) => string;
  onUpdated: (result: {
    serverUrl: string;
    serverId: string;
    remoteVaults: SyncRemoteVault[];
  }) => void | Promise<void>;
  onCancel: () => void;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "SERVER_ERROR";
}

function DiscoveryGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4.6 8.3a10.7 10.7 0 0 1 14.8 0M7.6 11.4a6.5 6.5 0 0 1 8.8 0M10.5 14.4a2.3 2.3 0 0 1 3 0" />
      <circle cx="12" cy="18" r="1" className="self-hosted-endpoint-icon-accent" />
    </svg>
  );
}

export default function SelfHostedEndpointEditor({
  connection,
  initialServerUrl,
  translateError,
  onUpdated,
  onCancel
}: SelfHostedEndpointEditorProps) {
  const { t } = useTranslation();
  const discoveryAvailable = selfHostedDiscoveryAvailable();
  const [serverUrl, setServerUrl] = useState(initialServerUrl ?? connection.serverUrl);
  const [candidates, setCandidates] = useState<DiscoveredSelfHostedServer[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setServerUrl(initialServerUrl ?? connection.serverUrl);
    setError(null);
  }, [connection.id, connection.serverUrl, initialServerUrl]);

  const normalizedCurrentUrl = useMemo(() => {
    try {
      return normalizeSelfHostedServerUrl(connection.serverUrl);
    } catch {
      return connection.serverUrl;
    }
  }, [connection.serverUrl]);

  const discover = async () => {
    setDiscovering(true);
    setError(null);
    try {
      const discovered = await discoverSelfHostedServers();
      const matching = connection.selfHostedServerId
        ? discovered.filter((candidate) => candidate.serverId === connection.selfHostedServerId)
        : discovered;
      setCandidates(matching);
      if (matching.length === 1) {
        setServerUrl(matching[0].url);
      }
      if (matching.length === 0) {
        setError(t("settings.selfHostedEndpointNotFound"));
      }
    } catch (discoveryError) {
      setError(translateError(getErrorMessage(discoveryError)));
    } finally {
      setDiscovering(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (!connection.managementToken) {
        throw new Error("SELF_HOSTED_TOKEN_REQUIRED");
      }

      const nextServerUrl = normalizeSelfHostedServerUrl(serverUrl);
      if (nextServerUrl === normalizedCurrentUrl) {
        throw new Error("SELF_HOSTED_ADDRESS_UNCHANGED");
      }

      const [pairingInfo, access] = await Promise.all([
        loadPersonalServerPairingInfo(nextServerUrl),
        loadPersonalServerAccess(nextServerUrl, connection.managementToken)
      ]);
      const expectedServerId = connection.selfHostedServerId?.trim() ?? "";
      if (
        pairingInfo.serverId !== access.server.id ||
        (expectedServerId && pairingInfo.serverId !== expectedServerId)
      ) {
        throw new Error("SELF_HOSTED_SERVER_MISMATCH");
      }

      const remoteVaults = (
        await loadPersonalServerVaults(nextServerUrl, connection.managementToken)
      ).vaults;
      await onUpdated({
        serverUrl: nextServerUrl,
        serverId: access.server.id,
        remoteVaults
      });
    } catch (saveError) {
      setError(translateError(getErrorMessage(saveError)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="self-hosted-endpoint-editor">
      <div className="self-hosted-endpoint-current">
        <span>{t("settings.selfHostedEndpointCurrent")}</span>
        <strong>{connection.serverUrl}</strong>
      </div>

      <label className="self-hosted-endpoint-field">
        <span>{t("settings.selfHostedEndpointNew")}</span>
        <input
          type="url"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={serverUrl}
          placeholder="http://192.168.1.25:26747"
          onChange={(event) => {
            setServerUrl(event.target.value);
            setError(null);
          }}
        />
      </label>

      <div className="self-hosted-endpoint-discovery">
        <div className="self-hosted-endpoint-discovery-copy">
          <span className="self-hosted-endpoint-discovery-icon">
            <DiscoveryGlyph />
          </span>
          <div>
            <strong>{t("settings.selfHostedEndpointDiscoveryTitle")}</strong>
            <span>
              {discoveryAvailable
                ? t("settings.selfHostedEndpointDiscoveryDescription")
                : t("settings.selfHostedEndpointWebDescription")}
            </span>
          </div>
        </div>
        {discoveryAvailable ? (
          <button type="button" disabled={discovering || saving} onClick={() => void discover()}>
            {discovering
              ? t("settings.selfHostedEndpointDiscovering")
              : t("settings.selfHostedEndpointDiscover")}
          </button>
        ) : null}
      </div>

      {candidates.length > 0 ? (
        <div className="self-hosted-endpoint-candidates" role="list">
          {candidates.map((candidate) => (
            <button
              type="button"
              role="listitem"
              key={`${candidate.serverId}:${candidate.url}`}
              className={serverUrl === candidate.url ? "is-selected" : ""}
              onClick={() => {
                setServerUrl(candidate.url);
                setError(null);
              }}
            >
              <span>
                <strong>{candidate.url}</strong>
                <small>{candidate.host || candidate.name}</small>
              </span>
              <span>{t("settings.selfHostedEndpointFound")}</span>
            </button>
          ))}
        </div>
      ) : null}

      <p className="self-hosted-endpoint-safety">
        {t("settings.selfHostedEndpointSafety")}
      </p>
      {error ? <div className="self-hosted-endpoint-error" role="alert">{error}</div> : null}

      <div className="self-hosted-endpoint-actions">
        <button type="button" className="is-secondary" disabled={saving} onClick={onCancel}>
          {t("dialog.cancel")}
        </button>
        <button
          type="button"
          className="is-primary"
          disabled={saving || !serverUrl.trim()}
          onClick={() => void save()}
        >
          {saving
            ? t("settings.selfHostedEndpointVerifying")
            : t("settings.selfHostedEndpointSave")}
        </button>
      </div>
    </div>
  );
}
