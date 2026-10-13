import { createHash } from "node:crypto";
import path from "node:path";
import type { FastifyPluginAsync } from "fastify";

import type { Vault } from "../vault/files.js";

type Recipe = { path: string; slug: string; title: string; servings: string; body: string; images: Map<string, string>; coverToken: string | null };
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IMAGE = /\.(?:png|jpe?g|webp|gif)$/i;
const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };

function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

function publicText(input: string): string {
  // Never reveal private Markdown targets, including wikilinks and image paths.
  return escapeHtml(input.replace(/!?\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]|]*\|)?([^\]]+)\]\]/g, "$2"));
}

function frontmatter(markdown: string): { fields: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
  if (!match) return { fields: {}, body: markdown };
  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const found = /^([a-z][a-z0-9-]*):\s*(.*?)\s*$/i.exec(line);
    if (found) fields[found[1].toLowerCase()] = found[2].replace(/^['"]|['"]$/g, "");
  }
  return { fields, body: markdown.slice(match[0].length) };
}

function safeFolder(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.includes("\\") || value.startsWith("/")) return null;
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment === ".scribecat")) return null;
  return segments.join("/");
}

function referencedImages(markdown: string, documentPath: string): Map<string, string> {
  const images = new Map<string, string>();
  const base = path.posix.dirname(documentPath);
  const references = [...markdown.matchAll(/!\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)].map((match) => match[1]);
  const cover = frontmatter(markdown).fields.cover;
  if (cover) references.push(cover);
  for (const reference of references) {
    let decoded: string;
    try { decoded = decodeURIComponent(reference); } catch { continue; }
    if (decoded.startsWith("/") || decoded.includes("\\") || decoded.includes("?") || decoded.includes("#")) continue;
    const imagePath = path.posix.normalize(path.posix.join(base, decoded));
    if (!imagePath.startsWith(`${base}/`) || !IMAGE.test(imagePath)) continue;
    const token = createHash("sha256").update(`${documentPath}\0${imagePath}`).digest("hex").slice(0, 32);
    images.set(token, imagePath);
  }
  return images;
}

function renderBody(recipe: Recipe): string {
  const paragraphs: string[] = [];
  const lines = recipe.body.split(/\r?\n/);
  let checklist = false;
  for (const line of lines) {
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      if (heading[1].length === 1 && heading[2].trim() === recipe.title) continue;
      paragraphs.push(`<h${heading[1].length}>${publicText(heading[2])}</h${heading[1].length}>`);
      checklist = /^Ingredienser$|^Fremgangsmåte$/i.test(heading[2].trim());
      continue;
    }
    const image = /^!\[([^\]]*)\]\(([^\s)]+)\)/.exec(line);
    if (image) {
      let target = "";
      try { target = decodeURIComponent(image[2]); } catch { /* malformed source remains text */ }
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(recipe.path), target));
      const token = [...recipe.images].find(([, value]) => value === resolved)?.[0];
      if (token) paragraphs.push(`<img loading="lazy" src="${encodeURIComponent(recipe.slug)}/media/${token}" alt="${escapeHtml(image[1])}">`);
      continue;
    }
    const item = /^(?:[-*] |\d+\. )(.*)$/.exec(line);
    if (item) paragraphs.push(checklist ? `<label class="item"><input type="checkbox"> ${publicText(item[1])}</label>` : `<p class="item">• ${publicText(item[1])}</p>`);
    else if (line.trim()) paragraphs.push(`<p>${publicText(line)}</p>`);
  }
  return paragraphs.join("\n");
}

function page(title: string, body: string, indexHref: string): string {
  return `<!doctype html><html lang="no"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · Oppskrifter</title><style>body{font:1rem/1.65 system-ui,sans-serif;max-width:60rem;margin:auto;padding:2rem 1rem;color:#242424;background:#faf9f6}a{color:#245d42;text-decoration:none}main{background:white;border:1px solid #e4e2de;border-radius:1rem;padding:clamp(1rem,4vw,3rem)}img{display:block;max-width:100%;height:auto;border-radius:.6rem}h1,h2,h3{line-height:1.25}.item{display:block;padding:.3rem 0}.item input{accent-color:#245d42}nav{margin-bottom:1rem}.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(12rem,1fr));gap:1rem;list-style:none;padding:0}.cards a{display:block;border:1px solid #e4e2de;border-radius:.7rem;padding:.65rem}.cards img{width:100%;aspect-ratio:4/3;object-fit:cover;margin-bottom:.5rem}</style></head><body><nav><a href="${indexHref}">⌂ Oppskrifter</a></nav><main>${body}</main></body></html>`;
}

