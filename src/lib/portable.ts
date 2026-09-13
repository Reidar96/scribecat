import { platform } from "@/platform";
import type { PortableMode, PortableStatus } from "@/platform/types";

export type { PortableMode, PortableStatus };

/**
 * Whether the app runs as the portable Windows build (its own files next to
 * the executable). Only the desktop shell can say; everywhere else the
 * answer is a constant "off".
 */
export function getPortableStatus(): Promise<PortableStatus> {
  return platform.portable.getStatus();
}
