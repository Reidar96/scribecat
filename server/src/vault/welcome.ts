import { writeFile } from "node:fs/promises";
import path from "node:path";

import type { Vault } from "./files.js";

const WELCOME_FILE_NAME = "Welcome.md";

const WELCOME_CONTENT = `# Welcome to ScribeDog

This is your vault. Every \`.md\` file in the mounted data folder shows up in the list on the left, and whatever you write here is saved back as plain Markdown.

- Open a note from the list
- Edit it
- Save with the button or **Ctrl+S**

Add more notes by dropping \`.md\` files into the data folder.
`;

/**
 * A brand-new bind mount is an empty folder, and the first stage of the
 * server can only open and save notes that already exist. Seeding one note
 * makes a fresh install usable without touching the host filesystem first.
 * Nothing is written when the vault already holds any markdown file.
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
