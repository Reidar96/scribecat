/** Match Norwegian opening and closing quotes while leaving Markdown code alone. */
export function angleQuoteFor(previousCharacter: string): "«" | "»" {
  return !previousCharacter || /[\s([{—–]/u.test(previousCharacter) ? "«" : "»";
}
