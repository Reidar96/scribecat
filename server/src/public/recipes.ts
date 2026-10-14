import { readPluginMarkdown } from "./pluginFiles.js";
import { publicCss, publicFrame } from "./theme.js";
import { createHash } from "node:crypto";
import path from "node:path";
import type { FastifyPluginAsync } from "fastify";

import type { Vault } from "../vault/files.js";

type Recipe = { path: string; slug: string; title: string; category: string; description: string; servings: string; body: string; images: Map<string, string>; coverToken: string | null };
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
  const sections: string[] = [];
  let paragraphs: string[] = [];
  const lines = recipe.body.split(/\r?\n/);
  let checklist = false;
  let skipDescription = false;
  for (const line of lines) {
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      if (heading[1].length === 1 && heading[2].trim() === recipe.title) continue;
      if (heading[2].trim() === "Beskrivelse") { if (paragraphs.length) sections.push(`<section>${paragraphs.join("\n")}</section>`); paragraphs = []; checklist = false; skipDescription = true; continue; }
      skipDescription = false;
      if (paragraphs.length) sections.push(`<section>${paragraphs.join("\n")}</section>`);
      paragraphs = [`<h${heading[1].length}>${publicText(heading[2])}</h${heading[1].length}>`];
      checklist = /^Ingredienser$|^Fremgangsmåte$/i.test(heading[2].trim());
      continue;
    }
    if (skipDescription) continue;
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
    if (item) {
      const ingredient = /^(\d+(?:[.,]\d+)?|\d+\/\d+)\s+(\S+)\s+(.+)$/i.exec(item[1]);
      const value = ingredient ? `<span class="amount" data-base="${escapeHtml(ingredient[1])}">${escapeHtml(ingredient[1])}</span> ${publicText(ingredient[2])} ${publicText(ingredient[3])}` : publicText(item[1]);
      paragraphs.push(checklist ? `<label class="item"><input type="checkbox"> <span>${value}</span></label>` : `<p class="item">• ${value}</p>`);
    }
    else if (line.trim()) paragraphs.push(`<p>${publicText(line)}</p>`);
  }
  if (paragraphs.length) sections.push(`<section>${paragraphs.join("\n")}</section>`);
  return sections.join("\n");
}

