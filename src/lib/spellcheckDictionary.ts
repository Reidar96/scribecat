import { platform } from "@/platform";
import type { SpellcheckDictionaryStatus } from "@/platform/types";

export type { SpellcheckDictionaryStatus };

// On Windows/macOS the backend always resolves available: true (their OS
// spellcheckers cover the supported languages). On Linux it asks
// enchant-lsmod, the same dictionary lookup WebKitGTK's spellcheck backend
// uses itself, and, if nothing is installed, a best-effort install command
// for whichever of apt/dnf/pacman is present. In the browser the answer is
// always "available". If the call fails for any reason, fail open rather
// than block a feature that might work fine.
export async function checkSpellcheckDictionary(language: string): Promise<SpellcheckDictionaryStatus> {
  try {
    return await platform.spellcheck.checkDictionary(language);
  } catch {
    return { available: true, installCommand: null };
  }
}
