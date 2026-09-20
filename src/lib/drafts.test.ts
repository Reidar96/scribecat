// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * An in-memory vault: the platform's fs primitives over a plain map, so the
 * index/blob layout can be asserted on and the pruning of orphans exercised
 * without a shell.
 */
const disk = vi.hoisted(() => {
  const files = new Map<string, string>();
  const dirs = new Set<string>();

  return {
    files,
    dirs,
    reset() {
      files.clear();
      dirs.clear();
    }
  };
});

const platformState = vi.hoisted(() => ({ localFolders: true }));

vi.mock("@/platform", () => ({
  platform: {
    get features() {
      return { localFolders: platformState.localFolders };
    }
  }
}));

vi.mock("@/platform/paths", () => ({
  join: async (...parts: string[]) => parts.join("/"),
  dirname: async (path: string) => path.slice(0, path.lastIndexOf("/")),
  normalize: async (path: string) => path
}));

vi.mock("@/platform/vaultFs", () => ({
  exists: async (path: string) => disk.files.has(path) || disk.dirs.has(path),
  mkdir: async (path: string) => {
    disk.dirs.add(path);
  },
  readTextFile: async (path: string) => {
    const content = disk.files.get(path);

    if (content === undefined) {
      throw new Error(`ENOENT ${path}`);
    }

    return content;
  },
  writeTextFile: async (path: string, content: string) => {
    disk.files.set(path, content);
  },
  remove: async (path: string, options?: { recursive?: boolean }) => {
    if (options?.recursive) {
      for (const key of [...disk.files.keys()]) {
        if (key.startsWith(`${path}/`)) {
          disk.files.delete(key);
        }
      }

      disk.dirs.delete(path);
      return;
    }

    if (!disk.files.delete(path)) {
      throw new Error(`ENOENT ${path}`);
    }
  },
  readDir: async (path: string) =>
    [...disk.files.keys()]
      .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes("/"))
      .map((key) => ({ name: key.slice(path.length + 1), isFile: true, isDirectory: false, isSymlink: false }))
}));

const {
  clearDrafts,
  deleteDraft,
  deleteFolderDrafts,
  loadDrafts,
  moveDraft,
  moveFolderDrafts,
  normalizeDraftIndex,
  readDraftIndex,
  writeDraft
} = await import("./drafts");

const VAULT = "D:/Vault";
const DRAFTS_DIR = `${VAULT}/.scribedog/drafts`;
const INDEX = `${DRAFTS_DIR}/index.json`;

function blobFiles(): string[] {
  return [...disk.files.keys()].filter((key) => key.startsWith(`${DRAFTS_DIR}/`) && key.endsWith(".md"));
}

beforeEach(() => {
  disk.reset();
  platformState.localFolders = true;
  localStorage.clear();
});

describe("writeDraft / loadDrafts", () => {
  it("round-trips a draft through the index and its blob", async () => {
    await writeDraft(VAULT, "Notes/Idea.md", "# Draft", 1234);

    const index = await readDraftIndex(VAULT);
    expect(Object.keys(index.entries)).toEqual(["Notes/Idea.md"]);
    expect(index.entries["Notes/Idea.md"].baseMtimeMs).toBe(1234);

    const drafts = await loadDrafts(VAULT);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ relativePath: "Notes/Idea.md", content: "# Draft", baseMtimeMs: 1234 });
  });

  // A draft is rewritten after every pause in typing; a new blob per write
  // would be the churn the debounce is there to avoid.
  it("rewrites the same blob on a second write, last content wins", async () => {
    await writeDraft(VAULT, "Idea.md", "one", null);
    await writeDraft(VAULT, "Idea.md", "two", null);

    expect(blobFiles()).toHaveLength(1);
    expect((await loadDrafts(VAULT))[0].content).toBe("two");
  });

  it("treats separators and case as the same key, keeping one entry", async () => {
    await writeDraft(VAULT, "Notes\\Idea.md", "a", null);
    await writeDraft(VAULT, "notes/idea.md", "b", null);

    const index = await readDraftIndex(VAULT);
    expect(Object.keys(index.entries)).toEqual(["notes/idea.md"]);
    expect(blobFiles()).toHaveLength(1);
  });

  it("writes nothing for an empty path", async () => {
    await writeDraft(VAULT, "", "x", null);

    expect(disk.files.has(INDEX)).toBe(false);
  });
});

describe("deleteDraft", () => {
  it("removes the entry and its blob", async () => {
    await writeDraft(VAULT, "Idea.md", "text", null);
    await deleteDraft(VAULT, "idea.md");

    expect(Object.keys((await readDraftIndex(VAULT)).entries)).toEqual([]);
    expect(blobFiles()).toEqual([]);
  });

  it("is a no-op for a path without a draft", async () => {
    await writeDraft(VAULT, "Idea.md", "text", null);
    await deleteDraft(VAULT, "Other.md");

    expect(Object.keys((await readDraftIndex(VAULT)).entries)).toEqual(["Idea.md"]);
  });
});

describe("moveDraft", () => {
  it("rekeys the entry and keeps the blob", async () => {
    await writeDraft(VAULT, "Old.md", "text", 7);
    const blobsBefore = blobFiles();

    await moveDraft(VAULT, "Old.md", "Notes/New.md");

    const index = await readDraftIndex(VAULT);
    expect(Object.keys(index.entries)).toEqual(["Notes/New.md"]);
    expect(index.entries["Notes/New.md"].baseMtimeMs).toBe(7);
    expect(blobFiles()).toEqual(blobsBefore);
  });

  it("replaces a stale draft already sitting at the target", async () => {
    await writeDraft(VAULT, "Target.md", "stale", null);
    await writeDraft(VAULT, "Source.md", "live", null);

    await moveDraft(VAULT, "Source.md", "Target.md");

    const drafts = await loadDrafts(VAULT);
    expect(drafts).toEqual([expect.objectContaining({ relativePath: "Target.md", content: "live" })]);
    expect(blobFiles()).toHaveLength(1);
  });
});

