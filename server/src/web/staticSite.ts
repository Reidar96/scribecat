import { readFile } from "node:fs/promises";
import path from "node:path";

import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";

/** Must match BASE_PATH_PLACEHOLDER in vite.config.ts. */
export const BASE_PATH_PLACEHOLDER = "/__SCRIBEDOG_BASE_PATH__";

export type StaticSiteOptions = {
  /** Directory of the built web client (vite's outDir). */
  webDistDir: string;
  basePath: string;
};

/**
 * One image, any prefix: the web client is built once with a placeholder
 * baked into its asset URLs, and this substitutes the real base path when
 * index.html is served. The substitution runs once at startup, not per
 * request, since the base path cannot change while the process runs.
 */
export function renderIndexHtml(template: string, basePath: string): string {
  return template.split(BASE_PATH_PLACEHOLDER).join(basePath);
}

export async function staticSite(app: FastifyInstance, options: StaticSiteOptions): Promise<void> {
  const template = await readFile(path.join(options.webDistDir, "index.html"), "utf8");
  const indexHtml = renderIndexHtml(template, options.basePath);

  // Hashed, immutable bundles only; index.html is deliberately not in here
  // because it must go through the template step above.
  await app.register(fastifyStatic, {
    root: path.join(options.webDistDir, "assets"),
    prefix: "/assets/",
    index: false,
    maxAge: "1y",
    immutable: true,
    decorateReply: false
  });

  app.get("/", async (_request, reply) => {
    return reply.header("cache-control", "no-cache").type("text/html; charset=utf-8").send(indexHtml);
  });
}
