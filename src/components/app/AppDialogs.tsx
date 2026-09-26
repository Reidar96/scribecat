import type { AppUpdate } from "@/platform/types";

import { DeleteFileDialog } from "@/components/DeleteFileDialog";
import { ExportDialog, type ExportDialogTarget } from "@/components/ExportDialog";
import type { MarkdownFileRecord } from "@/lib/fileSystem";
import { ImportDialog } from "@/components/ImportDialog";
import { MoveToDialog, type MoveRequest } from "@/components/MoveToDialog";
import { SaveConflictDialog } from "@/components/SaveConflictDialog";
import { SettingsDialog, type SettingsTab } from "@/components/SettingsDialog";
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog";
import { UpdateNotification } from "@/components/UpdateNotification";
import { VersionDiffDialog, type VersionDiffTarget } from "@/components/VersionDiffDialog";
import type { DeleteTarget } from "@/hooks/useDeleteTarget";
import type { FileVersion } from "@/lib/fileVersions";
import type { ImportSource } from "@/lib/import/importer";

type AppDialogsProps = {
  // Closing a dirty entry of the "In progress" list (hooks/useWorkingSetActions.ts)
  closingFileLabel: string | null;
  onSaveAndClose: () => void;
  onDiscardAndClose: () => void;
  onCancelClose: () => void;

  // A save that met an external change to the file (store: saveConflict)
  saveConflictFileLabel: string | null;
  isSaving: boolean;
  onOverwriteConflict: () => void;
  onDismissConflict: () => void;

  // Settings
  isSettingsOpen: boolean;
  settingsInitialTab: SettingsTab;
  onCloseSettings: () => void;
  onLogoutRequest: () => void;
  onAddRemoteVault?: () => void;

  // Move to folder (tree context menu)
  moveRequest: MoveRequest | null;
  fileRelativePaths: string[];
  emptyFolderRelativePaths: string[];
  isMoving: boolean;
  onConfirmMove: (targetRelativePath: string) => void;
  onCancelMove: () => void;

  // Delete
  deleteTarget: DeleteTarget | null;
  deleteTargetLabel: string | null;
  isDeleting: boolean;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;

  // Export
  exportTarget: ExportDialogTarget | null;
  readMarkdownForExport: (filePath: string) => Promise<string>;
  resolveOrderedExportRecords: (target: ExportDialogTarget) => MarkdownFileRecord[];
  onCloseExport: () => void;

  // Import
  importFileList: ImportSource[] | null;
  folderPath: string | null;
  importTargetFolder: string | null;
  importSkippedCount: number;
  importLimitReached: boolean;
  onImported: (createdFilePaths: string[]) => void;
  onCloseImport: () => void;

  // Update
  availableUpdate: AppUpdate | null;
  onDismissUpdate: () => void;

  // Version diff
  versionDiffTarget: VersionDiffTarget | null;
  versionDiffCurrentContent: string;
  isRestoringVersion: boolean;
  onRestoreVersion: (version: FileVersion) => void;
  onCloseVersionDiff: () => void;
};

export function AppDialogs({
  closingFileLabel,
  onSaveAndClose,
  onDiscardAndClose,
  onCancelClose,
  saveConflictFileLabel,
  isSaving,
  onOverwriteConflict,
  onDismissConflict,
  isSettingsOpen,
  settingsInitialTab,
  onCloseSettings,
  onLogoutRequest,
  onAddRemoteVault,
  moveRequest,
  fileRelativePaths,
  emptyFolderRelativePaths,
  isMoving,
  onConfirmMove,
  onCancelMove,
  deleteTarget,
  deleteTargetLabel,
  isDeleting,
  onConfirmDelete,
  onCancelDelete,
  exportTarget,
  readMarkdownForExport,
  resolveOrderedExportRecords,
  onCloseExport,
  importFileList,
  folderPath,
  importTargetFolder,
  importSkippedCount,
  importLimitReached,
  onImported,
  onCloseImport,
  availableUpdate,
  onDismissUpdate,
  versionDiffTarget,
  versionDiffCurrentContent,
  isRestoringVersion,
  onRestoreVersion,
  onCloseVersionDiff
}: AppDialogsProps) {
  return (
    <>
      <UnsavedChangesDialog
        open={closingFileLabel !== null}
        fileLabel={closingFileLabel}
        isSaving={isSaving}
        onSave={onSaveAndClose}
        onDiscard={onDiscardAndClose}
        onCancel={onCancelClose}
      />

      <SaveConflictDialog
        open={saveConflictFileLabel !== null}
        fileLabel={saveConflictFileLabel}
        isSaving={isSaving}
        onOverwrite={onOverwriteConflict}
        onCancel={onDismissConflict}
      />

      <SettingsDialog
        open={isSettingsOpen}
        initialTab={settingsInitialTab}
        onClose={onCloseSettings}
        onLogoutRequest={onLogoutRequest}
        onAddRemoteVault={onAddRemoteVault}
      />

      <MoveToDialog
        request={moveRequest}
        fileRelativePaths={fileRelativePaths}
        emptyFolderRelativePaths={emptyFolderRelativePaths}
        isMoving={isMoving}
        onConfirm={onConfirmMove}
        onCancel={onCancelMove}
      />

      <DeleteFileDialog
        open={deleteTarget !== null}
        kind={deleteTarget && deleteTarget.kind !== "multiple" ? deleteTarget.kind : "file"}
        fileLabel={deleteTargetLabel}
        count={deleteTarget?.kind === "multiple" ? deleteTarget.paths.length : undefined}
        isDeleting={isDeleting}
        onConfirm={onConfirmDelete}
        onCancel={onCancelDelete}
      />

      <ExportDialog
        target={exportTarget}
        readMarkdown={readMarkdownForExport}
        resolveOrderedRecords={resolveOrderedExportRecords}
        onClose={onCloseExport}
      />

      <ImportDialog
        files={importFileList}
        vaultRoot={folderPath}
        targetFolder={importTargetFolder}
        skippedCount={importSkippedCount}
        limitReached={importLimitReached}
        onImported={onImported}
        onClose={onCloseImport}
      />

      <VersionDiffDialog
        target={versionDiffTarget}
        folderPath={folderPath}
        currentContent={versionDiffCurrentContent}
        isRestoring={isRestoringVersion}
        onRestore={onRestoreVersion}
        onClose={onCloseVersionDiff}
      />

      {availableUpdate ? (
        <UpdateNotification update={availableUpdate} onDismiss={onDismissUpdate} />
      ) : null}
    </>
  );
}
