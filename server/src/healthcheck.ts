import { loadConfig } from "./config.js";

// Docker HEALTHCHECK entry point. Uses the same config parsing as the server
// so a base path written as "anna" or "/anna/" resolves to the same URL.
const config = loadConfig();
const host = config.host === "0.0.0.0" ? "127.0.0.1" : config.host;

fetch(`http://${host}:${config.port}${config.basePath}/api/health`)
  .then((response) => process.exit(response.ok ? 0 : 1))
  .catch(() => process.exit(1));
