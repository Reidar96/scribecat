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
  closingFileLabel: string | null;
  onSaveAndClose: () => void;
  onDiscardAndClose: () => void;
  onCancelClose: () => void;

  saveConflictFileLabel: string | null;
  isSaving: boolean;
  onOverwriteConflict: () => void;
  onDismissConflict: () => void;

  isSettingsOpen: boolean;
  settingsInitialTab: SettingsTab;
  onCloseSettings: () => void;

  moveRequest: MoveRequest | null;
  fileRelativePaths: string[];
  emptyFolderRelativePaths: string[];
  isMoving: boolean;
  onConfirmMove: (targetRelativePath: string) => void;
  onCancelMove: () => void;

  deleteTarget: DeleteTarget | null;
  deleteTargetLabel: string | null;
  isDeleting: boolean;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;

  exportTarget: ExportDialogTarget | null;
  readMarkdownForExport: (filePath: string) => Promise<string>;
  resolveOrderedExportRecords: (target: ExportDialogTarget) => MarkdownFileRecord[];
  onCloseExport: () => void;

  importFileList: ImportSource[] | null;
  folderPath: string | null;
  importTargetFolder: string | null;
  importSkippedCount: number;
  importLimitReached: boolean;
  onImported: (createdFilePaths: string[]) => void;
  onCloseImport: () => void;

  availableUpdate: AppUpdate | null;
  onDismissUpdate: () => void;

  versionDiffTarget: VersionDiffTarget | null;
  versionDiffCurrentContent: string;
  isRestoringVersion: boolean;
  onRestoreVersion: (version: FileVersion) => void;
  onCloseVersionDiff: () => void;
};

export function AppDialogs(props: AppDialogsProps) {
  return (
    <>
      <UnsavedChangesDialog
        open={props.closingFileLabel !== null}
        fileLabel={props.closingFileLabel}
        isSaving={props.isSaving}
        onSave={props.onSaveAndClose}
        onDiscard={props.onDiscardAndClose}
        onCancel={props.onCancelClose}
      />

      <SaveConflictDialog
        open={props.saveConflictFileLabel !== null}
        fileLabel={props.saveConflictFileLabel}
        isSaving={props.isSaving}
        onOverwrite={props.onOverwriteConflict}
        onCancel={props.onDismissConflict}
      />

      <SettingsDialog
        open={props.isSettingsOpen}
        initialTab={props.settingsInitialTab}
        onClose={props.onCloseSettings}
      />

      <MoveToDialog
        request={props.moveRequest}
        fileRelativePaths={props.fileRelativePaths}
        emptyFolderRelativePaths={props.emptyFolderRelativePaths}
        isMoving={props.isMoving}
        onConfirm={props.onConfirmMove}
        onCancel={props.onCancelMove}
      />

      <DeleteFileDialog
        open={props.deleteTarget !== null}
        kind={props.deleteTarget && props.deleteTarget.kind !== "multiple" ? props.deleteTarget.kind : "file"}
        fileLabel={props.deleteTargetLabel}
        count={props.deleteTarget?.kind === "multiple" ? props.deleteTarget.paths.length : undefined}
        isDeleting={props.isDeleting}
        onConfirm={props.onConfirmDelete}
        onCancel={props.onCancelDelete}
      />

      <ExportDialog
        target={props.exportTarget}
        readMarkdown={props.readMarkdownForExport}
        resolveOrderedRecords={props.resolveOrderedExportRecords}
        onClose={props.onCloseExport}
      />

      <ImportDialog
        files={props.importFileList}
        vaultRoot={props.folderPath}
        targetFolder={props.importTargetFolder}
        skippedCount={props.importSkippedCount}
        limitReached={props.importLimitReached}
        onImported={props.onImported}
        onClose={props.onCloseImport}
      />

      <VersionDiffDialog
        target={props.versionDiffTarget}
        folderPath={props.folderPath}
        currentContent={props.versionDiffCurrentContent}
        isRestoring={props.isRestoringVersion}
        onRestore={props.onRestoreVersion}
        onClose={props.onCloseVersionDiff}
      />

      {props.availableUpdate ? (
        <UpdateNotification update={props.availableUpdate} onDismiss={props.onDismissUpdate} />
      ) : null}
    </>
  );
}
