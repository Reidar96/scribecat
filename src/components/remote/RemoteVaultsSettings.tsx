import { useCallback, useState } from "react";
import { Plus, Server } from "lucide-react";
import { useTranslation } from "react-i18next";

import { DeviceList } from "@/components/remote/DeviceList";
import { Button } from "@/components/ui/button";
import { removeRecentFolderPath } from "@/lib/fileSystem";
import {
  listRemoteDevices,
  listRemoteVaults,
  removeRemoteVault,
  revokeRemoteDevice,
  type RemoteVaultEntry
} from "@/lib/remoteVaults";
import { useAppStore } from "@/store/useAppStore";

/**
 * The "Server" settings tab of the desktop app: every server vault the app
 * was given, each with the server's list of signed-in devices (this app
 * among them) and a way to add or forget a server connection.
 */
export function RemoteVaultsSettings({ onAdd }: { onAdd?: () => void }) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<RemoteVaultEntry[]>(() => listRemoteVaults());
  const [expandedRoot, setExpandedRoot] = useState<string | null>(null);
  const [busyRoot, setBusyRoot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const folderPath = useAppStore((state) => state.folderPath);
  const closeFolder = useAppStore((state) => state.closeFolder);

  const forget = useCallback(
    async (entry: RemoteVaultEntry, { revoke = true }: { revoke?: boolean } = {}) => {
      setBusyRoot(entry.root);
      setError(null);

      try {
        await removeRemoteVault(entry.root, { revoke });
        removeRecentFolderPath(entry.root);

        if (useAppStore.getState().folderPath === entry.root) {
          closeFolder();
        }

        setEntries(listRemoteVaults());
        setExpandedRoot((current) => (current === entry.root ? null : current));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : t("remoteVaults.removeFailed"));
      } finally {
        setBusyRoot(null);
      }
    },
    [closeFolder, t]
  );

  return (
    <div className="ai-dialog__grid">
      <h3 className="ai-dialog__field--full">{t("remoteVaults.settingsTitle")}</h3>
      <p className="ai-dialog__field--full ai-dialog__model-hint">{t("remoteVaults.settingsHint")}</p>

      {onAdd ? (
        <div className="ai-dialog__field--full">
          <Button type="button" variant="outline" onClick={onAdd}>
            <Plus />
            {t("sidebar.addServerVault")}
          </Button>
        </div>
      ) : null}

      {entries.length === 0 ? (
        <p className="ai-dialog__field--full ai-dialog__model-hint" data-testid="remote-vaults-empty">
          {t("remoteVaults.none")}
        </p>
      ) : (
        <ul className="ai-dialog__field--full remote-vault-list">
          {entries.map((entry) => {
            const isOpen = entry.root === folderPath;
            const isExpanded = entry.root === expandedRoot;

            return (
              <li key={entry.root} className="remote-vault-list__item" data-testid="remote-vault-item">
                <div className="remote-vault-list__row">
                  <Server className="size-4 remote-vault-list__icon" aria-hidden="true" />
                  <div className="remote-vault-list__text">
                    <span className="remote-vault-list__name">
                      {entry.name}
                      {isOpen ? <span className="device-list__badge">{t("remoteVaults.openNow")}</span> : null}
                    </span>
                    <span className="remote-vault-list__url">{entry.url}</span>
                  </div>
                  <div className="remote-vault-list__actions">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setExpandedRoot(isExpanded ? null : entry.root)}
                    >
                      {isExpanded ? t("remoteVaults.hideDevices") : t("remoteVaults.showDevices")}
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={busyRoot !== null}
                      onClick={() => void forget(entry)}
                      data-testid="remote-vault-forget"
                    >
                      {busyRoot === entry.root ? t("remoteVaults.disconnecting") : t("remoteVaults.disconnect")}
                    </Button>
                  </div>
                </div>

                {isExpanded ? (
                  <div className="remote-vault-list__devices">
                    <DeviceList
                      load={() => listRemoteDevices(entry.root)}
                      revoke={(id) => revokeRemoteDevice(entry.root, id)}
                      // Revoking this app's own token from the list is the same
                      // as disconnecting, minus the round trip to the server.
                      onRevokedCurrent={() => void forget(entry, { revoke: false })}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {error ? (
        <p className="ai-dialog__field--full ai-dialog__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
