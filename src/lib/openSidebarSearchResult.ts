import { useAppStore } from "@/store/useAppStore";
import { useSearchStore } from "@/store/useSearchStore";

/** Open a vault result, then hand the first in-document match to FindReplacePanel. */
export async function openSidebarSearchResult(
  filePath: string,
  query: string,
  selectFilePath: (filePath: string) => Promise<void>
): Promise<boolean> {
  await selectFilePath(filePath);
  // Selecting can be canceled by the unsaved-changes dialog.
  if (useAppStore.getState().selectedFilePath !== filePath) return false;

  const search = useSearchStore.getState();
  search.setQuery(query.trim());
  search.setAllFiles(false);
  search.setPendingTarget({ filePath, matchIndex: 0 });
  search.openPanel();
  return true;
}
