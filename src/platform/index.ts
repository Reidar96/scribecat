// `@platform-impl` is a Vite alias (see vite.config.ts): the desktop build
// resolves it to ./desktop, the web build (`--mode web`) to ./web. tsconfig
// maps it to the desktop implementation for type checking; both export the
// same `Platform` object, so either one is a valid target.
import { platform } from "@platform-impl";

import i18n from "@/i18n";

import { PlatformUnavailableError } from "./errors";
import type { FileSystemApi, VaultCapabilities, VaultStorage } from "./types";

export { platform };
export type * from "./types";
export { PlatformUnavailableError, SessionError } from "./errors";

/**
 * The storage of the vault that is open right now. Today that is fixed per
 * platform (a local folder on the desktop, the server's vault in the
 * browser); when the desktop app learns to open a server vault, this is
 * where the choice is made, and nothing above it has to change.
 */
export function getVaultStorage(): VaultStorage {
  return platform.vaultStorage;
}

/**
 * The machine's own filesystem, for files outside the vault. Callers sit
 * behind a feature flag (export, import, shortcuts file) and only reach this
 * on a platform that has one; the throw is the safety net, not the UX.
 */
export function requireLocalFs(): FileSystemApi {
  if (!platform.localFs) {
    throw new PlatformUnavailableError();
  }

  return platform.localFs;
}

/** What the open vault allows; the UI disables controls for anything missing. */
export function getVaultCapabilities(): VaultCapabilities {
  return getVaultStorage().capabilities;
}

/** Translated hint for a control that is disabled for lack of a capability. */
export function vaultCapabilityHint(): string {
  return i18n.t("platform.serverNotYetAvailable");
}
