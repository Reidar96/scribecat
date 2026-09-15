import type { TFunction } from "i18next";

import { bindingsConflict, formatBinding, matchesBinding, type ShortcutBinding } from "@/lib/shortcuts/binding";

export type FixedEditorShortcutId = "copyFormatted" | "copyMarkdown" | "copyPlainText";

export type FixedEditorShortcut = {
  id: FixedEditorShortcutId;
  binding: ShortcutBinding;
  /** Label of the selection context menu entry that carries the combo. */
  labelKey: string;
};

function copyCombo(modifiers: { alt?: boolean; shift?: boolean }): ShortcutBinding {
  return {
    ctrl: true,
    alt: modifiers.alt ?? false,
    shift: modifiers.shift ?? false,
    code: "KeyC",
    key: "c",
    label: "C"
  };
}

/**
 * The three ways of copying a selection out of the editor. Unlike everything
 * in `definitions.ts` they are deliberately *not* remappable: Ctrl+C belongs
 * to the platform, and the two variants next to it stay where a user expects
 * them relative to Ctrl+C. They are checked before the registry in the
 * editor's keydown handler and refused by the shortcuts dialog's recorder.
 */
export const FIXED_EDITOR_SHORTCUTS: FixedEditorShortcut[] = [
  { id: "copyFormatted", binding: copyCombo({}), labelKey: "editorContextMenu.copyFormatted" },
  { id: "copyMarkdown", binding: copyCombo({ alt: true }), labelKey: "editorContextMenu.copyMarkdown" },
  { id: "copyPlainText", binding: copyCombo({ shift: true }), labelKey: "editorContextMenu.copyPlainText" }
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
