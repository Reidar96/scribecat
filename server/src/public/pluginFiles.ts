import type { Vault } from "../vault/files.js";

/** Scan only the configured plugin tree. A vault may contain thousands of
 * unrelated notes; public collection requests need none of their metadata. */
export async function pluginMarkdownPaths(vault: Vault, folder: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(relative: string): Promise<void> {
    const entries = await vault.readDir(relative).catch(() => []);
    const directories: string[] = [];
    for (const entry of entries) {
      if (entry.isSymlink || entry.name === ".scribecat") continue;
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory) directories.push(path);
      else if (entry.isFile && /\.md$/i.test(entry.name)) files.push(path);
    }
    for (let at = 0; at < directories.length; at += 8) {
      await Promise.all(directories.slice(at, at + 8).map(visit));
    }
  }
  await visit(folder);
  return files;
}

export async function readPluginMarkdown(vault: Vault, folder: string): Promise<Array<{ relativePath: string; markdown: string }>> {
  const paths = await pluginMarkdownPaths(vault, folder);
  const results: Array<{ relativePath: string; markdown: string }> = [];
  for (let at = 0; at < paths.length; at += 16) {
    const batch = await Promise.all(paths.slice(at, at + 16).map(async (relativePath) => {
      try { return { relativePath, markdown: await vault.readText(relativePath) }; }
      catch { return null; } // A document can disappear during the scan.
    }));
    for (const item of batch) if (item) results.push(item);
  }
  return results;
}
