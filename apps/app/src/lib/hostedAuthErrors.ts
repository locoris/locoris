import { getErrorMessage } from "./errors";

const HOSTED_REAUTH_ERROR_CODES = new Set([
  "UNAUTHORIZED",
  "CLOUD_REAUTH_REQUIRED",
  "REFRESH_TOKEN_REQUIRED",
  "REFRESH_TOKEN_INVALID",
  "REFRESH_TOKEN_REVOKED",
  "REFRESH_TOKEN_EXPIRED",
  "REFRESH_TOKEN_REUSED",
  "REFRESH_TOKEN_DEVICE_MISMATCH"
]);

export function isHostedReauthRequiredError(error: unknown) {
  return HOSTED_REAUTH_ERROR_CODES.has(getErrorMessage(error));
}
