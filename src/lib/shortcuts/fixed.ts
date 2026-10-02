import type { TFunction } from "i18next";

import { bindingsConflict, formatBinding, matchesBinding, type ShortcutBinding } from "@/lib/shortcuts/binding";

export type FixedEditorShortcutId = "copyFormatted" | "copyMarkdown" | "copyPlainText";

export type FixedEditorShortcut = {
  id: FixedEditorShortcutId;
  binding: ShortcutBinding;
  /** Label of the selection context menu entry that carries the combo. */
  labelKey: string;
};

function ctrlCombo(letter: "C" | "V", modifiers: { alt?: boolean; shift?: boolean }): ShortcutBinding {
  return {
    ctrl: true,
    alt: modifiers.alt ?? false,
    shift: modifiers.shift ?? false,
    code: `Key${letter}`,
    key: letter.toLowerCase(),
    label: letter
  };
}

/**
 * The three ways of copying a selection out of the editor. These stay fixed
 * because Ctrl+C belongs to the platform; paste variants live in the
 * remappable shortcut registry and use the native browser behavior while
 * they keep their default bindings.
 */
export const FIXED_EDITOR_SHORTCUTS: FixedEditorShortcut[] = [
  { id: "copyFormatted", binding: ctrlCombo("C", {}), labelKey: "editorContextMenu.copyFormatted" },
  { id: "copyMarkdown", binding: ctrlCombo("C", { alt: true }), labelKey: "editorContextMenu.copyMarkdown" },
  { id: "copyPlainText", binding: ctrlCombo("C", { shift: true }), labelKey: "editorContextMenu.copyPlainText" }
];

const FIXED_EDITOR_SHORTCUTS_BY_ID = new Map(FIXED_EDITOR_SHORTCUTS.map((shortcut) => [shortcut.id, shortcut]));

export function matchFixedEditorShortcut(event: KeyboardEvent): FixedEditorShortcutId | null {
  const match = FIXED_EDITOR_SHORTCUTS.find((shortcut) => matchesBinding(event, shortcut.binding));

  return match?.id ?? null;
}

/** The fixed shortcut a binding would clash with, or null. */
export function findFixedConflict(binding: ShortcutBinding): FixedEditorShortcut | null {
  return FIXED_EDITOR_SHORTCUTS.find((shortcut) => bindingsConflict(shortcut.binding, binding)) ?? null;
}

export function formatFixedEditorShortcut(t: TFunction, id: FixedEditorShortcutId): string {
  return formatBinding(t, FIXED_EDITOR_SHORTCUTS_BY_ID.get(id)!.binding);
}
