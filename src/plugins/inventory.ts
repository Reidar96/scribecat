import { pluginSection } from "@/plugins/markdown";

export type InventoryImage = { reference: string; alt: string };

export function parseInventoryImages(markdown: string, cover = ""): InventoryImage[] {
  const result: InventoryImage[] = [];
  const seen = new Set<string>();
  const add = (reference: string, alt: string) => {
    const value = reference.trim().replace(/^<|>$/g, "");
    if (!value || !/\.(?:png|jpe?g|webp|gif)$/i.test(value) || seen.has(value)) return;
    seen.add(value); result.push({ reference: value, alt: alt.trim() });
  };
  add(cover, "");
  for (const match of pluginSection(markdown, "Bilder").matchAll(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) add(match[2], match[1]);
  return result;
}

export function inventoryImagesMarkdown(images: InventoryImage[]): string {
  return images.map(({ reference, alt }) => `![${alt.replace(/[\[\]\r\n]/g, " ")}](${reference})`).join("\n\n");
}
