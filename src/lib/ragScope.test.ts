import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/path", () => ({ join: async (...parts: string[]) => parts.join("/") }));
vi.mock("@tauri-apps/plugin-fs", () => ({}));

const features = { knowledgeIndex: true };

vi.mock("@/platform", () => ({
  platform: { features },
  PlatformUnavailableError: class extends Error {}
}));
vi.mock("@/lib/fileSystem", () => ({
  getRelativeDisplayPath: (root: string, filePath: string) => filePath.slice(root.length + 1)
}));

const appState = { folderPath: "/vault" as string | null, filePaths: ["/vault/Notes/Idea.md", "/vault/Todo.md"] };
const ragState = { config: { enabled: true, rootIncluded: true, overrides: {} } };

vi.mock("@/store/useAppStore", () => ({ useAppStore: { getState: () => appState } }));
vi.mock("@/store/useRagSettingsStore", () => ({ useRagSettingsStore: { getState: () => ragState } }));

const { currentScope, isKnowledgeBaseReady } = await import("./ragScope");

describe("currentScope", () => {
  beforeEach(() => {
    features.knowledgeIndex = true;
    appState.folderPath = "/vault";
    ragState.config = { enabled: true, rootIncluded: true, overrides: {} };
  });

  it("covers the included files of the open vault", () => {
    expect(currentScope()).toEqual({ root: "/vault", files: ["Notes/Idea.md", "Todo.md"] });
    expect(isKnowledgeBaseReady()).toBe(true);
  });

  it("is empty without the vault's consent switch, unless the settings tab asks", () => {
    ragState.config = { ...ragState.config, enabled: false };

    expect(currentScope()).toBeNull();
    expect(isKnowledgeBaseReady()).toBe(false);
    expect(currentScope({ requireEnabled: false })).not.toBeNull();
  });

  // The switch travels with the vault (rag.json), so a vault prepared on the
  // desktop reaches the browser switched on. The shell without an index must
  // still not offer the search tools.
  it("is empty on a shell without a knowledge index, whatever the vault says", () => {
    features.knowledgeIndex = false;

    expect(currentScope()).toBeNull();
    expect(currentScope({ requireEnabled: false })).toBeNull();
    expect(isKnowledgeBaseReady()).toBe(false);
  });

  it("is empty without an open folder", () => {
    appState.folderPath = null;

    expect(currentScope()).toBeNull();
  });
});