describe("moveFolderDrafts / deleteFolderDrafts", () => {
  it("moves every draft under the folder, not siblings with the same prefix", async () => {
    await writeDraft(VAULT, "Work/A.md", "a", null);
    await writeDraft(VAULT, "Work/Sub/B.md", "b", null);
    await writeDraft(VAULT, "Workshop/C.md", "c", null);

    await moveFolderDrafts(VAULT, "Work", "Archive/Work");

    expect(Object.keys((await readDraftIndex(VAULT)).entries).sort()).toEqual([
      "Archive/Work/A.md",
      "Archive/Work/Sub/B.md",
      "Workshop/C.md"
    ]);
  });

  it("moves into the vault root when the new prefix is empty", async () => {
    await writeDraft(VAULT, "Work/A.md", "a", null);

    await moveFolderDrafts(VAULT, "Work", "");

    expect(Object.keys((await readDraftIndex(VAULT)).entries)).toEqual(["A.md"]);
  });

  it("deletes the drafts under a folder together with their blobs", async () => {
    await writeDraft(VAULT, "Work/A.md", "a", null);
    await writeDraft(VAULT, "Keep.md", "k", null);

    await deleteFolderDrafts(VAULT, "work");

    expect(Object.keys((await readDraftIndex(VAULT)).entries)).toEqual(["Keep.md"]);
    expect(blobFiles()).toHaveLength(1);
  });
});

describe("loadDrafts housekeeping", () => {
  it("deletes blobs the index does not mention", async () => {
    await writeDraft(VAULT, "Idea.md", "text", null);
    disk.files.set(`${DRAFTS_DIR}/draft-orphan.md`, "leftover");

    await loadDrafts(VAULT);

    expect(blobFiles()).toHaveLength(1);
    expect(disk.files.has(`${DRAFTS_DIR}/draft-orphan.md`)).toBe(false);
  });

  it("drops an entry whose blob is missing", async () => {
    await writeDraft(VAULT, "Idea.md", "text", null);
    await writeDraft(VAULT, "Other.md", "text", null);
    const { entries } = await readDraftIndex(VAULT);
    disk.files.delete(`${DRAFTS_DIR}/${entries["Idea.md"].blobId}.md`);

    const drafts = await loadDrafts(VAULT);

    expect(drafts.map((draft) => draft.relativePath)).toEqual(["Other.md"]);
    expect(Object.keys((await readDraftIndex(VAULT)).entries)).toEqual(["Other.md"]);
  });

  it("returns nothing and touches nothing for a vault without drafts", async () => {
    expect(await loadDrafts(VAULT)).toEqual([]);
    expect(disk.files.size).toBe(0);
  });

  it("clearDrafts removes the whole directory", async () => {
    await writeDraft(VAULT, "Idea.md", "text", null);

    await clearDrafts(VAULT);

    expect(disk.files.size).toBe(0);
    expect(await loadDrafts(VAULT)).toEqual([]);
  });
});

describe("normalizeDraftIndex", () => {
  it("tolerates garbage and skips malformed entries", () => {
    expect(normalizeDraftIndex(null)).toEqual({ version: 1, entries: {} });
    expect(normalizeDraftIndex({ entries: [] })).toEqual({ version: 1, entries: {} });
    expect(
      normalizeDraftIndex({
        entries: {
          "ok.md": { blobId: "b1", baseMtimeMs: "x", updatedAt: 5 },
          "bad.md": { blobId: "" },
          "": { blobId: "b2" }
        }
      })
    ).toEqual({ version: 1, entries: { "ok.md": { blobId: "b1", baseMtimeMs: null, updatedAt: 5 } } });
  });
});

// A server vault is shared; the draft belongs to the person typing it.
describe("shared vaults", () => {
  it("keeps drafts of a remote root in localStorage, never on the server", async () => {
    const root = "/@remote/notes.example.org";

    await writeDraft(root, "Idea.md", "local only", 3);

    expect(disk.files.size).toBe(0);
    expect(await loadDrafts(root)).toEqual([
      expect.objectContaining({ relativePath: "Idea.md", content: "local only", baseMtimeMs: 3 })
    ]);

    await deleteDraft(root, "Idea.md");
    expect(await loadDrafts(root)).toEqual([]);
    expect(localStorage.length).toBe(1); // the (now empty) index
  });

  it("uses localStorage in the browser edition, whose root is not a remote path", async () => {
    platformState.localFolders = false;

    await writeDraft("/vault", "Idea.md", "browser", null);

    expect(disk.files.size).toBe(0);
    expect((await loadDrafts("/vault"))[0].content).toBe("browser");
  });

  it("prunes orphaned blobs in localStorage too", async () => {
    const root = "/@remote/notes.example.org";
    await writeDraft(root, "Idea.md", "text", null);
    localStorage.setItem("scribedog-drafts:@remote/notes.example.org:blob:draft-orphan", "x");

    await loadDrafts(root);

    expect(localStorage.getItem("scribedog-drafts:@remote/notes.example.org:blob:draft-orphan")).toBeNull();
  });
});
