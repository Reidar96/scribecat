import { readFile } from "node:fs/promises";
import path from "node:path";

import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";

/** Must match BASE_PATH_PLACEHOLDER in the root vite.config.ts. */
export const BASE_PATH_PLACEHOLDER = "/__SCRIBECAT_BASE_PATH__";

export type StaticSiteOptions = {
  /** Directory of the built web client (`npm run build:web` in the repo root, i.e. dist-web). */
  webDistDir: string;
  basePath: string;
};

/**
 * One image, any prefix: the web client is built once and learns its prefix
 * from a meta tag that carries a placeholder; this substitutes the real base
 * path when index.html is served. The substitution runs once at startup, not
 * per request, since the base path cannot change while the process runs.
 *
 * Only index.html needs it. The bundles reference each other and their
 * assets relatively (Vite `base: "./"`), so they work under any prefix as
 * they are, which is also why the page must be reached at `${basePath}/` with
 * the trailing slash (see the redirect below).
 */
export function renderIndexHtml(template: string, basePath: string): string {
  return template.split(BASE_PATH_PLACEHOLDER).join(basePath);
}

export async function staticSite(app: FastifyInstance, options: StaticSiteOptions): Promise<void> {
  const template = await readFile(path.join(options.webDistDir, "index.html"), "utf8");
  const indexHtml = renderIndexHtml(template, options.basePath);

  // Everything in the build directory except index.html, which must go
  // through the template step above. Hashed bundles under assets/ are
  // immutable; the handful of unhashed files next to index.html (favicon,
  // theme-boot.js) get revalidated on every load so an image update reaches
  // the browser.
  await app.register(fastifyStatic, {
    root: options.webDistDir,
    prefix: "/",
    index: false,
    decorateReply: false,
    cacheControl: false,
    allowedPath: (pathName) => pathName !== "/index.html",
    setHeaders: (response, filePath) => {
      const isHashedAsset = path.relative(options.webDistDir, filePath).split(path.sep)[0] === "assets";
      response.header("cache-control", isHashedAsset ? "public, max-age=31536000, immutable" : "no-cache");
    }
  });

  app.get("/", { prefixTrailingSlash: "slash" }, async (_request, reply) => {
    return reply.header("cache-control", "no-cache").type("text/html; charset=utf-8").send(indexHtml);
  });

  if (options.basePath) {
    // "/anna" without the slash: the relative asset URLs in index.html would
    // resolve against "/" instead of "/anna/", so send the browser to the
    // canonical address rather than serving a page that cannot load.
    app.get("/", { prefixTrailingSlash: "no-slash" }, async (_request, reply) => {
      return reply.redirect(`${options.basePath}/`, 308);
    });
  }
}
