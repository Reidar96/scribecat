import type { LocalEndpointDiagnosis, LocalModelsApi } from "@/platform/types";

/**
 * Why a request to a model server on the user's machine failed.
 *
 * The browser tells the page nothing beyond "Failed to fetch"; the reasons
 * (the local network access permission, the server's CORS policy, no server
 * at all) only show in the console. What the page can do is ask and probe:
 *
 *  1. The permission state. "denied" settles it. (Chrome and Edge ask a site
 *     loaded from a public address once before it may reach the local
 *     network; a site loaded from the home network is not asked.)
 *  2. A request in no-cors mode. It resolves with an opaque response when
 *     anything answered at the address, whatever the headers say, and rejects
 *     when nothing did, or when the browser would not let it out.
 *  3. A normal request to the provider's model list. Something answered in
 *     step 2, so a rejection here is the server refusing this page's origin.
 *
 * A dismissed permission prompt and a server that is not running look the
 * same from here (step 2 rejects, the permission stays at "prompt"), so
 * "unreachable" covers both, and its message names both.
 */

const PROBE_TIMEOUT_MS = 4000;

/** The models endpoint, which every provider answers to a plain GET. */
export function modelListUrl(provider: string, apiUrl: string): string {
  return new URL(provider === "ollama" ? "/api/tags" : "/v1/models", apiUrl).toString();
}

async function localNetworkPermission(): Promise<PermissionState | null> {
  try {
    const status = await navigator.permissions.query({ name: "local-network-access" as PermissionName });

    return status.state;
  } catch {
    // Browsers without the permission have no such rule to fail on either.
    return null;
  }
}

async function probe(url: string, mode: RequestMode): Promise<boolean> {
  try {
    await fetch(url, { mode, cache: "no-store", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });

    return true;
  } catch {
    return false;
  }
}

export async function diagnoseLocalEndpoint(provider: string, apiUrl: string): Promise<LocalEndpointDiagnosis> {
  let url: string;

  try {
    url = modelListUrl(provider, apiUrl);
  } catch {
    return "unreachable";
  }

  if ((await localNetworkPermission()) === "denied") {
    return "permission";
  }

  if (!(await probe(url, "no-cors"))) {
    return "unreachable";
  }

  return (await probe(url, "cors")) ? "ok" : "cors";
}

export const browserLocalModels: LocalModelsApi = {
  get origin() {
    return window.location.origin;
  },
  diagnose: diagnoseLocalEndpoint
};
