import path from "node:path";

/**
 * Everything the server takes from the environment, parsed once at startup.
 * All of these are deployment decisions (where the vault is, which prefix the
 * reverse proxy routes to us), not user settings, which is why none of them
 * are editable from the UI.
 */
export type ServerConfig = {
  /** Absolute path of the one vault this instance serves. */
  vaultPath: string;
  /**
   * URL prefix the whole app lives under, normalized to "" (root) or
   * "/prefix" (leading slash, no trailing slash). Every route, asset URL and
   * the session cookie's Path attribute are derived from this one value.
   */
  basePath: string;
  host: string;
  port: number;
  /**
   * Initial password, honoured only while the vault has no password hash yet.
   * Once a hash exists the variable is ignored (and a startup log line says
   * so), otherwise every redeploy with the variable still set would reset the
   * password.
   */
  initPassword: string | null;
  /**
   * Whether the session cookie carries the Secure flag. Defaults to true
   * because the documented deployment always sits behind TLS; switched off
   * only for plain-http development on localhost.
   */
  cookieSecure: boolean;
  /** Trust X-Forwarded-* from the reverse proxy in front of us. */
  trustProxy: boolean;
  /** Hard cap for a session's lifetime, sliding expiration or not. */
  sessionMaxAgeDays: number;
  /**
   * Directory with the built web client (`npm run build:web` in the repo
   * root). Defaults to `../dist-web` relative to the server package, which
   * is where that build lands in a checkout and where the Docker image
   * copies it to.
   */
  webDistDir: string;
};

export class ConfigError extends Error {}

const BASE_PATH_SEGMENT = /^[A-Za-z0-9._~-]+$/;

/**
 * "" | "/" | undefined → "" (app at the root). Anything else becomes
 * "/segment/segment": leading slash added, trailing slashes and backslashes
 * removed, duplicate slashes collapsed. Segments are restricted to unreserved
 * URL characters, so the value can be dropped into routes, cookie Path
 * attributes and HTML without any further escaping.
 */
export function normalizeBasePath(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim().replace(/\\/g, "/");

  if (!trimmed || trimmed === "/") {
    return "";
  }

  const segments = trimmed.split("/").filter((segment) => segment.length > 0);

  if (segments.length === 0) {
    return "";
  }

  for (const segment of segments) {
    if (segment === "." || segment === ".." || !BASE_PATH_SEGMENT.test(segment)) {
      throw new ConfigError(
        `SCRIBEDOG_BASE_PATH "${raw}" is not a usable path prefix. Use letters, digits, "-", "_" and "." only, e.g. "/anna".`
      );
    }
  }

  return `/${segments.join("/")}`;
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }

  const value = raw.trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(value)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(value)) {
    return false;
  }

  throw new ConfigError(`Expected a boolean (true/false) but got "${raw}".`);
}

function parseInteger(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }

  const value = Number.parseInt(raw, 10);

  if (!Number.isFinite(value) || value <= 0) {
    throw new ConfigError(`${name} must be a positive integer, got "${raw}".`);
  }

  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const vaultPath = path.resolve(env.SCRIBEDOG_VAULT_PATH?.trim() || "/data");
  const initPassword = env.SCRIBEDOG_INIT_PASSWORD ?? null;

  return {
    vaultPath,
    basePath: normalizeBasePath(env.SCRIBEDOG_BASE_PATH),
    host: env.SCRIBEDOG_HOST?.trim() || "0.0.0.0",
    port: parseInteger(env.SCRIBEDOG_PORT, 3000, "SCRIBEDOG_PORT"),
    initPassword: initPassword && initPassword.length > 0 ? initPassword : null,
    cookieSecure: parseBoolean(env.SCRIBEDOG_COOKIE_SECURE, true),
    trustProxy: parseBoolean(env.SCRIBEDOG_TRUST_PROXY, true),
    webDistDir: path.resolve(env.SCRIBEDOG_WEB_DIST_DIR?.trim() || path.join(process.cwd(), "..", "dist-web")),
    sessionMaxAgeDays: Math.min(
      parseInteger(env.SCRIBEDOG_SESSION_MAX_AGE_DAYS, 60, "SCRIBEDOG_SESSION_MAX_AGE_DAYS"),
      60
    )
  };
}
