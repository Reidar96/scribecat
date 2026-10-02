import { describe, expect, it } from "vitest";

import { matchShortcut, resolveBinding } from "./resolve";
import type { ShortcutOverrides } from "./storage";

const keydown = (init: Partial<KeyboardEvent>) => ({
  ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, code: "", key: "", ...init
}) as KeyboardEvent;

describe("paste shortcuts", () => {
  it("registers normal and plain-text paste in the editable shortcut registry", () => {
    const overrides: ShortcutOverrides = {};
    expect(matchShortcut(overrides, keydown({ ctrlKey: true, code: "KeyV", key: "v" }), "editor")).toBe("paste");
    expect(matchShortcut(overrides, keydown({ ctrlKey: true, shiftKey: true, code: "KeyV", key: "V" }), "editor")).toBe("pastePlainText");
  });

  it("resolves user-assigned paste shortcuts for the context menu labels", () => {
    const binding = { ctrl: true, alt: true, shift: false, code: "KeyV", key: "v", label: "V" };
    expect(resolveBinding({ pastePlainText: binding }, "pastePlainText")).toEqual(binding);
  });
});
