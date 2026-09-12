import { create } from "zustand";

import {
  clampFontSizePt,
  DEFAULT_FONT_ID,
  DEFAULT_FONT_SIZE_PT,
  ensureFontStylesLoaded,
  getFontDefinition,
  getFontScale,
  resolveFontId,
  type AppFontId
} from "@/lib/fonts";
import { clampOutlineDepth, OUTLINE_DEPTH_MAX } from "@/lib/editor/documentOutline";

export const SPELLCHECK_STORAGE_KEY = "scribedog-spellcheck-enabled";
export const DETAILS_PANEL_STORAGE_KEY = "scribedog-details-panel-visible";
export const OUTLINE_DEPTH_STORAGE_KEY = "scribedog-outline-max-depth";
export const DETAILS_COLLAPSED_STORAGE_KEY = "scribedog-details-collapsed-sections";

/** The details panel's sections, each of which can be folded away. */
export type DetailsSectionId = "outline" | "fileInfo" | "outgoingLinks" | "backlinks";
export const ZOOM_STORAGE_KEY = "scribedog-zoom-level";
export const ZEN_WIDTH_STORAGE_KEY = "scribedog-zen-width";
export const FONT_STORAGE_KEY = "scribedog-font-id";
export const FONT_SIZE_STORAGE_KEY = "scribedog-font-size-pt";

// Zoom level is an offset in percent relative to normal size (0 = 100%).
export const ZOOM_MIN = -30;
export const ZOOM_MAX = 50;
export const ZOOM_STEP = 10;

// Zen-mode text-column width in pixels. Applies only to Zen mode; normal
// editing keeps its own layout.
export const ZEN_WIDTH_MIN = 360;
export const ZEN_WIDTH_MAX = 1400;
export const ZEN_WIDTH_DEFAULT = 760;
export const ZEN_WIDTH_STEP = 40;

export function clampZoomLevel(level: number): number {
  const stepped = Math.round(level / ZOOM_STEP) * ZOOM_STEP;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, stepped));
}

export function clampZenWidth(width: number): number {
  return Math.min(ZEN_WIDTH_MAX, Math.max(ZEN_WIDTH_MIN, Math.round(width)));
}

function getStoredZoomLevel(): number {
  try {
    const raw = window.localStorage.getItem(ZOOM_STORAGE_KEY);
    const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? clampZoomLevel(parsed) : 0;
  } catch {
    return 0;
  }
}

