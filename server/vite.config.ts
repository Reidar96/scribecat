import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// The web client is built exactly once and shipped in one Docker image, but
// every installation may run under its own SCRIBEDOG_BASE_PATH. Vite would
// bake `base` into every asset URL at build time, so instead we bake in a
// placeholder and let the server substitute the real prefix when it serves
// index.html (see src/web/staticSite.ts). The placeholder must look like a
// path so Vite accepts it and so nothing else in the build ever matches it.
export const BASE_PATH_PLACEHOLDER = "/__SCRIBEDOG_BASE_PATH__";

export default defineConfig({
  root: fileURLToPath(new URL("./web", import.meta.url)),
  base: `${BASE_PATH_PLACEHOLDER}/`,
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL("./dist/web", import.meta.url)),
    emptyOutDir: true
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:3000"
    }
  }
});
