import { createHash } from "node:crypto";
import path from "node:path";
import type { FastifyPluginAsync } from "fastify";
import type { Vault } from "../vault/files.js";

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const imagePattern = /\.(?:png|jpe?g|webp|gif)$/i;
const mime: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
const escape = (text: string) => text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
type Item = { path: string; slug: string; title: string; category: string; location: string; description: string; cover: string | null; token: string | null };

function metadata(markdown: string): Record<string, string> {
  const head = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown)?.[1] ?? "";
  const fields: Record<string, string> = {};
  for (const line of head.split(/\r?\n/)) {
    const match = /^([a-z][\w-]*):\s*(.*)$/i.exec(line);
    if (!match) continue;
    const value = match[2].trim();
    try { fields[match[1]] = value.startsWith('"') ? JSON.parse(value) : value.replace(/^'|'$/g, ""); }
    catch { fields[match[1]] = value; }
  }
  return fields;
}

function safeFolder(folder: string): boolean {
  return !!folder && !folder.startsWith("/") && !folder.includes("\\") && folder.split("/").every((part) => part && part !== "." && part !== ".." && part !== ".scribecat");
}

const page = (title: string, content: string) => `<!doctype html><html lang="no"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · Inventar</title><style>:root{color-scheme:light dark}body{font:1rem/1.55 system-ui,sans-serif;background:#f5f4f1;color:#262626;margin:0}main{max-width:68rem;margin:auto;padding:clamp(1rem,4vw,3rem)}a{color:inherit;text-decoration:none}.back{display:inline-block;margin-bottom:1.5rem;color:#395d4e}.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,14rem),1fr));gap:1rem}.card,.detail{background:#fff;border:1px solid #e3e1db;border-radius:1rem;overflow:hidden}.card img,.detail img{width:100%;aspect-ratio:4/3;object-fit:cover}.card div,.detail div{padding:1rem}.meta{color:#686864;font-size:.9rem}input,select{font:inherit;padding:.65rem;border:1px solid #c9c7c1;border-radius:.5rem;max-width:100%}.filters{display:flex;gap:.6rem;flex-wrap:wrap;margin:1rem 0 1.5rem}.detail{max-width:44rem}.description{white-space:pre-line}@media(prefers-color-scheme:dark){body{background:#17191a;color:#f3f3f0}.card,.detail{background:#242729;border-color:#424649}.meta{color:#b8bab8}.back{color:#9bd1b4}input,select{background:#242729;color:#f3f3f0;border-color:#565a5c}}</style></head><body><main>${content}</main></body></html>`;