export const publicRecipeRoutes: FastifyPluginAsync<{ vault: Vault; routeBase?: string }> = async (app, { vault, routeBase = "/recipes" }) => {
  async function publishedRecipes(): Promise<Recipe[]> {
    let folder: string | null = null;
    try {
      const settings = JSON.parse(await vault.readText(".scribecat/plugins.json")) as { plugins?: { recipes?: { enabled?: boolean; publicView?: boolean; folder?: string } } };
      const preference = settings.plugins?.recipes;
      if (preference?.enabled !== true || preference.publicView !== true) return [];
      folder = safeFolder(preference.folder ?? "Oppskrifter");
    } catch { return []; }
    if (!folder) return [];
    const records = await vault.listMarkdownFiles();
    const result: Recipe[] = [];
    const slugCounts = new Map<string, number>();
    for (const record of records) {
      if (!record.relativePath.startsWith(`${folder}/`)) continue;
      let markdown: string;
      try { markdown = await vault.readText(record.relativePath); } catch { continue; }
      const { fields, body } = frontmatter(markdown);
      if (fields["scribecat-plugin"] !== "recipes" || fields.type !== "recipe" || fields.published !== "true" || !SLUG.test(fields.slug ?? "")) continue;
      slugCounts.set(fields.slug, (slugCounts.get(fields.slug) ?? 0) + 1);
      const images = referencedImages(markdown, record.relativePath);
      const coverPath = fields.cover ? path.posix.normalize(path.posix.join(path.posix.dirname(record.relativePath), fields.cover)) : null;
      const coverToken = [...images].find(([, imagePath]) => imagePath === coverPath)?.[0] ?? null;
      result.push({ path: record.relativePath, slug: fields.slug, title: fields.title || fields.slug,
        servings: fields.servings ?? "", body, images, coverToken });
    }
    return result.filter((recipe) => slugCounts.get(recipe.slug) === 1);
  }

  app.addHook("onRequest", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  });

  app.get(routeBase, async (_request, reply) => {
    const recipes = await publishedRecipes();
    const items = recipes.map((recipe) => `<li><a href="${routeBase.slice(1)}/${encodeURIComponent(recipe.slug)}">${recipe.coverToken ? `<img src="${routeBase.slice(1)}/${encodeURIComponent(recipe.slug)}/media/${recipe.coverToken}" alt="">` : ""}<strong>${escapeHtml(recipe.title)}</strong></a></li>`).join("");
    return reply.type("text/html; charset=utf-8").send(page("Oppskrifter", `<h1>Oppskrifter</h1><ul class="cards">${items}</ul>`, routeBase.slice(1)));
  });
  app.get<{ Params: { slug: string } }>(`${routeBase}/:slug`, async (request, reply) => {
    if (!SLUG.test(request.params.slug)) return reply.code(404).send();
    const recipe = (await publishedRecipes()).find((entry) => entry.slug === request.params.slug);
    if (!recipe) return reply.code(404).send();
    return reply.type("text/html; charset=utf-8").send(page(recipe.title,
      `<h1>${escapeHtml(recipe.title)}</h1>${recipe.coverToken ? `<img src="${encodeURIComponent(recipe.slug)}/media/${recipe.coverToken}" alt="">` : ""}${recipe.servings ? `<p>${escapeHtml(recipe.servings)} porsjoner</p>` : ""}${renderBody(recipe)}`, `../${routeBase.slice(1)}`));
  });
  app.get<{ Params: { slug: string; token: string } }>(`${routeBase}/:slug/media/:token`, async (request, reply) => {
    if (!SLUG.test(request.params.slug) || !/^[a-f0-9]{32}$/.test(request.params.token)) return reply.code(404).send();
    const recipe = (await publishedRecipes()).find((entry) => entry.slug === request.params.slug);
    const imagePath = recipe?.images.get(request.params.token);
    if (!imagePath) return reply.code(404).send();
    try {
      const info = await vault.stat(imagePath);
      if (!info.isFile || info.isSymlink || info.size > 8 * 1024 * 1024) return reply.code(404).send();
      return reply.type(MIME[path.posix.extname(imagePath).toLowerCase()] ?? "application/octet-stream").send(await vault.readBytes(imagePath));
    } catch { return reply.code(404).send(); }
  });
};
