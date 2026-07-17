import { isTauriRuntime } from "./runtime";
import { queueIncomingSelfHostedConnectionPackage } from "./selfHostedPairing";

function readPayloadFromDeepLink(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "locoris:" || url.hostname !== "self-hosted" || url.pathname !== "/connect") {
      return "";
    }
    return url.searchParams.get("payload")?.trim() ?? "";
  } catch {
    return "";
  }
}

function acceptDeepLinks(urls: readonly string[]) {
  for (const value of urls) {
    const payload = readPayloadFromDeepLink(value);
    if (!payload) continue;
    try {
      queueIncomingSelfHostedConnectionPackage(payload);
    } catch {
      // Ignore malformed external URLs; the pairing wizard validates accepted packages again.
    }
  }
}

export async function initializeSelfHostedDeepLinks() {
  if (!isTauriRuntime()) {
    return () => undefined;
  }

  const { getCurrent, onOpenUrl } = await import("@tauri-apps/plugin-deep-link");
  const current = await getCurrent().catch(() => null);
  if (current) acceptDeepLinks(current);
  return onOpenUrl((urls) => acceptDeepLinks(urls));
}