function page(title: string, body: string, indexHref: string): string {
  const clean = body.replace(/<p><a href="[^"]+\/statistikk">Statistikk<\/a> · <a href="[^"]+\/kategorier">Kategorier<\/a><\/p>/, "");
  return `<!doctype html><html lang="no"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · Oppskrifter</title><style>${publicCss}</style></head><body>${publicFrame("Oppskrifter", clean, indexHref, [["Statistikk", `${indexHref}/statistikk`], ["Kategorier", `${indexHref}/kategorier`]])}</body></html>`;
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
    const records = await readPluginMarkdown(vault, folder);
    const result: Recipe[] = [];
    const slugCounts = new Map<string, number>();
    for (const record of records) {
      const markdown = record.markdown;
      const { fields, body } = frontmatter(markdown);
      if (fields["scribecat-plugin"] !== "recipes" || fields.type !== "recipe" || fields.published !== "true" || !SLUG.test(fields.slug ?? "")) continue;
      slugCounts.set(fields.slug, (slugCounts.get(fields.slug) ?? 0) + 1);
      const images = referencedImages(markdown, record.relativePath);
      const coverPath = fields.cover ? path.posix.normalize(path.posix.join(path.posix.dirname(record.relativePath), fields.cover)) : null;
      const coverToken = [...images].find(([, imagePath]) => imagePath === coverPath)?.[0] ?? null;
      const description = /^## Beskrivelse\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m.exec(body)?.[1].trim() ?? "";
      result.push({ path: record.relativePath, slug: fields.slug, title: fields.title || fields.slug,
        category: fields.category ?? "", description, servings: fields.servings ?? "", body, images, coverToken });
    }
    return result.filter((recipe) => slugCounts.get(recipe.slug) === 1);
  }

  app.addHook("onRequest", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Content-Security-Policy", "default-src 'none'; img-src 'self'; script-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  });

  app.get(`${routeBase}/app.js`, async (_request, reply) => reply.type("application/javascript; charset=utf-8").send(
    "document.addEventListener('input',event=>{if(event.target.id!=='servings')return;const field=event.target;const base=Number(field.dataset.base),current=Number(field.value);if(!(base>0&&current>0))return;document.querySelectorAll('.amount[data-base]').forEach(node=>{const raw=node.dataset.base;const parts=raw.split('/');const amount=parts.length===2?Number(parts[0])/Number(parts[1]):Number(raw.replace(',','.'));if(Number.isFinite(amount))node.textContent=String(Math.round(amount*current/base*100)/100).replace('.',',')})})"
  ));

  app.get<{ Querystring: { q?: string; category?: string } }>(routeBase, async (request, reply) => {
    const recipes = await publishedRecipes();
    const query = typeof request.query.q === "string" ? request.query.q.trim().slice(0, 100).toLocaleLowerCase("no") : "";
    const category = typeof request.query.category === "string" ? request.query.category.slice(0, 100) : "";
    const categories = [...new Set(recipes.map((recipe) => recipe.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "no"));
    const items = recipes.filter((recipe) => (!category || recipe.category === category) &&
      (!query || `${recipe.title} ${recipe.category} ${recipe.description}`.toLocaleLowerCase("no").includes(query)))
      .map((recipe) => `<li><a href="${routeBase.slice(1)}/${encodeURIComponent(recipe.slug)}">${recipe.coverToken ? `<img src="${routeBase.slice(1)}/${encodeURIComponent(recipe.slug)}/media/${recipe.coverToken}" alt="">` : ""}<div class="tile"><strong>${escapeHtml(recipe.title)}</strong><span class="muted">${escapeHtml(recipe.category)}${recipe.servings ? ` · ${escapeHtml(recipe.servings)} porsjoner` : ""}</span><p>${publicText(recipe.description.slice(0, 160))}</p></div></a></li>`).join("");
    const filters = `<form class="filters" method="get"><input type="search" name="q" value="${escapeHtml(query)}" placeholder="Søk etter oppskrift" aria-label="Søk etter oppskrift"><select name="category" aria-label="Kategori"><option value="">Alle kategorier</option>${categories.map((item) => `<option value="${escapeHtml(item)}" ${item === category ? "selected" : ""}>${escapeHtml(item)}</option>`).join("")}</select><button type="submit">Søk</button></form>`;
    return reply.type("text/html; charset=utf-8").send(page("Oppskrifter", `<h1>Oppskrifter</h1><p class="intro">Finn noe godt å lage.</p><p><a href="${routeBase.slice(1)}/statistikk">Statistikk</a> · <a href="${routeBase.slice(1)}/kategorier">Kategorier</a></p>${filters}<ul class="cards">${items}</ul>`, routeBase.slice(1)));
  });
  app.get(`${routeBase}/statistikk`, async (_request, reply) => {
    const recipes = await publishedRecipes();
    return reply.type("text/html; charset=utf-8").send(page("Statistikk", `<h1>Statistikk</h1><div class="public-stats"><div><span>Oppskrifter</span><strong>${recipes.length}</strong></div><div><span>Kategorier</span><strong>${new Set(recipes.map((recipe) => recipe.category).filter(Boolean)).size}</strong></div></div>`, `../${routeBase.slice(1)}`));
  });
  app.get(`${routeBase}/kategorier`, async (_request, reply) => {
    const categories = [...new Set((await publishedRecipes()).map((recipe) => recipe.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "no"));
    return reply.type("text/html; charset=utf-8").send(page("Kategorier", `<h1>Kategorier</h1><ul class="cards">${categories.map((category) => `<li><a href="kategorier/${encodeURIComponent(category)}"><div class="tile"><strong>${escapeHtml(category)}</strong></div></a></li>`).join("")}</ul>`, `../${routeBase.slice(1)}`));
  });
  app.get<{ Params: { category: string } }>(`${routeBase}/kategorier/:category`, async (request, reply) => {
    const recipes = (await publishedRecipes()).filter((recipe) => recipe.category === request.params.category);
    if (!recipes.length) return reply.code(404).send();
    return reply.type("text/html; charset=utf-8").send(page(request.params.category, `<h1>${escapeHtml(request.params.category)}</h1><ul class="cards">${recipes.map((recipe) => `<li><a href="../${recipe.slug}">${recipe.coverToken ? `<img src="../${recipe.slug}/media/${recipe.coverToken}" alt="">` : ""}<div class="tile"><strong>${escapeHtml(recipe.title)}</strong></div></a></li>`).join("")}</ul>`, `../../${routeBase.slice(1)}`));
  });
  app.get<{ Params: { slug: string } }>(`${routeBase}/:slug`, async (request, reply) => {
    if (!SLUG.test(request.params.slug)) return reply.code(404).send();
    const recipe = (await publishedRecipes()).find((entry) => entry.slug === request.params.slug);
    if (!recipe) return reply.code(404).send();
    return reply.type("text/html; charset=utf-8").send(page(recipe.title,
      `<a class="back" href="../${routeBase.slice(1)}">← Tilbake</a><article class="public-detail"><header class="public-hero">${recipe.coverToken ? `<img src="${encodeURIComponent(recipe.slug)}/media/${recipe.coverToken}" alt="">` : ""}<div><h1>${escapeHtml(recipe.title)}</h1><dl class="public-facts">${recipe.category ? `<div><dt>Kategori</dt><dd>${escapeHtml(recipe.category)}</dd></div>` : ""}</dl></div></header>${recipe.description ? `<section class="public-section"><h2>Beskrivelse</h2><div class="description">${publicText(recipe.description)}</div></section>` : ""}${Number(recipe.servings) > 0 ? `<section class="public-section"><label class="servings">Porsjoner <input id="servings" type="number" min="1" max="100" data-base="${escapeHtml(recipe.servings)}" value="${escapeHtml(recipe.servings)}"></label></section>` : ""}<div class="recipe-body">${renderBody(recipe)}</div></article><script defer src="../${routeBase.slice(1)}/app.js"></script>`, `../${routeBase.slice(1)}`));
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
