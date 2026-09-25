import { describe, expect, it } from "vitest";

import { buildVaultGraph } from "./graphIndex";

describe("buildVaultGraph", () => {
  it("connects notes through markdown links, tags and full folder ancestry", () => {
    const folderPath = "/vault";
    const filePaths = [
      "/vault/alpha.md",
      "/vault/projects/client/beta.md",
      "/vault/projects/gamma.md"
    ];
    const markdownByPath = {
      "/vault/alpha.md": "---\ntags: [shared]\n---\n[Beta](projects/client/beta.md)",
      "/vault/projects/client/beta.md": "---\ntags:\n  - shared\n  - work\n---\n[Alpha](../../alpha.md)",
      "/vault/projects/gamma.md": "No links"
    };

    const graph = buildVaultGraph({
      folderPath,
      filePaths,
      markdownByPath,
      rootLabel: "Home"
    });

    expect(graph.nodes.filter((node) => node.kind === "note")).toHaveLength(3);
    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "folder:", kind: "folder", label: "Home", relativePath: "" }),
        expect.objectContaining({
          id: "folder:projects",
          kind: "folder",
          label: "projects",
          relativePath: "projects"
        }),
        expect.objectContaining({
          id: "folder:projects/client",
          kind: "folder",
          label: "client",
          relativePath: "projects/client"
        }),
        expect.objectContaining({ id: "tag:shared", kind: "tag", label: "#shared" }),
        expect.objectContaining({ id: "tag:work", kind: "tag", label: "#work" })
      ])
    );

    // The reciprocal Alpha/Beta links are one visual connection.
    expect(graph.edges.filter((edge) => edge.kind === "link")).toHaveLength(1);
    expect(graph.edges.filter((edge) => edge.kind === "folder")).toHaveLength(5);
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "folder",
          source: "folder:projects/client",
          target: "folder:projects"
        }),
        expect.objectContaining({
          kind: "folder",
          source: "folder:projects",
          target: "folder:"
        })
      ])
    );
    expect(graph.edges.filter((edge) => edge.kind === "tag")).toHaveLength(3);
  });

  it("ignores unresolved markdown links instead of inventing graph nodes", () => {
    const graph = buildVaultGraph({
      folderPath: "/vault",
      filePaths: ["/vault/a.md"],
      markdownByPath: {
        "/vault/a.md": "[Missing](missing.md)"
      },
      rootLabel: "Home"
    });

    expect(graph.nodes.some((node) => node.id.includes("missing.md"))).toBe(false);
    expect(graph.edges.some((edge) => edge.kind === "link")).toBe(false);
  });
});
