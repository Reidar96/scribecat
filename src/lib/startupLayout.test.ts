import { describe, expect, it } from "vitest";
import { isWorkspaceReady } from "./startupLayout";

describe("startup workspace", () => {
  const ready = {
    startupFolderResolved: true,
    isLoading: false,
    folderPath: "/notes",
    vaultSettingsReady: true,
    vaultSettingsPath: "/notes",
    pluginsReady: true,
    pluginsVaultPath: "/notes"
  };

  it("shows the workspace only when all vault-dependent navigation is ready", () => {
    expect(isWorkspaceReady({ ...ready, startupFolderResolved: false, folderPath: null })).toBe(false);
    expect(isWorkspaceReady({ ...ready, isLoading: true })).toBe(false);
    expect(isWorkspaceReady({ ...ready, vaultSettingsReady: false })).toBe(false);
    expect(isWorkspaceReady({ ...ready, vaultSettingsPath: "/old-notes" })).toBe(false);
    expect(isWorkspaceReady({ ...ready, pluginsReady: false })).toBe(false);
    expect(isWorkspaceReady({ ...ready, pluginsVaultPath: "/old-notes" })).toBe(false);
    expect(isWorkspaceReady(ready)).toBe(true);
  });

  it("shows an intentionally empty workspace once startup has resolved", () => {
    expect(isWorkspaceReady({ ...ready, folderPath: null })).toBe(true);
  });
});
