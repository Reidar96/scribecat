import { useState, type RefObject } from "react";
import { ArrowLeft, ArrowRight, FolderOpen, MessagesSquare, PanelLeft, Pencil, Square } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Editor, type EditorHandle } from "@/components/Editor";
import { FindReplacePanel } from "@/components/FindReplacePanel";
import { VersionsPopover } from "@/components/VersionsPopover";
import { DocumentMenu } from "@/components/app/DocumentMenu";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import type { FileVersion } from "@/lib/fileVersions";
import { cn } from "@/lib/utils";
import { getVaultCapabilities, vaultCapabilityHint } from "@/platform";
import { useChatStore } from "@/store/useChatStore";
import { useSearchStore } from "@/store/useSearchStore";
import { useVersioningSettingsStore } from "@/store/useVersioningSettingsStore";

type DocumentPanelProps = {
  selectedFilePath: string | null;
  selectedFileLabel: string | null;
  selectedFileDirectoryLabel: string;
  /** The open note is a folder's note: titled after the folder, renaming renames the folder. */
  isSelectedFolderNote: boolean;
  folderPath: string | null;
  selectedFileContent: string | null;
  appVersion: string | null;

  /** Vault-relative label of the note a back/forward step opens, null when there is none. */
  backTargetLabel: string | null;
  forwardTargetLabel: string | null;
  onNavigateBack: () => void;
  onNavigateForward: () => void;

  isRenamingTitle: boolean;
  titleDraft: string;
  titleInputRef: RefObject<HTMLInputElement | null>;
  onTitleDraftChange: (value: string) => void;
  onCommitTitleRename: () => void;
  onCancelTitleRename: () => void;
  onStartTitleRename: () => void;

  isAiLoading: boolean;
  isSaving: boolean;
  isDirty: boolean;
  isSelectedFileMissing: boolean;
  isFileLoading: boolean;
  fileError: string | null;
  saveError: string | null;

  editorHandleRef: RefObject<EditorHandle | null>;
  editorFocusRequestId: number;
  onMarkdownChange: (markdown: string) => void;
  onCanonicalMarkdown: (filePath: string, markdown: string) => void;
  onRequestSidebarFocus: () => void;
  onRequestFileOpen: (targetFilePath: string) => void;
  onAiLoadingChange: (isLoading: boolean) => void;
  onAiPendingChange: (isPending: boolean) => void;
  onAiSettingsRequest: () => void;
  onZenModeRequest: () => void;
  onVersionDiffRequest: (version: FileVersion) => void;
  onVersionRestoreRequest: (version: FileVersion) => void;

  /** Phone layout: the sidebar is a sheet and this opens it. */
  onOpenSidebar: () => void;
  /** Phone and tablet: the status pill doubles as the save button. */
  onSaveRequest: () => void;
};

