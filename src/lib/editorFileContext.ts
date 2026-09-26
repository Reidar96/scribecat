import { createContext } from "react";

export type InlinePdfPreviewRequest = {
  absolutePath: string;
  label: string;
};

export type InlinePdfSplitRestoreRequest = {
  absolutePath: string;
  requestId: number;
};

export type EditorFileContextValue = {
  folderPath: string | null;
  filePath: string | null;
  onOpenPdfInSplit?: (request: InlinePdfPreviewRequest) => void;
  onOpenDocumentInSplit?: (request: InlinePdfPreviewRequest) => void;
  pdfSplitRestoreRequest?: InlinePdfSplitRestoreRequest | null;
};

export const EditorFileContext = createContext<EditorFileContextValue>({
  folderPath: null,
  filePath: null
});
