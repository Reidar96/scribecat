import { defineConfig } from "@playwright/test";

// Browser end-to-end run against an already running instance (typically the
// docker compose stack). Point SCRIBEDOG_E2E_URL at the app, base path
// included, e.g. https://localhost/ or https://localhost:9443/anna/, and
// SCRIBEDOG_E2E_PASSWORD at its password. Caddy's local CA is usually not in
// the test machine's trust store, hence ignoreHTTPSErrors; TLS itself is
// verified separately with curl against Caddy's root certificate.
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  // One worker: the specs share a single live instance, one vault and one
  // password, and account.spec.ts changes that password mid-run.
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.SCRIBEDOG_E2E_URL ?? "https://localhost/",
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure"
  }
});
