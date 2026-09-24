export type FrontmatterDocument = {
  frontmatter: string | null;
  body: string;
};

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export function splitFrontmatter(markdown: string): FrontmatterDocument {
  const match = FRONTMATTER_PATTERN.exec(markdown);

  if (!match) {
    return { frontmatter: null, body: markdown };
  }

  return {
    frontmatter: match[1],
    body: markdown.slice(match[0].length)
  };
}

export function composeFrontmatter(frontmatter: string | null, body: string): string {
  const normalized = frontmatter?.trim();

  if (!normalized) {
    return body;
  }

  return `---\n${normalized}\n---\n${body}`;
}

function unquoteYamlScalar(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed);
      return typeof parsed === "string" ? parsed : trimmed;
    } catch {
      return trimmed.slice(1, -1);
    }
  }

  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }

  return trimmed;
}

export function normalizeTag(value: string): string {
  return value.trim().replace(/^#+/, "").trim();
}

export function extractTags(markdown: string): string[] {
  const { frontmatter } = splitFrontmatter(markdown);

  if (!frontmatter) {
    return [];
  }

  const lines = frontmatter.split(/\r?\n/);
  const tags: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = /^tags\s*:\s*(.*)$/i.exec(lines[index]);

    if (!match) {
      continue;
    }

    const inline = match[1].trim();

    if (inline.startsWith("[") && inline.endsWith("]")) {
      inline
        .slice(1, -1)
        .split(",")
        .map(unquoteYamlScalar)
        .map(normalizeTag)
        .filter(Boolean)
        .forEach((tag) => tags.push(tag));
      break;
    }

    if (inline) {
      const tag = normalizeTag(unquoteYamlScalar(inline));
      if (tag) tags.push(tag);
      break;
    }

    for (let child = index + 1; child < lines.length; child += 1) {
      const item = /^\s+-\s+(.+)$/.exec(lines[child]);

      if (!item) {
        break;
      }

      const tag = normalizeTag(unquoteYamlScalar(item[1]));
      if (tag) tags.push(tag);
      index = child;
    }

    break;
  }

  const seen = new Set<string>();

  return tags.filter((tag) => {
    const key = tag.toLocaleLowerCase();

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function withoutTagsField(frontmatter: string): string {
  const lines = frontmatter.split(/\r?\n/);
  const result: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (!/^tags\s*:/i.test(lines[index])) {
      result.push(lines[index]);
      continue;
    }

    while (index + 1 < lines.length && /^\s+-\s+/.test(lines[index + 1])) {
      index += 1;
    }
  }

  while (result.length > 0 && result[result.length - 1].trim() === "") {
    result.pop();
  }

  return result.join("\n");
}

export function setTags(markdown: string, values: string[]): string {
  const { frontmatter, body } = splitFrontmatter(markdown);
  const seen = new Set<string>();
  const tags = values
    .map(normalizeTag)
    .filter(Boolean)
    .filter((tag) => {
      const key = tag.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  const remaining = frontmatter ? withoutTagsField(frontmatter) : "";
  const tagLines = tags.length > 0
    ? ["tags:", ...tags.map((tag) => `  - ${JSON.stringify(tag)}`)].join("\n")
    : "";
  const nextFrontmatter = [remaining, tagLines].filter((part) => part.trim()).join("\n");

  return composeFrontmatter(nextFrontmatter || null, body);
}

export function replaceBody(markdown: string, body: string): string {
  const { frontmatter } = splitFrontmatter(markdown);
  return composeFrontmatter(frontmatter, body);
}
