import { invoke } from "@tauri-apps/api/core";

import { getErrorMessage } from "./errors";
import { isAndroidRuntime } from "./runtime";

const ANDROID_GOOGLE_DRIVE_TOKEN_TTL_SECONDS = 55 * 60;

type AndroidGoogleDriveAuthorizationResponse = {
  accessToken?: string;
  expiresIn?: number;
  grantedScopes?: string[];
  userId?: string | null;
  userName?: string | null;
  userEmail?: string | null;
};

let androidOAuthPrepared = false;

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeAndroidInvokeError(error: unknown) {
  return new Error(getErrorMessage(error, "GOOGLE_OAUTH_FAILED"));
}

export function isAndroidGoogleDriveOauthRuntime() {
  return isAndroidRuntime();
}

export function androidGoogleDriveOAuthReady() {
  return isAndroidGoogleDriveOauthRuntime() && androidOAuthPrepared;
}

export async function prepareGoogleDriveAndroidOAuth() {
  if (!isAndroidGoogleDriveOauthRuntime()) {
    throw new Error("GOOGLE_OAUTH_UNAVAILABLE");
  }

  try {
    await invoke("android_google_drive_check_availability");
  } catch (error) {
    throw normalizeAndroidInvokeError(error);
  }

  androidOAuthPrepared = true;
}

export async function requestGoogleDriveAndroidAccessToken(options: {
  scopes: readonly string[];
  silent?: boolean;
}) {
  if (!isAndroidGoogleDriveOauthRuntime()) {
    throw new Error("GOOGLE_OAUTH_UNAVAILABLE");
  }

  let response: AndroidGoogleDriveAuthorizationResponse;

  try {
    response = await invoke<AndroidGoogleDriveAuthorizationResponse>("android_google_drive_authorize", {
      scopes: [...options.scopes],
      silent: options.silent === true
    });
  } catch (error) {
    throw normalizeAndroidInvokeError(error);
  }

  const accessToken = normalizeText(response.accessToken);

  if (!accessToken) {
    throw new Error("GOOGLE_DRIVE_AUTH_REQUIRED");
  }

  return {
    access_token: accessToken,
    expires_in:
      typeof response.expiresIn === "number" && Number.isFinite(response.expiresIn)
        ? Math.max(30, response.expiresIn)
        : ANDROID_GOOGLE_DRIVE_TOKEN_TTL_SECONDS,
    scope: Array.isArray(response.grantedScopes)
      ? response.grantedScopes.map(normalizeText).filter(Boolean).join(" ")
      : ""
  };
}

export async function clearGoogleDriveAndroidAccessToken(token: string) {
  const normalizedToken = token.trim();

  if (!isAndroidGoogleDriveOauthRuntime() || !normalizedToken) {
    return;
  }

  try {
    await invoke("android_google_drive_clear_token", {
      token: normalizedToken
    });
  } catch (error) {
    throw normalizeAndroidInvokeError(error);
  }
}

export async function revokeGoogleDriveAndroidAccess() {
  if (!isAndroidGoogleDriveOauthRuntime()) {
    return;
  }

  try {
    await invoke("android_google_drive_revoke_access");
  } catch (error) {
    throw normalizeAndroidInvokeError(error);
  }
}
