import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { VAULT_META_DIR_NAME } from "./paths.js";

/**
 * The data folder's own version number, kept in `.scribedog/server-data-version`.
 *
 * It has nothing to do with the app's version: it counts only changes to the
 * layout on disk (the sidecars in `.scribedog/`, the server's files under
 * `.scribedog/server/`). Two things hang off it.
 *
 * - **Migrations.** A folder written by an older server is brought forward on
 *   startup, once, before anything serves a request.
 * - **Downgrade protection.** A folder written by a *newer* server stops this
 *   one from starting. Rolling an image back is the normal reaction to a bad
 *   release, and without this check that would be the moment a new format
 *   gets read by code that predates it, which is how half-written files and
 *   lost sidecars happen. Refusing to start says plainly what to do instead.
 */

export const DATA_VERSION_FILE_NAME = "server-data-version";

/** Bump together with a migration below, never on its own. */
export const CURRENT_DATA_VERSION = 1;

export class DataVersionError extends Error {}

type Migration = {
  /** Runs on a folder at `from` and leaves it at `from + 1`. */
  from: number;
  run(vaultPath: string): Promise<void>;
};

/**
 * Empty by design: version 1 is the first numbered layout, and everything
 * before it (a stage-1 or stage-2 folder with no marker at all) is the same
 * layout, so adopting it needs no work. A future entry gets added here and
 * the constant above goes up by one.
 */
const MIGRATIONS: Migration[] = [];

export type DataVersionLog = { info(message: string): void; warn(message: string): void };

function markerPath(vaultPath: string): string {
  return path.join(vaultPath, VAULT_META_DIR_NAME, DATA_VERSION_FILE_NAME);
}

/** Vault-relative path of the marker, for the file API's write protection. */
export const DATA_VERSION_RELATIVE_PATH = `${VAULT_META_DIR_NAME}/${DATA_VERSION_FILE_NAME}`;

async function readMarker(vaultPath: string): Promise<number | null> {
  let raw: string;

  try {
    raw = await readFile(markerPath(vaultPath), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DataVersionError(
      `${markerPath(vaultPath)} is not readable. Fix or delete the file; deleting it makes the server treat the folder as version ${CURRENT_DATA_VERSION}.`
    );
  }

  const version = (parsed as { dataVersion?: unknown } | null)?.dataVersion;

  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new DataVersionError(`${markerPath(vaultPath)} does not name a data version.`);
  }

  return version;
}

async function writeMarker(vaultPath: string, version: number): Promise<void> {
  const target = markerPath(vaultPath);
  const temporary = `${target}.${process.pid}.tmp`;

  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(temporary, `${JSON.stringify({ dataVersion: version, updatedAt: new Date().toISOString() }, null, 2)}\n`);
  await rename(temporary, target);
}

/**
 * Checks the marker, runs whatever migrations are missing and leaves the
 * folder stamped with the current version. Throws (and so stops the start) on
 * a folder from a newer server.
 */
export async function ensureDataVersion(vaultPath: string, log: DataVersionLog): Promise<number> {
  const found = await readMarker(vaultPath);

  if (found === null) {
    await writeMarker(vaultPath, CURRENT_DATA_VERSION);

    return CURRENT_DATA_VERSION;
  }

  if (found > CURRENT_DATA_VERSION) {
    throw new DataVersionError(
      `This data folder was written by a newer ScribeDog server (data version ${found}); this one understands version ${CURRENT_DATA_VERSION}. ` +
        "Start the newer image again, or restore a backup of the folder from before the upgrade."
    );
  }

  if (found === CURRENT_DATA_VERSION) {
    return found;
  }

  let version = found;

  for (const migration of MIGRATIONS.filter((entry) => entry.from >= found).sort((left, right) => left.from - right.from)) {
    log.info(`Migrating the data folder from version ${migration.from} to ${migration.from + 1}.`);
    await migration.run(vaultPath);
    version = migration.from + 1;
    await writeMarker(vaultPath, version);
  }

  if (version !== CURRENT_DATA_VERSION) {
    throw new DataVersionError(
      `The data folder is at version ${version} and no migration leads to version ${CURRENT_DATA_VERSION}. This is a bug; please report it.`
    );
  }

  return version;
}
