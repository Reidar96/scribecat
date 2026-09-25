function safeBaseName(value: string): string {
  return value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+|\.+$/g, "")
    .trim();
}

function sourceBaseName(src: string): string {
  const withoutQuery = src.split(/[?#]/)[0] ?? src;
  const tail = withoutQuery.replace(/\\/g, "/").split("/").pop() ?? "";

  try {
    return decodeURIComponent(tail);
  } catch {
    return tail;
  }
}

export function suggestedImageFileName(src: string, alt = ""): string {
  const sourceName = safeBaseName(sourceBaseName(src));

  if (sourceName && /\.[a-z0-9]{2,6}$/i.test(sourceName)) {
    return sourceName;
  }

  return safeBaseName(alt) || "image";
}

export function sanitizeImageFileName(value: string): string {
  return safeBaseName(value);
}
