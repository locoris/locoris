import { isTauriRuntime } from "./runtime";
import { queueSelfHostedEndpointUpdate } from "./selfHostedEndpointUpdates";
import { queueIncomingSelfHostedConnectionPackage } from "./selfHostedPairing";

type ParsedSelfHostedDeepLink =
  | { kind: "connect"; payload: string }
  | { kind: "update"; serverId: string; serverUrl: string }
  | null;

function parseSelfHostedDeepLink(value: string): ParsedSelfHostedDeepLink {
  try {
    const url = new URL(value);
    if (url.protocol !== "locoris:" || url.hostname !== "self-hosted") {
      return null;
    }

    if (url.pathname === "/connect") {
      const payload = url.searchParams.get("payload")?.trim() ?? "";
      return payload ? { kind: "connect", payload } : null;
    }

    if (url.pathname === "/update") {
      const serverId = url.searchParams.get("serverId")?.trim() ?? "";
      const serverUrl = url.searchParams.get("serverUrl")?.trim() ?? "";
      return serverId && serverUrl ? { kind: "update", serverId, serverUrl } : null;
    }

    return null;
  } catch {
    return null;
  }
}

function acceptDeepLinks(urls: readonly string[]) {
  for (const value of urls) {
    const deepLink = parseSelfHostedDeepLink(value);
    if (!deepLink) continue;
    try {
      if (deepLink.kind === "connect") {
        queueIncomingSelfHostedConnectionPackage(deepLink.payload);
      } else {
        queueSelfHostedEndpointUpdate(deepLink);
      }
    } catch {
      // Ignore malformed external URLs; the relevant settings flow validates them again.
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
