function startsWithTagMarkup(value: string): boolean {
  const candidate = value.trimStart();
  if (candidate[0] !== "<") return false;
  const nameStart = candidate[1] === "/" ? 2 : 1;
  return /[a-z]/i.test(candidate[nameStart] ?? "");
}

/**
 * Some clipboard providers encode a rich HTML fragment a second time. Parse
 * text nodes that contain a whole escaped fragment back into elements before
 * handing the result to ProseMirror's normal clipboard parser.
 */
export function normalizeClipboardHtml(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;

  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

  let changed = false;
  for (const textNode of textNodes) {
    const parent = textNode.parentElement;
    const value = textNode.nodeValue ?? "";
    if (parent?.closest("pre, code") || !startsWithTagMarkup(value)) continue;

    const fragment = document.createElement("template");
    fragment.innerHTML = value;
    if (!Array.from(fragment.content.childNodes).some((node) => node.nodeType === Node.ELEMENT_NODE)) continue;

    textNode.replaceWith(fragment.content);
    changed = true;
  }

  return changed ? template.innerHTML : html;
}
