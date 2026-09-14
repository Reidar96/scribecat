/**
 * The three layouts the workspace can take, decided by viewport width alone.
 * Touch (target sizes, the "more" button on tree rows) is a separate axis
 * handled in CSS via `pointer: coarse`: an iPad in landscape is a desktop
 * without a mouse, a narrow desktop window is a phone with one.
 */
export type LayoutMode = "phone" | "tablet" | "desktop";

/** Up to here the sidebar is a sheet and the chat covers the whole screen. */
export const PHONE_MAX_WIDTH = 640;
/** Up to here the sidebar is docked but the chat and details are sheets. */
export const TABLET_MAX_WIDTH = 920;

export const PHONE_QUERY = `(max-width: ${PHONE_MAX_WIDTH}px)`;
export const TABLET_QUERY = `(max-width: ${TABLET_MAX_WIDTH}px)`;

export function layoutModeForWidth(width: number): LayoutMode {
  if (width <= PHONE_MAX_WIDTH) {
    return "phone";
  }

  if (width <= TABLET_MAX_WIDTH) {
    return "tablet";
  }

  return "desktop";
}
