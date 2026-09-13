
import { buildApp } from "./app.js";
import { AuthSetupError, openAuthStore } from "./auth/authStore.js";
import { ConfigError, loadConfig } from "./config.js";
import { openVault } from "./vault/files.js";
import { ensureWelcomeNote } from "./vault/welcome.js";


async function main(): Promise<void> {
  const config = loadConfig();

  // Bootstrapping happens before the Fastify logger exists, so use a tiny
  // shim with the same shape; the real logger takes over in buildApp.
  const bootLog = {
    info: (message: string) => console.log(`[scribedog] ${message}`),
    warn: (message: string) => console.warn(`[scribedog] WARNING: ${message}`)
  };

  const vault = await openVault(config.vaultPath);
  await ensureWelcomeNote(vault, bootLog);

  const authStore = await openAuthStore({
    vaultPath: vault.realPath,
    initPassword: config.initPassword,
    log: bootLog
  });

  const app = await buildApp({
    config,
    authStore,
    vault,
    webDistDir: config.webDistDir,
    logger: { level: process.env.SCRIBEDOG_LOG_LEVEL ?? "info" }
  });

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ host: config.host, port: config.port });

  app.log.info(
    { vault: vault.realPath, basePath: config.basePath || "/", cookieSecure: config.cookieSecure, webDistDir: config.webDistDir },
    "ScribeDog Server ready"
  );

  if (!config.cookieSecure) {
    app.log.warn("SCRIBEDOG_COOKIE_SECURE=false: the session cookie is sent over plain HTTP. Development only.");
  }
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError || error instanceof AuthSetupError) {
    console.error(`[scribedog] ${error.message}`);
  } else {
    console.error("[scribedog] failed to start", error);
  }

  process.exit(1);
});