export function DocumentPanel({
  selectedFilePath,
  selectedFileLabel,
  selectedFileDirectoryLabel,
  isSelectedFolderNote,
  folderPath,
  selectedFileContent,
  appVersion,
  backTargetLabel,
  forwardTargetLabel,
  onNavigateBack,
  onNavigateForward,
  isRenamingTitle,
  titleDraft,
  titleInputRef,
  onTitleDraftChange,
  onCommitTitleRename,
  onCancelTitleRename,
  onStartTitleRename,
  isAiLoading,
  isSaving,
  isDirty,
  isSelectedFileMissing,
  isFileLoading,
  fileError,
  saveError,
  editorHandleRef,
  editorFocusRequestId,
  onMarkdownChange,
  onCanonicalMarkdown,
  onRequestSidebarFocus,
  onRequestFileOpen,
  onAiLoadingChange,
  onAiPendingChange,
  onAiSettingsRequest,
  onZenModeRequest,
  onVersionDiffRequest,
  onVersionRestoreRequest,
  onOpenSidebar,
  onSaveRequest
}: DocumentPanelProps) {
  const { t } = useTranslation();
  const layout = useLayoutMode();
  const isChatOpen = useChatStore((state) => state.isOpen);
  // Bumped by the header menu's "Versions" entry on the phone, where the
  // popover's own trigger button has no room in the header.
  const [versionsRequestId, setVersionsRequestId] = useState(0);
  const capabilities = getVaultCapabilities();
  const capabilityHint = vaultCapabilityHint();
  const versioningEnabled = useVersioningSettingsStore((state) => state.versioningEnabled);
  const closeFindPanel = useSearchStore((state) => state.closePanel);

  // Find & replace normally lives inside <Editor> (it needs the ProseMirror
  // document). Whenever no editor is mounted — no file open, or the selected
  // one still loading/failed — this standalone copy takes over so Ctrl+F is
  // never a dead shortcut; it searches the vault and jumps into the first hit.
  const isEditorMounted =
    Boolean(selectedFilePath) &&
    !fileError &&
    !saveError &&
    !isFileLoading &&
    selectedFileContent !== null;
  const standaloneFindPanel = isEditorMounted ? null : (
    <FindReplacePanel
      editor={null}
      folderPath={folderPath}
      // Kept even though there is no editor: it tells the panel a document
      // exists but is only mid-load, which must not silently switch the user
      // into all-files mode.
      filePath={selectedFilePath}
      onClose={closeFindPanel}
      onRequestFileOpen={onRequestFileOpen}
    />
  );

  return (
    <section className="detail-panel" aria-label={t("app.documentAreaLabel")}>
      {selectedFilePath ? (
        <div className="detail-panel__card detail-panel__card--document">
          {standaloneFindPanel}
          <div className="detail-panel__header">
            <div className="detail-panel__title">
              {layout === "phone" ? (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="detail-panel__sidebar-button"
                  aria-label={t("app.openSidebar")}
                  title={t("app.openSidebar")}
                  data-testid="open-sidebar"
                  onClick={onOpenSidebar}
                >
                  <PanelLeft />
                </Button>
              ) : null}
              {/* Navigation across notes belongs to the document as a whole, so
                  it sits with the file name rather than in the format toolbar.
                  On the phone it moves into the header menu. */}
              <div className="detail-panel__history">
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  disabled={backTargetLabel === null}
                  aria-label={t("app.navigateBack")}
                  title={
                    backTargetLabel
                      ? t("app.navigateBackTo", { fileLabel: backTargetLabel })
                      : t("app.navigateBack")
                  }
                  onClick={onNavigateBack}
                >
                  <ArrowLeft />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  disabled={forwardTargetLabel === null}
                  aria-label={t("app.navigateForward")}
                  title={
                    forwardTargetLabel
                      ? t("app.navigateForwardTo", { fileLabel: forwardTargetLabel })
                      : t("app.navigateForward")
                  }
                  onClick={onNavigateForward}
                >
                  <ArrowRight />
                </Button>
              </div>

              {isRenamingTitle ? (
                <h2 className="detail-panel__title-edit">
                  {selectedFileDirectoryLabel ? (
                    <span className="detail-panel__title-prefix">
                      {selectedFileDirectoryLabel}
                    </span>
                  ) : null}
                  <input
                    ref={titleInputRef}
                    className="detail-panel__title-input"
                    value={titleDraft}
                    onChange={(event) => onTitleDraftChange(event.target.value)}
                    onBlur={() => onCommitTitleRename()}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        onCommitTitleRename();
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        onCancelTitleRename();
                      }
                    }}
                    aria-label={t(isSelectedFolderNote ? "app.folderNameLabel" : "app.fileNameLabel")}
                    spellCheck={false}
                  />
                  {isSelectedFolderNote ? null : (
                    <span className="detail-panel__title-suffix">.md</span>
                  )}
                </h2>
              ) : (
                <>
                  <h2 data-testid="note-title">{selectedFileLabel}</h2>
                  {isSelectedFolderNote ? (
                    <span
                      className="detail-panel__title-badge"
                      title={t("app.folderNoteBadgeHint")}
                    >
                      <FolderOpen size={12} aria-hidden="true" />
                      {t("app.folderNoteBadge")}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="detail-panel__title-edit-button"
                    onClick={onStartTitleRename}
                    disabled={!capabilities.rename}
                    aria-label={t(isSelectedFolderNote ? "app.renameFolder" : "app.renameFile")}
                    title={
                      capabilities.rename
                        ? t(isSelectedFolderNote ? "app.renameFolder" : "app.renameFile")
                        : capabilityHint
                    }
                  >
                    <Pencil size={14} />
                  </button>
                </>
              )}
            </div>
            <div className="detail-panel__status-group">
              {isAiLoading ? (
                <div className="detail-panel__ai-chip" aria-live="polite">
                  <span className="detail-panel__ai-chip-message">{t("app.aiRequestRunning")}</span>
                  <button
                    type="button"
                    className="detail-panel__ai-chip-cancel"
                    onClick={() => editorHandleRef.current?.cancelAiRequest()}
                    aria-label={t("app.aiRequestCancel")}
                    title={t("app.aiRequestCancel")}
                  >
                    <Square size={10} fill="currentColor" strokeWidth={0} />
                  </button>
                </div>
              ) : null}
              {versioningEnabled ? (
                <VersionsPopover
                  folderPath={folderPath}
                  selectedFilePath={selectedFilePath}
                  onDiffRequest={onVersionDiffRequest}
                  onRestoreRequest={onVersionRestoreRequest}
                  triggerHidden={layout === "phone"}
                  openRequestId={versionsRequestId}
                />
              ) : null}
              {layout === "desktop" ? (
                <div
                  className={cn(
                    "detail-panel__status",
                    isSaving && "detail-panel__status--saving",
                    isDirty && "detail-panel__status--dirty",
                    isSelectedFileMissing && "detail-panel__status--warning"
                  )}
                  aria-live="polite"
                  data-testid="status"
                  data-dirty={isDirty ? "true" : "false"}
                >
                  {isSaving
                    ? t("app.statusSaving")
                    : isSelectedFileMissing
                      ? t("app.statusFileRemoved")
                      : isDirty
                        ? t("app.statusUnsaved")
                        : t("app.statusSaved")}
                </div>
              ) : (
                // Without a keyboard there is no Ctrl+S; the pill that shows
                // the unsaved state is where the eye already is, so it saves.
                <button
                  type="button"
                  className={cn(
                    "detail-panel__status",
                    "detail-panel__status--button",
                    isSaving && "detail-panel__status--saving",
                    isDirty && "detail-panel__status--dirty",
                    isSelectedFileMissing && "detail-panel__status--warning"
                  )}
                  aria-live="polite"
                  data-testid="status"
                  data-dirty={isDirty ? "true" : "false"}
                  disabled={!isDirty || isSaving}
                  title={isDirty ? t("app.saveButtonTitle") : undefined}
                  onClick={onSaveRequest}
                >
                  {isSaving
                    ? t("app.statusSaving")
                    : isSelectedFileMissing
                      ? t("app.statusFileRemoved")
                      : isDirty
                        ? t("app.saveButton")
                        : t("app.statusSaved")}
                </button>
              )}
              {layout !== "desktop" ? (
                <>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    className="detail-panel__chat-button"
                    aria-label={t("chat.openButton")}
                    aria-pressed={isChatOpen}
                    title={t("chat.openButtonTitle")}
                    data-testid="open-chat"
                    onClick={() => useChatStore.getState().togglePanel()}
                  >
                    <MessagesSquare />
                  </Button>
                  <DocumentMenu
                    editorHandleRef={editorHandleRef}
                    backTargetLabel={backTargetLabel}
                    forwardTargetLabel={forwardTargetLabel}
                    onNavigateBack={onNavigateBack}
                    onNavigateForward={onNavigateForward}
                    onVersionsRequest={() => setVersionsRequestId((id) => id + 1)}
                    versioningEnabled={versioningEnabled}
                    onZenModeRequest={onZenModeRequest}
                  />
                </>
              ) : null}
            </div>
          </div>

          <div className="detail-panel__body">
            {fileError || saveError ? (
              <div className="detail-panel__message detail-panel__message--error">
                {fileError ?? saveError}
              </div>
            ) : isFileLoading || selectedFileContent === null ? (
              <div className="detail-panel__message">
                {t("app.fileLoading")}
              </div>
            ) : (
              <Editor
                key={selectedFilePath}
                ref={editorHandleRef}
                markdown={selectedFileContent}
                onMarkdownChange={onMarkdownChange}
                onCanonicalMarkdown={onCanonicalMarkdown}
                folderPath={folderPath}
                filePath={selectedFilePath}
                editorFocusRequestId={editorFocusRequestId}
                onRequestSidebarFocus={onRequestSidebarFocus}
                onRequestFileOpen={onRequestFileOpen}
                onAiLoadingChange={onAiLoadingChange}
                onAiPendingChange={onAiPendingChange}
                onAiSettingsRequest={onAiSettingsRequest}
                onZenModeRequest={onZenModeRequest}
              />
            )}
          </div>
        </div>
      ) : (
        <div className="detail-panel__card detail-panel__card--empty">
          {standaloneFindPanel}
          {layout === "phone" ? (
            // No note, no header: the sheet button still has to be somewhere.
            <div className="detail-panel__header detail-panel__header--empty">
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="detail-panel__sidebar-button"
                aria-label={t("app.openSidebar")}
                title={t("app.openSidebar")}
                data-testid="open-sidebar"
                onClick={onOpenSidebar}
              >
                <PanelLeft />
              </Button>
              <span className="detail-panel__app-name">ScribeDog</span>
            </div>
          ) : null}
          <p className="detail-panel__eyebrow">{t("app.emptyEyebrow")}</p>
          <h2>{t("app.emptyTitle")}</h2>
          {appVersion ? <p className="detail-panel__version">{t("app.version", { version: appVersion })}</p> : null}
        </div>
      )}
    </section>
  );
}
