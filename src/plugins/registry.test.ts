import { describe, expect, it } from "vitest";

import { normalizePluginConfiguration, pluginPolicyForPath, validPluginFolder } from "./registry";
import { moveMarkdownSection, newPluginDocument, pluginMetadata, setPluginField } from "./markdown";

describe("plugin storage policies", () => {
  it("never treats a disabled plugin's Markdown as hidden", () => {
    const config = normalizePluginConfiguration({ plugins: { books: { enabled: false, folder: "Bøker", showInFiles: false } } });
    expect(pluginPolicyForPath(config, "Bøker/Leseliste.md")).toBeNull();
    expect(config.pinned).toEqual(["journal", "graph", "tasks"]);
  });

  it("matches path segments, including nested folders, without swallowing similarly named folders", () => {
    const config = normalizePluginConfiguration({ plugins: { books: { enabled: true, folder: "Bøker", includeInSearch: false } } });
    expect(pluginPolicyForPath(config, "Bøker/2026/Bok.md")?.includeInSearch).toBe(false);
    expect(pluginPolicyForPath(config, "Bøker ekstra/Bok.md")).toBeNull();
  });

  it("rejects traversal and metadata paths before persisting a plugin folder", () => {
    for (const folder of ["../privat", "Bøker/../privat", ".scribecat", "Bøker\\privat", "/data", "A//B", "C:privat"]) {
      expect(validPluginFolder(folder)).toBeNull();
    }
  });

  it("keeps recipe publication explicit in portable Markdown", () => {
    const markdown = newPluginDocument("recipes", "Blåbærkake");
    expect(pluginMetadata(markdown)).toMatchObject({
      "scribecat-plugin": "recipes", type: "recipe", slug: "blabaerkake", published: "false"
    });
    expect(pluginMetadata(setPluginField(markdown, "published", true)).published).toBe("true");
    expect(markdown).toContain("## Ingredienser");
  });

  it("keeps book publication opt-in in both settings and Markdown", () => {
    const config = normalizePluginConfiguration({ plugins: { books: { publicView: true } } });
    expect(config.plugins.books?.publicView).toBe(true);
    expect(pluginMetadata(newPluginDocument("books", "En bok"))).toMatchObject({ slug: "en-bok", published: "false" });
  });

  it("reorders shopping categories without separating items or frontmatter", () => {
    const markdown = "---\nscribecat-plugin: shopping\n---\n# Uke\n\n## Kjøl\n\n- [ ] Melk\n\n## Frukt\n\n- [ ] Eple\n";
    const moved = moveMarkdownSection(markdown, "Frukt", -1);
    expect(moved.indexOf("## Frukt")).toBeLessThan(moved.indexOf("## Kjøl"));
    expect(moved.indexOf("Eple")).toBeLessThan(moved.indexOf("Melk"));
    expect(moved).toContain("scribecat-plugin: shopping");
  });
});
