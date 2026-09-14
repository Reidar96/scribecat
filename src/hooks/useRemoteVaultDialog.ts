import { useCallback, useEffect, useState } from "react";

import type { RemoteVaultDialogRequest } from "@/components/remote/RemoteVaultDialog";
import { watchMarkdownFolder } from "@/lib/fileSystem";
import { onRemoteVaultUnauthorized, remoteVaultFor } from "@/lib/remoteVaults";
import { platform } from "@/platform";
import { useAppStore } from "@/store/useAppStore";

type UseRemoteVaultDialogOptions = {
  /** Opens a vault by its root, through the unsaved-changes guard. */
  openVault: (folderPath: string) => Promise<void> | void;
};

/**
 * State of the one dialog behind "Add server vault…" and "Sign in again".
 *
 * The sign-in half is driven by the server: whenever a request or the live
 * connection is refused for lack of a valid token (revoked from the browser,
 * or the password changed), the dialog appears instead of a failed listing
 * and a silent error. After a new token the open vault picks up where it
 * was (list refreshed, live connection restarted, unsaved edits kept); a
 * vault that failed to open in the first place is opened now.
 */
export function useRemoteVaultDialog({ openVault }: UseRemoteVaultDialogOptions) {
  const [request, setRequest] = useState<RemoteVaultDialogRequest | null>(null);

  useEffect(() => {
    if (!platform.features.remoteVaults) {
      return;
    }

    return onRemoteVaultUnauthorized((root) => {
      const entry = remoteVaultFor(root);

      if (!entry) {
        return;
      }

      setRequest((current) => (current?.mode === "signIn" && current.entry.root === root ? current : { mode: "signIn", entry }));
    });
  }, []);

  const openAddDialog = useCallback(() => setRequest({ mode: "add" }), []);
  const close = useCallback(() => setRequest(null), []);

  const handleDone = useCallback(
    (root: string) => {
      const wasSignIn = request?.mode === "signIn";
      setRequest(null);

      const { folderPath, refreshFolderFiles } = useAppStore.getState();

      if (wasSignIn && folderPath === root) {
        void watchMarkdownFolder(root).catch(() => undefined);
        void refreshFolderFiles();
        return;
      }

      void openVault(root);
    },
    [openVault, request]
  );

  return { request, openAddDialog, close, handleDone };
}
