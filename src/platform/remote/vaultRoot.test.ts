import { describe, expect, it } from "vitest";

import { isRemoteVaultPath, remoteVaultRootFor } from "./vaultRoot";

describe("remote vault root", () => {
  it("names host, port and base path, so two instances on one host stay apart", () => {
    expect(remoteVaultRootFor("https://notes.example.com")).toBe("/@remote/notes.example.com");
    expect(remoteVaultRootFor("https://notes.example.com/anna")).toBe("/@remote/notes.example.com/anna");
    expect(remoteVaultRootFor("https://localhost:9443/")).toBe("/@remote/localhost:9443");
  });

  it("tells a server vault path from a local one, either separator", () => {
    expect(isRemoteVaultPath("/@remote/notes.example.com/Notes/Idea.md")).toBe(true);
    expect(isRemoteVaultPath("\\@remote\\notes.example.com\\Notes\\Idea.md")).toBe(true);
    expect(isRemoteVaultPath("C:\\Users\\me\\Notes")).toBe(false);
    expect(isRemoteVaultPath("/home/me/@remote")).toBe(false);
    expect(isRemoteVaultPath("/vault/Idea.md")).toBe(false);
  });
});
