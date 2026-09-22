import { describe, expect, it } from "vitest";

import rawEmojiData from "@emoji-mart/data";

import { buildLocalizedEmojiData, type EmojibaseEntry } from "./emojiKeywords";

const emojibaseSample: EmojibaseEntry[] = [
  { hexcode: "1F600", label: "grinsendes Gesicht", tags: ["lachen"] }
];

describe("buildLocalizedEmojiData", () => {
  it("adds the localized label and tags as keywords", () => {
    const data = buildLocalizedEmojiData(emojibaseSample);
    const grinning = data.emojis.grinning;

    expect(grinning.keywords).toContain("grinsendes Gesicht");
    expect(grinning.keywords).toContain("lachen");
  });

  it("keeps the original keywords alongside the localized ones", () => {
    const data = buildLocalizedEmojiData(emojibaseSample);
    const source = (rawEmojiData as typeof data).emojis.grinning;

    for (const keyword of source.keywords ?? []) {
      expect(data.emojis.grinning.keywords).toContain(keyword);
    }
  });

  // The bug this guards against: a spread copies `categories` by reference, so
  // every locale — and the imported module itself — shared one array. emoji-mart
  // mutates it on init (unshifting "frequent") and filters it on later inits,
  // which left the picker with a handful of categories once a second one had
  // been opened.
  it("gives every locale its own categories array", () => {
    const first = buildLocalizedEmojiData(emojibaseSample);
    const second = buildLocalizedEmojiData(emojibaseSample);

    expect(first.categories).not.toBe(second.categories);
    expect(first.categories).not.toBe((rawEmojiData as typeof first).categories);
    expect(first.categories[0]).not.toBe(second.categories[0]);
  });

  it("does not let a mutation of one locale reach another", () => {
    const first = buildLocalizedEmojiData(emojibaseSample);
    const second = buildLocalizedEmojiData(emojibaseSample);
    const before = second.categories.length;

    // What emoji-mart's init does to the data it is handed.
    first.categories.unshift({ id: "frequent", emojis: [] });

    expect(second.categories).toHaveLength(before);
    expect((second.categories[0] as { id: string }).id).not.toBe("frequent");
  });
});
