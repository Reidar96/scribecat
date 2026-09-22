import { writeFile } from "node:fs/promises";
import path from "node:path";

import type { Vault } from "./files.js";

const WELCOME_FILE_NAME = "Welcome.md";

const WELCOME_CONTENT = `# Welcome to ScribeCat

This is your vault. Every \`.md\` file in the mounted data folder shows up in the tree on the left, and whatever you write here is saved back as plain Markdown.

- Open a note from the tree
- Edit it
- Save with **Ctrl+S**

Add more notes with the **+** button, or drop \`.md\` files into the data folder.
`;

/**
 * A brand-new bind mount is an empty folder. Seeding one note gives a fresh
 * install something to open and a place to read what to do next. Nothing is
 * written when the vault already holds any markdown file.
 */
export async function ensureWelcomeNote(vault: Vault, log: { info(message: string): void }): Promise<void> {
  const files = await vault.listMarkdownFiles();

  if (files.length > 0) {
    return;
  }

  await writeFile(path.join(vault.realPath, WELCOME_FILE_NAME), WELCOME_CONTENT, { encoding: "utf8", flag: "wx" }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") {
        throw error;
      }
    }
  );

  log.info(`Vault was empty, created ${WELCOME_FILE_NAME}.`);
}
