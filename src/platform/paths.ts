import { platform } from "@/platform";

/**
 * Drop-in replacement for `@tauri-apps/api/path`: same names, same async
 * signatures, so a module switches over by changing one import line.
 */

export function join(...parts: string[]): Promise<string> {
  return platform.paths.join(...parts);
}

export function dirname(path: string): Promise<string> {
  return platform.paths.dirname(path);
}

export function normalize(path: string): Promise<string> {
  return platform.paths.normalize(path);
}
