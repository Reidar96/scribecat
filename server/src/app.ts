import fastifyCookie from "@fastify/cookie";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";

import type { AuthStore } from "./auth/authStore.js";
import { createRequireSession } from "./auth/guard.js";
import { authRoutes } from "./auth/routes.js";
import type { SessionConfig } from "./auth/session.js";
import type { ServerConfig } from "./config.js";
import type { Vault } from "./vault/files.js";
import { fileRoutes } from "./vault/routes.js";
import { staticSite } from "./web/staticSite.js";

export type AppDependencies = {
  config: ServerConfig;
  authStore: AuthStore;
  vault: Vault;
  /** Built web client directory; omitted in tests that only exercise the API. */
  webDistDir?: string;
  logger?: FastifyServerOptions["logger"];
};

/** Notes can be long; the default 1 MiB would reject a big one on save. */
const BODY_LIMIT = 16 * 1024 * 1024;

/**
 * Wires the whole app together. Every route group is mounted under the base
 * path, so with SCRIBEDOG_BASE_PATH=/anna nothing at all answers under "/":
 * a bare request to the host is a 404 by design, because with several
 * instances behind one port there is no right answer for it.
 */
export async function buildApp(deps: AppDependencies): Promise<FastifyInstance> {
  const { config, authStore, vault } = deps;

  const app = Fastify({
    logger: deps.logger ?? false,
    trustProxy: config.trustProxy,
    bodyLimit: BODY_LIMIT,
    // A number where a string is expected is a malformed request, not a
    // value to coerce; keep the schemas strict.
    ajv: { customOptions: { coerceTypes: false } }
  });

  const session: SessionConfig = {
    secret: authStore.sessionSecret,
    maxAgeMs: config.sessionMaxAgeDays * 24 * 60 * 60 * 1000,
    cookiePath: config.basePath || "/",
    secure: config.cookieSecure
  };

  const requireSession = createRequireSession(authStore, session);

  await app.register(fastifyCookie);

  await app.register(
    async (scoped) => {
      // Unauthenticated liveness probe for Docker/Compose health checks; it
      // lives under the base path like everything else.
      scoped.get("/api/health", async () => ({ ok: true }));

      await scoped.register(authRoutes, { authStore, session, prefix: "/api/auth" });
      await scoped.register(fileRoutes, { vault, requireSession, prefix: "/api" });

      if (deps.webDistDir) {
        await scoped.register(staticSite, { webDistDir: deps.webDistDir, basePath: config.basePath });
      }
    },
    { prefix: config.basePath || undefined }
  );

  return app;
}
