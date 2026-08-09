import packageManifest from "./package.json" with { type: "json" };

export const SERVER_VERSION = packageManifest.version;
export const SERVER_API_VERSION = 1;
export const SYNC_PROTOCOL_VERSION = 1;
export const PAIRING_PROTOCOL_VERSION = 1;
export const STORAGE_SCHEMA_VERSION = 2;
export const MIN_SUPPORTED_CLIENT_VERSION = "1.0.0";

export const SERVER_CONTRACT = Object.freeze({
  serverVersion: SERVER_VERSION,
  apiVersion: SERVER_API_VERSION,
  syncProtocolVersion: SYNC_PROTOCOL_VERSION,
  pairingProtocolVersion: PAIRING_PROTOCOL_VERSION,
  storageSchemaVersion: STORAGE_SCHEMA_VERSION,
  minimumClientVersion: MIN_SUPPORTED_CLIENT_VERSION
});
