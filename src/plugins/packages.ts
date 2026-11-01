import { unzipSync, strFromU8 } from "fflate";
import { join } from "@/platform/paths";
import { exists, mkdir, readDir, readTextFile, writeTextFile } from "@/platform/vaultFs";
import { BUILTIN_PLUGINS } from "@/plugins/registry";

export type PackageField = { key: string; label: string; multiline?: boolean };
export type PackageManifest = { schemaVersion: 1; id: string; name: string; description?: string; folder: string; fields: PackageField[] };
export const CUSTOM_PACKAGE_INSTRUCTIONS = `# Egen app for ScribeCat

Opprett manifest.json og pakk den som ZIP med manifest.json på øverste nivå.
Gå til Innstillinger → Apper → Last opp ZIP.

Eksempel på manifest.json:

\`\`\`json
{
  "schemaVersion": 1,
  "id": "mine-planter",
  "name": "Mine planter",
  "description": "Min planteoversikt",
  "folder": "Mine planter",
  "fields": [
    { "key": "sted", "label": "Sted" },
    { "key": "stell", "label": "Stell", "multiline": true }
  ]
}
\`\`\`

Oppføringene blir vanlige Markdown-filer under innholdsmappen:

\`\`\`markdown
# Basilikum

## sted

Kjøkkenvindu

## stell

Vann når jorden er tørr.
\`\`\`

Manifestet lagres i .scribecat/plugins/mine-planter/manifest.json.
Slett den mappen for å fjerne appen. Innholdsmappen beholdes.
ZIP-filen kjører aldri JavaScript eller annen kode.
`;
const idPattern = /^[a-z][a-z0-9-]{1,39}$/;
const safeSegment = (value: string) => !!value && !/[/\\:\x00-\x1f]/.test(value) && value !== "." && value !== "..";

export function parsePackageManifest(value: unknown): PackageManifest {
  if (!value || typeof value !== "object") throw new Error("Pakken mangler manifest.");
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== 1 || typeof raw.id !== "string" || !idPattern.test(raw.id) ||
      typeof raw.name !== "string" || !raw.name.trim() ||
      typeof raw.folder !== "string" || !safeSegment(raw.folder) || raw.folder === ".scribecat" ||
      BUILTIN_PLUGINS.some((plugin) => plugin.defaultFolder?.toLocaleLowerCase() === String(raw.folder).toLocaleLowerCase()) ||
      !Array.isArray(raw.fields) || raw.fields.length > 30) throw new Error("Ugyldig manifest.json.");
  const fields = raw.fields.map((field) => {
    if (!field || typeof field !== "object") throw new Error("Ugyldig felt.");
    const item = field as Record<string, unknown>;
    if (typeof item.key !== "string" || !idPattern.test(item.key) || typeof item.label !== "string" || !item.label.trim()) throw new Error("Ugyldig felt.");
    return { key: item.key, label: item.label, multiline: item.multiline === true };
  });
  if (new Set(fields.map((field) => field.key)).size !== fields.length) throw new Error("Dupliserte felt.");
  return { schemaVersion: 1, id: raw.id, name: raw.name, description: typeof raw.description === "string" ? raw.description : undefined, folder: raw.folder, fields };
}

export async function listInstalledPackages(vault: string): Promise<PackageManifest[]> {
  const root = await join(vault, ".scribecat", "plugins");
  if (!await exists(root)) return [];
  const folders = await readDir(root);
  const found = await Promise.all(folders.filter((entry) => entry.isDirectory).map(async (entry) => {
    try {
      const manifest = parsePackageManifest(JSON.parse(await readTextFile(await join(root, entry.name, "manifest.json"))));
      return manifest.id === entry.name ? manifest : null;
    } catch { return null; }
  }));
  return found.filter((entry): entry is PackageManifest => !!entry);
}

/** No executable code is loaded from ZIP. Only a small declarative manifest is installed. */
export async function installPackage(vault: string, bytes: Uint8Array): Promise<PackageManifest> {
  if (bytes.length > 2_000_000) throw new Error("ZIP-filen kan ikke være større enn 2 MB.");
  const files = unzipSync(bytes, { filter: (file) => file.name === "manifest.json" && file.originalSize <= 64_000 });
  if (!files["manifest.json"]) throw new Error("ZIP-filen må ha manifest.json på øverste nivå.");
  const manifest = parsePackageManifest(JSON.parse(strFromU8(files["manifest.json"])));
  const root = await join(vault, ".scribecat", "plugins", manifest.id);
  if (await exists(root)) throw new Error("Denne appen er allerede installert.");
  await mkdir(root, { recursive: true });
  await writeTextFile(await join(root, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  await mkdir(await join(vault, manifest.folder), { recursive: true });
  return manifest;
}
