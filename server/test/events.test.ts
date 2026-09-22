import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import WebSocket from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestContext, type TestContext } from "./helpers.js";

function connect(url: string, cookie?: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers: cookie ? { cookie } : {} });
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
    socket.once("unexpected-response", (_request, response) => reject(new Error(`HTTP ${response.statusCode}`)));
  });
}

function nextMessage(socket: WebSocket, timeoutMs = 3000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no message")), timeoutMs);
    socket.once("message", (data) => {
      clearTimeout(timer);
      resolve(data.toString());
    });
  });
}

describe("live updates", () => {
  let context: TestContext;
  let cookie: string;
  let baseUrl: string;

  beforeEach(async () => {
    context = await createTestContext({ SCRIBECAT_BASE_PATH: "/anna" }, { watch: true });
    cookie = await context.login();
    const address = await context.app.listen({ host: "127.0.0.1", port: 0 });
    baseUrl = address.replace(/^http/, "ws");
  });

  afterEach(async () => {
    await context.cleanup();
  });

  it("refuses the upgrade without a session", async () => {
    await expect(connect(`${baseUrl}/anna/api/events`)).rejects.toThrow(/401/);
  });

  it("tells a signed-in client when a note changes, but not about sidecars", async () => {
    const socket = await connect(`${baseUrl}/anna/api/events`, cookie);

    try {
      // A write to the vault from outside the app (another client, a sync
      // tool on the host) is exactly what the signal is for.
      const pending = nextMessage(socket);
      await writeFile(path.join(context.vaultPath, "Notes", "Fresh.md"), "# Fresh\n");
      expect(JSON.parse(await pending)).toEqual({ type: "files-changed" });

      // The frontend's own sidecar writes happen on every save and must not
      // bounce back as a rescan.
      await mkdir(path.join(context.vaultPath, ".scribecat", "versions"), { recursive: true });
      await writeFile(path.join(context.vaultPath, ".scribecat", "versions", "index.json"), "{}");
      await expect(nextMessage(socket, 600)).rejects.toThrow(/no message/);
    } finally {
      socket.close();
    }
  });

  it("collapses a burst of changes into one message", async () => {
    const socket = await connect(`${baseUrl}/anna/api/events`, cookie);

    try {
      const pending = nextMessage(socket);

      for (let index = 0; index < 5; index += 1) {
        await writeFile(path.join(context.vaultPath, `Burst-${index}.md`), "# x\n");
      }

      await pending;
      await expect(nextMessage(socket, 600)).rejects.toThrow(/no message/);
    } finally {
      socket.close();
    }
  });
});
