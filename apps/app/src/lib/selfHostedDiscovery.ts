import { invoke } from "@tauri-apps/api/core";

import { isTauriRuntime } from "./runtime";

export type DiscoveredSelfHostedServer = {
  serverId: string;
  name: string;
  serviceName: string;
  host: string;
  addresses: string[];
  port: number;
  url: string;
};

export function selfHostedDiscoveryAvailable() {
  return isTauriRuntime();
}

export async function discoverSelfHostedServers(timeoutMs = 2_400) {
  if (!selfHostedDiscoveryAvailable()) {
    return [] satisfies DiscoveredSelfHostedServer[];
  }

  return invoke<DiscoveredSelfHostedServer[]>("discover_self_hosted_servers", {
    timeoutMs
  });
}
