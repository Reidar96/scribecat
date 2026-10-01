import { Mark } from "@tiptap/core";
import type MarkdownIt from "markdown-it";

// Store a small, portable palette rather than arbitrary Word/theme colors.
// The hex values are used in both HTML paste and the saved Markdown span.
export const FONT_COLORS = [
  { name: "red", value: "#bd394a" },
  { name: "orange", value: "#ad552d" },
  { name: "yellow", value: "#946900" },
  { name: "green", value: "#25824e" },
  { name: "teal", value: "#19817e" },
  { name: "blue", value: "#326eb1" },
  { name: "indigo", value: "#555bb8" },
  { name: "purple", value: "#884eb1" },
  { name: "pink", value: "#b34583" },
  { name: "gray", value: "#687588" }
] as const;

const DEFAULT_TEXT = "#202428";
const NAMED_COLORS: Record<string, string> = {
  black: "#000000", white: "#ffffff", red: "#ff0000", blue: "#0000ff",
  green: "#008000", yellow: "#ffff00", orange: "#ffa500", purple: "#800080",
  gray: "#808080", grey: "#808080", pink: "#ffc0cb", navy: "#000080",
  teal: "#008080", maroon: "#800000"
};

function rgb(value: string): [number, number, number] | null {
  const input = NAMED_COLORS[value.trim().toLowerCase()] ?? value.trim();
  const short = /^#([\da-f]{3})$/i.exec(input);
  if (short) return [...short[1]].map((digit) => parseInt(digit + digit, 16)) as [number, number, number];
  const hex = /^#([\da-f]{6})(?:[\da-f]{2})?$/i.exec(input);
  if (hex) return [0, 2, 4].map((index) => parseInt(hex[1].slice(index, index + 2), 16)) as [number, number, number];
  const channels = /^rgba?\(\s*(\d{1,3})[,\s]+(\d{1,3})[,\s]+(\d{1,3})(?:[,\s/]+[\d.]+)?\s*\)$/i.exec(input);
  if (channels) {
    const values = channels.slice(1, 4).map(Number);
    return values.every((channel) => channel <= 255) ? values as [number, number, number] : null;
  }
  return null;
}

/** Returns null for normal dark text; otherwise snaps a pasted color to the palette. */
export function nearestFontColor(value: string): string | null {
  const source = rgb(value);
  if (!source) return null;

  const candidates = [DEFAULT_TEXT, ...FONT_COLORS.map((entry) => entry.value)];
  const distance = (color: string) => {
    const target = rgb(color)!;
    return source.reduce((total, channel, index) => total + (channel - target[index]) ** 2 * [0.3, 0.59, 0.11][index], 0);
  };
  const closest = candidates.reduce((best, color) => distance(color) < distance(best) ? color : best);
  return closest === DEFAULT_TEXT ? null : closest;
}

// Markdown has no native foreground-color syntax. A restricted HTML span is
// widely readable elsewhere, while this rule enables only our color spans
// even though arbitrary raw HTML remains disabled for notes.
export function fontColorMarkdownItPlugin(markdownit: MarkdownIt): void {
  markdownit.inline.ruler.before("html_inline", "scribecat_font_color", (state, silent) => {
    const rest = state.src.slice(state.pos);
    const open = /^<span style="color: (#[\da-f]{6})">/i.exec(rest);
    const depthState = state as typeof state & { fontColorDepth?: number };
    if (open) {
      if (!silent) {
        const token = state.push("font_color_open", "span", 1);
        token.attrSet("color", nearestFontColor(open[1]) ?? DEFAULT_TEXT);
        depthState.fontColorDepth = (depthState.fontColorDepth ?? 0) + 1;
      }
      state.pos += open[0].length;
      return true;
    }
    if (rest.startsWith("</span>") && (depthState.fontColorDepth ?? 0) > 0) {
      if (!silent) {
        state.push("font_color_close", "span", -1);
        depthState.fontColorDepth = (depthState.fontColorDepth ?? 1) - 1;
      }
      state.pos += 7;
      return true;
    }
    return false;
  });
  markdownit.renderer.rules.font_color_open = (tokens, index) =>
    `<span style="color: ${tokens[index].attrGet("color")}">`;
  markdownit.renderer.rules.font_color_close = () => "</span>";
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fontColor: {
      setFontColor: (color: string) => ReturnType;
      unsetFontColor: () => ReturnType;
    };
  }
}

export const FontColor = Mark.create({
  name: "fontColor",
  addAttributes() {
    return { color: { default: null } };
  },
  parseHTML() {
    return [
      { tag: "span[style]", getAttrs: (element) => {
        const color = nearestFontColor((element as HTMLElement).style.color);
        return color ? { color } : false;
      } },
      { tag: "font[color]", getAttrs: (element) => {
        const color = nearestFontColor((element as HTMLElement).getAttribute("color") ?? "");
        return color ? { color } : false;
      } }
    ];
  },
  renderHTML({ mark }) {
    return ["span", { style: `color: ${mark.attrs.color}` }, 0];
  },
  addCommands() {
    return {
      setFontColor: (color) => ({ commands }) => commands.setMark(this.name, { color }),
      unsetFontColor: () => ({ commands }) => commands.unsetMark(this.name)
    };
  },
  addStorage() {
    return {
      markdown: {
        serialize: {
          open: (_state: unknown, mark: { attrs: { color: string } }) => `<span style="color: ${mark.attrs.color}">`,
          close: "</span>"
        },
        parse: { setup: fontColorMarkdownItPlugin }
      }
    };
  }
});