export const publicInventoryRoutes: FastifyPluginAsync<{ vault: Vault }> = async (app, { vault }) => {
  app.addHook("onRequest", async (_request, reply) => {
    reply.header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff").header("Referrer-Policy", "no-referrer")
      .header("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
  });
  async function published(): Promise<Item[]> {
    let folder: string;
    try {
      const config = JSON.parse(await vault.readText(".scribecat/plugins.json")) as { plugins?: { inventory?: { enabled?: boolean; publicView?: boolean; folder?: string } } };
      const preference = config.plugins?.inventory;
      if (!preference?.enabled || !preference.publicView) return [];
      folder = preference.folder ?? "Inventar";
      if (!safeFolder(folder)) return [];
    } catch { return []; }
    const result: Item[] = [];
    const counts = new Map<string, number>();
    for (const record of await vault.listMarkdownFiles()) {
      if (!record.relativePath.startsWith(`${folder}/`)) continue;
      try {
        const markdown = await vault.readText(record.relativePath);
        const fields = metadata(markdown);
        if (fields["scribecat-plugin"] !== "inventory" || fields.type !== "item" || fields.published !== "true" || !slugPattern.test(fields.slug ?? "")) continue;
        counts.set(fields.slug, (counts.get(fields.slug) ?? 0) + 1);
        const description = /^## Beskrivelse\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m.exec(markdown)?.[1].trim() ?? "";
        const base = path.posix.dirname(record.relativePath);
        let cover: string | null = null;
        if (fields.cover && !fields.cover.startsWith("/") && !fields.cover.includes("\\") && !fields.cover.includes("?") && !fields.cover.includes("#")) {
          const candidate = path.posix.normalize(path.posix.join(base, fields.cover));
          if (candidate.startsWith(`${base}/`) && imagePattern.test(candidate)) cover = candidate;
        }
        result.push({ path: record.relativePath, slug: fields.slug, title: fields.name || fields.slug,
          category: fields.category || "", location: fields.location || "", description, cover,
          token: cover ? createHash("sha256").update(`${record.relativePath}\0${cover}`).digest("hex").slice(0, 32) : null });
      } catch { /* skip entries removed while listing */ }
    }
    return result.filter((item) => counts.get(item.slug) === 1);
  }
  app.get<{ Querystring: { q?: string; category?: string } }>("/inventar", async (request, reply) => {
    const items = await published();
    const query = typeof request.query.q === "string" ? request.query.q.trim().slice(0, 100).toLocaleLowerCase("no") : "";
    const selectedCategory = typeof request.query.category === "string" ? request.query.category.slice(0, 100) : "";
    const categories = [...new Set(items.map((item) => item.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "no"));
    const cards = items.filter((item) => (!selectedCategory || item.category === selectedCategory) &&
      (!query || `${item.title} ${item.category} ${item.description}`.toLocaleLowerCase("no").includes(query)))
      .map((item) => `<a class="card" href="inventar/${item.slug}" data-category="${escape(item.category)}">${item.token ? `<img loading="lazy" src="inventar/${item.slug}/media/${item.token}" alt="">` : ""}<div><strong>${escape(item.title)}</strong><p class="meta">${escape([item.category, item.location].filter(Boolean).join(" · "))}</p></div></a>`).join("");
    // A native GET form keeps search usable with the restrictive CSP.
    return reply.type("text/html; charset=utf-8").send(page("Inventar", `<h1>Inventar</h1><form class="filters" method="get"><input type="search" name="q" value="${escape(query)}" placeholder="Søk i inventar" aria-label="Søk"><select name="category"><option value="">Alle kategorier</option>${categories.map((category) => `<option value="${escape(category)}" ${category === selectedCategory ? "selected" : ""}>${escape(category)}</option>`).join("")}</select><button>Søk</button></form><div class="cards">${cards}</div>`));
  });
  app.get<{ Params: { slug: string } }>("/inventar/:slug", async (request, reply) => {
    const item = slugPattern.test(request.params.slug) ? (await published()).find((entry) => entry.slug === request.params.slug) : null;
    if (!item) return reply.code(404).send();
    return reply.type("text/html; charset=utf-8").send(page(item.title, `<a class="back" href="../inventar">⌂ Inventar</a><article class="detail">${item.token ? `<img src="${item.slug}/media/${item.token}" alt="">` : ""}<div><h1>${escape(item.title)}</h1><p class="meta">${escape([item.category, item.location].filter(Boolean).join(" · "))}</p><p class="description">${escape(item.description)}</p></div></article>`));
  });
  app.get<{ Params: { slug: string; token: string } }>("/inventar/:slug/media/:token", async (request, reply) => {
    const item = slugPattern.test(request.params.slug) ? (await published()).find((entry) => entry.slug === request.params.slug) : null;
    if (!item?.cover || item.token !== request.params.token) return reply.code(404).send();
    try {
      const info = await vault.stat(item.cover);
      if (!info.isFile || info.isSymlink || info.size > 8 * 1024 * 1024) return reply.code(404).send();
      return reply.type(mime[path.posix.extname(item.cover).toLowerCase()] ?? "application/octet-stream").send(await vault.readBytes(item.cover));
    } catch { return reply.code(404).send(); }
  });
};
