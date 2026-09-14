import { createRemoteVaultStorage } from "@/platform/remote/remoteStorage";
import type { VaultStorage } from "@/platform/types";

import { serverApi } from "./serverApi";

/**
 * The one vault a ScribeDog server serves, seen through the store's
 * absolute-path model: a fixed virtual root, since there is nothing to choose
 * between in the browser. See platform/remote/remoteStorage.ts for the
 * mapping.
 */
export const REMOTE_VAULT_ROOT = "/vault";

export const remoteVaultStorage: VaultStorage = createRemoteVaultStorage(serverApi, REMOTE_VAULT_ROOT);
