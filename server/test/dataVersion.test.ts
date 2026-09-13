import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CURRENT_DATA_VERSION,
  DATA_VERSION_FILE_NAME,
  DataVersionError,
  ensureDataVersion
} from "../src/vault/dataVersion.js";
import { VAULT_META_DIR_NAME } from "../src/vault/paths.js";
import { createTempVault, createTestContext, type TestContext } from "./helpers.js";

const silentLog = { info: () => {}, warn: () => {} };

describe("data version marker", () => {
  let vaultPath: string;

  const markerPath = () => path.join(vaultPath, VAULT_META_DIR_NAME, DATA_VERSION_FILE_NAME);

  const writeMarker = async (content: string) => {
    await mkdir(path.dirname(markerPath()), { recursive: true });
    await writeFile(markerPath(), content);
  };

  beforeEach(async () => {
    vaultPath = await createTempVault();
  });

  afterEach(async () => {
    await rm(vaultPath, { recursive: true, force: true });
  });

  it("stamps a folder that has no marker yet", async () => {
    expect(await ensureDataVersion(vaultPath, silentLog)).toBe(CURRENT_DATA_VERSION);
    expect(JSON.parse(await readFile(markerPath(), "utf8"))).toMatchObject({ dataVersion: CURRENT_DATA_VERSION });
  });

  it("accepts its own marker unchanged", async () => {
    await ensureDataVersion(vaultPath, silentLog);
    const first = await readFile(markerPath(), "utf8");

    expect(await ensureDataVersion(vaultPath, silentLog)).toBe(CURRENT_DATA_VERSION);
    expect(await readFile(markerPath(), "utf8")).toBe(first);
  });

  it("refuses to start on a folder from a newer server", async () => {
    await writeMarker(JSON.stringify({ dataVersion: CURRENT_DATA_VERSION + 1 }));

    await expect(ensureDataVersion(vaultPath, silentLog)).rejects.toThrow(DataVersionError);
  });

  it("refuses a marker it cannot read", async () => {
    await writeMarker("not json");
    await expect(ensureDataVersion(vaultPath, silentLog)).rejects.toThrow(DataVersionError);

    await writeMarker(JSON.stringify({ dataVersion: "one" }));
    await expect(ensureDataVersion(vaultPath, silentLog)).rejects.toThrow(DataVersionError);
  });
});

describe("the marker through the file API", () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
    await ensureDataVersion(context.vault.realPath, silentLog);
  });

  afterEach(async () => {
    await context.cleanup();
  });

  const relativePath = `${VAULT_META_DIR_NAME}/${DATA_VERSION_FILE_NAME}`;

  it("can be read but not written, renamed or removed", async () => {
    const cookie = await context.login();

    expect(
      (await context.app.inject({ method: "GET", url: `/api/fs/text?path=${encodeURIComponent(relativePath)}`, headers: { cookie } }))
        .statusCode
    ).toBe(200);

    expect(
      (
        await context.app.inject({
          method: "PUT",
          url: "/api/fs/text",
          headers: { cookie },
          payload: { path: relativePath, content: '{"dataVersion":99}' }
        })
      ).statusCode
    ).toBe(400);

    expect(
      (
        await context.app.inject({
          method: "POST",
          url: "/api/fs/remove",
          headers: { cookie },
          payload: { path: relativePath }
        })
      ).statusCode
    ).toBe(400);

    expect(
      (
        await context.app.inject({
          method: "POST",
          url: "/api/fs/rename",
          headers: { cookie },
          payload: { from: relativePath, to: `${VAULT_META_DIR_NAME}/elsewhere` }
        })
      ).statusCode
    ).toBe(400);

    expect(JSON.parse(await readFile(path.join(context.vault.realPath, VAULT_META_DIR_NAME, DATA_VERSION_FILE_NAME), "utf8"))).toMatchObject(
      { dataVersion: CURRENT_DATA_VERSION }
    );
  });
});
