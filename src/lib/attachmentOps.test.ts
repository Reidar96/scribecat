import path from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
const vault = vi.hoisted(() => ({ files: new Map<string, string>(), removed: vi.fn(), written: vi.fn() }));
vi.mock("@/platform/paths", () => ({ join: async (...parts: string[]) => path.posix.join(...parts), dirname: async (p: string) => path.posix.dirname(p) }));
vi.mock("@/platform", () => ({ getVaultStorage: () => ({ listMarkdownFiles: async () => [...vault.files.keys()].filter(p => p.endsWith('.md')).map(filePath => ({ filePath })) }) }));
vi.mock("@/platform/vaultFs", () => ({
  exists: async (p: string) => vault.files.has(p), mkdir: vi.fn(), readDir: vi.fn(),
  readTextFile: async (p: string) => vault.files.get(p), readFile: async (p: string) => { if (!vault.files.has(p)) throw Error('missing'); return new Uint8Array([1]); },
  remove: vault.removed, writeFile: vault.written
}));
import { cleanupOrphanedManagedAttachments, copyManagedAttachmentsForMarkdownVariants } from "./attachmentOps";
beforeEach(() => { vault.files.clear(); vault.removed.mockClear(); vault.written.mockClear(); });
it("keeps attachments referenced by percent-encoded filenames", async () => {
  vault.files.set('/vault/note.md', '[PDF](_attachments/f%C3%B8rste%20side.pdf)');
  await cleanupOrphanedManagedAttachments('/vault', ['_attachments/første side.pdf']);
  expect(vault.removed).not.toHaveBeenCalled();
});
it("copies encoded filenames and keeps a same-named link label intact", async () => {
  const href = '_attachments/my%20file.pdf';
  vault.files.set('/vault/_attachments/my file.pdf', 'pdf');
  vault.files.set('/vault/target/_attachments/my file.pdf', 'existing pdf');
  const result = await copyManagedAttachmentsForMarkdownVariants('/vault', '/vault/note.md', '/vault/target/note.md', [`[${href}](${href})`]);
  expect(vault.written).toHaveBeenCalledWith('/vault/target/_attachments/my file (2).pdf', new Uint8Array([1]));
  expect(result.markdownVariants).toEqual([`[${href}](_attachments/my%20file%20%282%29.pdf)`]);
});
