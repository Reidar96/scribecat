import type { FileContextMenuState } from "./types";
import { useContextMenuState } from "./useContextMenuState";

/** The row context menu, plus everything that closes it again. */
export function useTreeContextMenu() {
  return useContextMenuState<FileContextMenuState>();
}
