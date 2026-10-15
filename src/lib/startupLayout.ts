type StartupLayoutState = {
  startupFolderResolved: boolean;
  isLoading: boolean;
  folderPath: string | null;
  vaultSettingsReady: boolean;
  vaultSettingsPath: string | null;
  pluginsReady: boolean;
  pluginsVaultPath: string | null;
};

/** Keep the workspace hidden until all vault-dependent navigation agrees on its vault. */
export function isWorkspaceReady(state: StartupLayoutState): boolean {
  if (!state.startupFolderResolved || state.isLoading) return false;
  if (state.folderPath === null) return true;
  return state.vaultSettingsReady && state.vaultSettingsPath === state.folderPath
    && state.pluginsReady && state.pluginsVaultPath === state.folderPath;
}