function persistZoomLevel(level: number): void {
  try {
    window.localStorage.setItem(ZOOM_STORAGE_KEY, String(level));
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

function getStoredZenWidth(): number {
  try {
    const raw = window.localStorage.getItem(ZEN_WIDTH_STORAGE_KEY);
    const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? clampZenWidth(parsed) : ZEN_WIDTH_DEFAULT;
  } catch {
    return ZEN_WIDTH_DEFAULT;
  }
}

function persistZenWidth(width: number): void {
  try {
    window.localStorage.setItem(ZEN_WIDTH_STORAGE_KEY, String(width));
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

function getStoredSpellcheckEnabled(): boolean {
  try {
    return window.localStorage.getItem(SPELLCHECK_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function persistSpellcheckEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(SPELLCHECK_STORAGE_KEY, String(enabled));
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

function getStoredDetailsPanelVisible(): boolean {
  try {
    return window.localStorage.getItem(DETAILS_PANEL_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function persistDetailsPanelVisible(visible: boolean): void {
  try {
    window.localStorage.setItem(DETAILS_PANEL_STORAGE_KEY, String(visible));
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

function getStoredOutlineMaxDepth(): number {
  try {
    const raw = window.localStorage.getItem(OUTLINE_DEPTH_STORAGE_KEY);
    return raw === null ? OUTLINE_DEPTH_MAX : clampOutlineDepth(Number.parseInt(raw, 10));
  } catch {
    return OUTLINE_DEPTH_MAX;
  }
}

function persistOutlineMaxDepth(depth: number): void {
  try {
    window.localStorage.setItem(OUTLINE_DEPTH_STORAGE_KEY, String(depth));
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

function getStoredCollapsedDetailsSections(): DetailsSectionId[] {
  try {
    const raw = window.localStorage.getItem(DETAILS_COLLAPSED_STORAGE_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is DetailsSectionId => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function persistCollapsedDetailsSections(ids: DetailsSectionId[]): void {
  try {
    window.localStorage.setItem(DETAILS_COLLAPSED_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

function getStoredFontId(): AppFontId {
  try {
    return resolveFontId(window.localStorage.getItem(FONT_STORAGE_KEY));
  } catch {
    return DEFAULT_FONT_ID;
  }
}

function persistFontId(fontId: AppFontId): void {
  try {
    window.localStorage.setItem(FONT_STORAGE_KEY, fontId);
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

function getStoredFontSizePt(): number {
  try {
    const raw = window.localStorage.getItem(FONT_SIZE_STORAGE_KEY);
    return raw === null ? DEFAULT_FONT_SIZE_PT : clampFontSizePt(Number.parseFloat(raw));
  } catch {
    return DEFAULT_FONT_SIZE_PT;
  }
}

function persistFontSizePt(sizePt: number): void {
  try {
    window.localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(sizePt));
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

type EditorSettingsState = {
  spellcheckEnabled: boolean;
  setSpellcheckEnabled: (enabled: boolean) => void;
  /**
   * Document font, shared by the editor and every export format. Selecting it
   * pulls in the family's faces on demand (see src/lib/fonts.ts).
   */
  fontId: AppFontId;
  setFontId: (fontId: AppFontId) => void;
  /** Document body size in points; travels into every export. */
  fontSizePt: number;
  setFontSizePt: (sizePt: number) => void;
  /** Details sidebar next to the document, toggled from the toolbar. */
  detailsPanelVisible: boolean;
  setDetailsPanelVisible: (visible: boolean) => void;
  /** Deepest heading level the details panel's outline lists, 1..6. */
  outlineMaxDepth: number;
  setOutlineMaxDepth: (depth: number) => void;
  /** Sections of the details panel the user folded away; app-wide like the panel itself. */
  collapsedDetailsSections: DetailsSectionId[];
  setDetailsSectionCollapsed: (id: DetailsSectionId, collapsed: boolean) => void;
  zoomLevel: number;
  setZoomLevel: (level: number) => void;
  zenWidth: number;
  setZenWidth: (width: number) => void;
};

// Two custom properties drive every editing surface (normal view, Zen mode,
// print), the same way useThemeStore drives the colour scheme.
function applyDocumentFont(fontId: AppFontId): void {
  document.documentElement.style.setProperty(
    "--font-document",
    getFontDefinition(fontId).cssStack
  );
}

function applyDocumentFontScale(sizePt: number): void {
  document.documentElement.style.setProperty(
    "--document-font-scale",
    String(getFontScale(sizePt))
  );
}

const initialFontId = getStoredFontId();
const initialFontSizePt = getStoredFontSizePt();

// The stored family has to be in the document before the editor paints, or the
// first frame renders in the fallback face and visibly reflows.
void ensureFontStylesLoaded(initialFontId);
applyDocumentFont(initialFontId);
applyDocumentFontScale(initialFontSizePt);

export const useEditorSettingsStore = create<EditorSettingsState>((set) => ({
  spellcheckEnabled: getStoredSpellcheckEnabled(),
  setSpellcheckEnabled: (enabled: boolean) => {
    persistSpellcheckEnabled(enabled);
    set({ spellcheckEnabled: enabled });
  },
  fontId: initialFontId,
  setFontId: (fontId: AppFontId) => {
    persistFontId(fontId);
    set({ fontId });
    applyDocumentFont(fontId);
    void ensureFontStylesLoaded(fontId);
  },
  fontSizePt: initialFontSizePt,
  setFontSizePt: (sizePt: number) => {
    const clamped = clampFontSizePt(sizePt);
    persistFontSizePt(clamped);
    set({ fontSizePt: clamped });
    applyDocumentFontScale(clamped);
  },
  detailsPanelVisible: getStoredDetailsPanelVisible(),
  setDetailsPanelVisible: (visible: boolean) => {
    persistDetailsPanelVisible(visible);
    set({ detailsPanelVisible: visible });
  },
  outlineMaxDepth: getStoredOutlineMaxDepth(),
  setOutlineMaxDepth: (depth: number) => {
    const clamped = clampOutlineDepth(depth);
    persistOutlineMaxDepth(clamped);
    set({ outlineMaxDepth: clamped });
  },
  collapsedDetailsSections: getStoredCollapsedDetailsSections(),
  setDetailsSectionCollapsed: (id: DetailsSectionId, collapsed: boolean) => {
    set((state) => {
      const without = state.collapsedDetailsSections.filter((current) => current !== id);
      const next = collapsed ? [...without, id] : without;
      persistCollapsedDetailsSections(next);
      return { collapsedDetailsSections: next };
    });
  },
  zoomLevel: getStoredZoomLevel(),
  setZoomLevel: (level: number) => {
    const clamped = clampZoomLevel(level);
    persistZoomLevel(clamped);
    set({ zoomLevel: clamped });
  },
  zenWidth: getStoredZenWidth(),
  setZenWidth: (width: number) => {
    const clamped = clampZenWidth(width);
    persistZenWidth(clamped);
    set({ zenWidth: clamped });
  }
}));
