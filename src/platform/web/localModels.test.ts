import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { diagnoseLocalEndpoint, modelListUrl } from "./localModels";

const fetchMock = vi.fn();
let permissionState: PermissionState | "unsupported" = "prompt";

beforeEach(() => {
  fetchMock.mockReset();
  permissionState = "prompt";
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("navigator", {
    permissions: {
      query: async () => {
        if (permissionState === "unsupported") {
          throw new TypeError("not a valid permission name");
        }

        return { state: permissionState };
      }
    }
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** fetch answers per request mode: a rejection stands for the browser's "Failed to fetch". */
function answer(byMode: Partial<Record<RequestMode, "ok" | "fail">>) {
  fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
    if ((byMode[init.mode ?? "cors"] ?? "ok") === "fail") {
      throw new TypeError("Failed to fetch");
    }

    return new Response(null, { status: 200 });
  });
}

describe("modelListUrl", () => {
  it("asks each provider for its model list", () => {
    expect(modelListUrl("ollama", "http://localhost:11434")).toBe("http://localhost:11434/api/tags");
    expect(modelListUrl("jan", "http://localhost:1337")).toBe("http://localhost:1337/v1/models");
    expect(modelListUrl("lmstudio", "http://localhost:1234/")).toBe("http://localhost:1234/v1/models");
  });
});

describe("diagnoseLocalEndpoint", () => {
  it("reports a denied local network permission before probing anything", async () => {
    permissionState = "denied";
    answer({});

    expect(await diagnoseLocalEndpoint("ollama", "http://localhost:11434")).toBe("permission");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports unreachable when not even an opaque request gets through", async () => {
    answer({ "no-cors": "fail" });

    expect(await diagnoseLocalEndpoint("ollama", "http://localhost:11434")).toBe("unreachable");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports cors when the server answers but refuses the page's origin", async () => {
    answer({ "no-cors": "ok", cors: "fail" });

    expect(await diagnoseLocalEndpoint("jan", "http://localhost:1337")).toBe("cors");
  });

  it("reports ok when a normal request goes through", async () => {
    answer({});

    expect(await diagnoseLocalEndpoint("lmstudio", "http://localhost:1234")).toBe("ok");
  });

  // Firefox has no such permission; its rules are CORS only.
  it("works in a browser without the permission", async () => {
    permissionState = "unsupported";
    answer({ "no-cors": "ok", cors: "fail" });

    expect(await diagnoseLocalEndpoint("ollama", "http://localhost:11434")).toBe("cors");
  });

  it("treats an unusable URL as unreachable", async () => {
    expect(await diagnoseLocalEndpoint("ollama", "not a url")).toBe("unreachable");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
