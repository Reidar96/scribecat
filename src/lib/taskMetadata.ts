export type TaskMetadata = Record<string, string>;

const METADATA_SUFFIX_PATTERN =
  /^(.*?)(?:\s+<!--\s*scribecat:([a-z0-9_-]+)=([^>]+?)\s*-->)\s*$/is;

export function parseTaskMetadataSuffix(raw: string): {
  content: string;
  metadata: TaskMetadata;
} {
  let content = raw.trimEnd();
  const metadata: TaskMetadata = {};

  while (true) {
    const match = METADATA_SUFFIX_PATTERN.exec(content);
    if (!match) break;

    content = match[1].trimEnd();
    metadata[match[2].toLocaleLowerCase()] = match[3].trim();
  }

  return { content, metadata };
}

export function setTaskMetadataValue(
  line: string,
  key: string,
  value: string | null | undefined
): string {
  const parsed = parseTaskMetadataSuffix(line);
  const metadata = { ...parsed.metadata };
  const normalizedKey = key.trim().toLocaleLowerCase();

  if (!normalizedKey) return line;

  if (value === null || value === undefined || !value.trim()) {
    delete metadata[normalizedKey];
  } else {
    metadata[normalizedKey] = value.trim();
  }

  const suffix = Object.entries(metadata)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([metadataKey, metadataValue]) =>
      `<!-- scribecat:${metadataKey}=${metadataValue} -->`
    )
    .join(" ");

  return suffix ? `${parsed.content.trimEnd()} ${suffix}` : parsed.content.trimEnd();
}

export function taskMetadataIsoDate(
  metadata: Readonly<TaskMetadata>,
  key: string
): string | undefined {
  const raw = metadata[key.toLocaleLowerCase()];
  if (!raw) return undefined;

  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}
