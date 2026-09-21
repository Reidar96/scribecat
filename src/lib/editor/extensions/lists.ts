import { BulletList as BaseBulletList, OrderedList as BaseOrderedList } from "@tiptap/extension-list";

import { isInTableCell, withoutTableCells } from "./table";

// A Markdown table cell holds inline text only, and the serializer flattens
// anything else on save (see table.ts). Rather than let the user build a
// list in a cell that comes back as bullet-glyph text after reopening, the
// list commands and input rules simply don't fire inside a cell: the
// toolbar button, the shortcut and typing "- " all leave the text as it is.
// Lists still arrive in cells via paste or an AI proposal; the serializer
// covers those.

export const BulletList = BaseBulletList.extend({
  addInputRules() {
    return (this.parent?.() ?? []).map(withoutTableCells);
  },

  addCommands() {
    const parent = this.parent?.();

    return {
      ...parent,
      toggleBulletList: () => (props) => {
        const toggle = parent?.toggleBulletList;

        if (!toggle || isInTableCell(props.state)) {
          return false;
        }

        return toggle()(props);
      }
    };
  }
});

export const OrderedList = BaseOrderedList.extend({
  addInputRules() {
    return (this.parent?.() ?? []).map(withoutTableCells);
  },

  addCommands() {
    const parent = this.parent?.();

    return {
      ...parent,
      toggleOrderedList: () => (props) => {
        const toggle = parent?.toggleOrderedList;

        if (!toggle || isInTableCell(props.state)) {
          return false;
        }

        return toggle()(props);
      }
    };
  }
});
