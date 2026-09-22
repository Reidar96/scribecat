/**
 * The placeholder the browser uses in place of an API key.
 *
 * In the server edition the key never reaches the tab: the settings dialog
 * stores it through `/api/secrets`, and from then on the frontend carries
 * `{{scribecat-secret:openai}}` wherever the desktop build would carry the key
 * itself. The value travels through `aiClient.ts` untouched (that file knows
 * nothing about any of this) and is substituted by the LLM proxy, right before
 * the request leaves for the provider.
 *
 * Keep in step with src/platform/web/secretRef.ts, which produces these.
 */

const PATTERN = /\{\{scribecat-secret:([A-Za-z0-9._:-]{1,64})\}\}/g;

export function secretRef(id: string): string {
  return `{{scribecat-secret:${id}}}`;
}

/** Ids referenced in the given values, without duplicates. */
export function secretRefIds(values: readonly string[]): string[] {
  const ids = new Set<string>();

  for (const value of values) {
    for (const match of value.matchAll(PATTERN)) {
      ids.add(match[1]);
    }
  }

  return [...ids];
}

/**
 * Replaces every placeholder with the value `lookup` returns for it. An id
 * without a stored value keeps its placeholder, so the provider answers with
 * its own "invalid key" error instead of the request silently going out with
 * something that looks like a key.
 */
export function resolveSecretRefs(value: string, lookup: ReadonlyMap<string, string>): string {
  return value.replace(PATTERN, (placeholder, id: string) => lookup.get(id) ?? placeholder);
}
