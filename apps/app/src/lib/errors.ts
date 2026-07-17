const KNOWN_ERROR_CODES = [
  "SELF_HOSTED_URL_REQUIRED",
  "HOSTED_URL_REQUIRED",
  "SELF_HOSTED_TOKEN_REQUIRED",
  "HOSTED_SYNC_TOKEN_REQUIRED",
  "SELF_HOSTED_VAULT_REQUIRED",
  "HOSTED_VAULT_REQUIRED",
  "GOOGLE_DRIVE_AUTH_REQUIRED",
  "GOOGLE_DRIVE_INTERACTION_REQUIRED",
  "GOOGLE_DRIVE_CLIENT_ID_REQUIRED",
  "GOOGLE_DRIVE_STORAGE_QUOTA_EXCEEDED",
  "GOOGLE_DRIVE_RATE_LIMITED",
  "GOOGLE_DRIVE_PERMISSION_REQUIRED",
  "GOOGLE_DRIVE_REQUEST_TIMEOUT",
  "GOOGLE_DRIVE_FILE_NOT_FOUND",
  "GOOGLE_DRIVE_PAYLOAD_TOO_LARGE",
  "GOOGLE_DRIVE_INVALID_PAYLOAD",
  "GOOGLE_DRIVE_MANIFEST_CORRUPT",
  "GOOGLE_DRIVE_JOURNAL_CORRUPT",
  "GOOGLE_DRIVE_V2_DATA_CORRUPT",
  "GOOGLE_DRIVE_RESUMABLE_UPLOAD_FAILED",
  "GOOGLE_OAUTH_REVOKE_FAILED",
  "GOOGLE_OAUTH_ANDROID_CONFIG_INVALID",
  "GOOGLE_OAUTH_INVALID_REQUEST",
  "GOOGLE_OAUTH_NOT_READY",
  "GOOGLE_OAUTH_POPUP_CLOSED",
  "GOOGLE_OAUTH_ACCESS_DENIED",
  "GOOGLE_OAUTH_POPUP_FAILED",
  "GOOGLE_OAUTH_BROWSER_OPEN_FAILED",
  "GOOGLE_OAUTH_REDIRECT_TIMEOUT",
  "GOOGLE_OAUTH_CALLBACK_FAILED",
  "GOOGLE_OAUTH_DESKTOP_INSTALL_REQUIRED",
  "GOOGLE_OAUTH_IN_PROGRESS",
  "GOOGLE_OAUTH_SCRIPT_FAILED",
  "GOOGLE_OAUTH_UNAVAILABLE",
  "GOOGLE_OAUTH_FAILED",
  "GOOGLE_PLAY_SERVICES_UNAVAILABLE",
  "NETWORK_ERROR",
  "SERVER_UNAVAILABLE",
  "UNAUTHORIZED",
  "INVALID_CREDENTIALS",
  "PLAN_REQUIRED",
  "TRIAL_EXPIRED",
  "TRIAL_EXPIRED_READ_ONLY",
  "TRIAL_ARCHIVED",
  "TRIAL_RETENTION_EXPIRED",
  "SUBSCRIPTION_PAST_DUE",
  "SUBSCRIPTION_EXPIRED_READ_ONLY",
  "SUBSCRIPTION_BLOCKED",
  "OVER_STORAGE_LIMIT",
  "OVER_VAULT_LIMIT",
  "OVER_DEVICE_LIMIT",
  "PAYLOAD_TOO_LARGE",
  "RATE_LIMITED",
  "VAULT_ENCRYPTION_LOCKED",
  "VAULT_ENCRYPTION_REMOTE_SYNC_REQUIRED",
  "SYNC_FAILED"
] as const;

function normalizeKnownErrorCode(message: string) {
  const normalized = message.trim();

  if (!normalized) {
    return "";
  }

  return KNOWN_ERROR_CODES.find((code) => normalized === code || normalized.includes(code)) ?? normalized;
}

export function getErrorMessage(error: unknown, fallback = "SYNC_FAILED") {
  if (error instanceof Error && error.message.trim()) {
    return normalizeKnownErrorCode(error.message);
  }

  if (typeof error === "string" && error.trim()) {
    return normalizeKnownErrorCode(error);
  }

  if (error && typeof error === "object") {
    const candidate = error as {
      code?: unknown;
      error?: unknown;
      message?: unknown;
    };

    if (typeof candidate.message === "string" && candidate.message.trim()) {
      return normalizeKnownErrorCode(candidate.message);
    }

    if (typeof candidate.code === "string" && candidate.code.trim()) {
      return normalizeKnownErrorCode(candidate.code);
    }

    if (typeof candidate.error === "string" && candidate.error.trim()) {
      return normalizeKnownErrorCode(candidate.error);
    }
  }

  return fallback;
}
