import { createContext } from "react";

export type InlinePdfPreviewRequest = {
  absolutePath: string;
  label: string;
};

export type EditorFileContextValue = {
  folderPath: string | null;
  filePath: string | null;
  onOpenPdfInSplit?: (request: InlinePdfPreviewRequest) => void;
};

export const EditorFileContext = createContext<EditorFileContextValue>({
  folderPath: null,
  filePath: null
});
