import { createHash } from "node:crypto";
import path from "node:path";
import type { FastifyPluginAsync } from "fastify";
import type { Vault } from "../vault/files.js";

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const imagePattern = /\.(?:png|jpe?g|webp|gif)$/i;
const mime: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
const escape = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
type Book = { path: string; slug: string; title: string; author: string; category: string; summary: string; cover: string | null; token: string | null };

function metadata(markdown: string): Record<string, string> {
  const head = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown)?.[1] ?? "";
  const fields: Record<string, string> = {};
  for (const line of head.split(/\r?\n/)) {
    const match = /^([a-z][\w-]*):\s*(.*)$/i.exec(line);
    if (!match) continue;
    const raw = match[2].trim();
    if (raw.startsWith('"') && raw.endsWith('"')) {
      try { fields[match[1].toLowerCase()] = String(JSON.parse(raw)); continue; }
      catch { /* fall through */ }
    }
    fields[match[1].toLowerCase()] = raw.replace(/^'|'$/g, "");
  }
  return fields;
}

function safeFolder(folder: string): boolean {
  return !!folder && !folder.startsWith("/") && !folder.includes("\\") && folder.split("/").every((part) => part && part !== "." && part !== ".." && part !== ".scribecat");
}

const page = (title: string, content: string) => `<!doctype html><html lang="no"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · Bøker</title><style>:root{color-scheme:light dark}*{box-sizing:border-box}body{font:1rem/1.6 system-ui,sans-serif;background:#f5f4f1;color:#262626;margin:0}main{max-width:70rem;margin:auto;padding:clamp(1rem,4vw,3rem)}a{color:inherit;text-decoration:none}.back{display:inline-block;margin-bottom:1.5rem;color:#395d4e}.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,13rem),1fr));gap:1rem}.card,.detail{background:#fff;border:1px solid #e3e1db;border-radius:1rem;overflow:hidden}.card img,.detail img{display:block;width:100%;aspect-ratio:3/4;object-fit:cover}.card div,.detail div{padding:1rem}.meta{color:#686864;font-size:.9rem}.filters{display:flex;gap:.6rem;flex-wrap:wrap;margin:1rem 0 1.5rem}input,select,button{font:inherit;padding:.65rem;border:1px solid #c9c7c1;border-radius:.5rem;max-width:100%}.filters input{flex:1;min-width:11rem}.detail{max-width:46rem}.summary{white-space:pre-line}@media(prefers-color-scheme:dark){body{background:#17191a;color:#f3f3f0}.card,.detail{background:#242729;border-color:#424649}.meta{color:#b8bab8}.back{color:#9bd1b4}input,select,button{background:#242729;color:#f3f3f0;border-color:#565a5c}}</style></head><body><main>${content}</main></body></html>`;

export const publicBookRoutes: FastifyPluginAsync<{ vault: Vault }> = async (app, { vault }) => {
  app.addHook("onRequest", async (_request, reply) => {
    reply.header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff").header("Referrer-Policy", "no-referrer")
      .header("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  });
  async function published(): Promise<Book[]> {
    let folder: string;
    try {
      const config = JSON.parse(await vault.readText(".scribecat/plugins.json")) as { plugins?: { books?: { enabled?: boolean; publicView?: boolean; folder?: string } } };
      const preference = config.plugins?.books;
      if (!preference?.enabled || !preference.publicView) return [];
      folder = preference.folder ?? "Bøker";
      if (!safeFolder(folder)) return [];
    } catch { return []; }
    const result: Book[] = [];
    const counts = new Map<string, number>();
    for (const record of await vault.listMarkdownFiles()) {
      if (!record.relativePath.startsWith(`${folder}/`)) continue;
      try {
        const markdown = await vault.readText(record.relativePath);
        const fields = metadata(markdown);
        if (fields["scribecat-plugin"] !== "books" || fields.type !== "book" || fields.published !== "true" || !slugPattern.test(fields.slug ?? "")) continue;
        counts.set(fields.slug, (counts.get(fields.slug) ?? 0) + 1);
        const summary = /^## Oppsummering\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m.exec(markdown)?.[1].trim() ?? "";
        const base = path.posix.dirname(record.relativePath);
        let cover: string | null = null;
        if (fields.cover && !fields.cover.startsWith("/") && !fields.cover.includes("\\") && !fields.cover.includes("?") && !fields.cover.includes("#")) {
          const candidate = path.posix.normalize(path.posix.join(base, fields.cover));
          if (candidate.startsWith(`${base}/`) && imagePattern.test(candidate)) cover = candidate;
        }
        result.push({ path: record.relativePath, slug: fields.slug, title: fields.title || fields.slug, author: fields.author || "", category: fields.category || "", summary, cover,
          token: cover ? createHash("sha256").update(`${record.relativePath}\0${cover}`).digest("hex").slice(0, 32) : null });
      } catch { /* A file may disappear during the scan. */ }
    }
    return result.filter((book) => counts.get(book.slug) === 1);
  }
  app.get<{ Querystring: { q?: string; category?: string } }>("/boker", async (request, reply) => {
    const books = await published();
    const q = typeof request.query.q === "string" ? request.query.q.trim().slice(0, 100).toLocaleLowerCase("no") : "";
    const category = typeof request.query.category === "string" ? request.query.category.slice(0, 100) : "";
    const categories = [...new Set(books.map((book) => book.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "no"));
    const cards = books.filter((book) => (!category || book.category === category) && (!q || `${book.title} ${book.author} ${book.category}`.toLocaleLowerCase("no").includes(q)))
      .map((book) => `<a class="card" href="boker/${book.slug}">${book.token ? `<img loading="lazy" src="boker/${book.slug}/media/${book.token}" alt="">` : ""}<div><strong>${escape(book.title)}</strong><p class="meta">${escape([book.author, book.category].filter(Boolean).join(" · "))}</p></div></a>`).join("");
    return reply.type("text/html; charset=utf-8").send(page("Bøker", `<h1>Bøker</h1><form class="filters" method="get"><input name="q" type="search" aria-label="Søk" placeholder="Søk i bøker" value="${escape(q)}"><select name="category"><option value="">Alle kategorier</option>${categories.map((item) => `<option value="${escape(item)}" ${item === category ? "selected" : ""}>${escape(item)}</option>`).join("")}</select><button>Søk</button></form><div class="cards">${cards}</div>`));
  });
  app.get<{ Params: { slug: string } }>("/boker/:slug", async (request, reply) => {
    const book = slugPattern.test(request.params.slug) ? (await published()).find((entry) => entry.slug === request.params.slug) : null;
    if (!book) return reply.code(404).send();
    return reply.type("text/html; charset=utf-8").send(page(book.title, `<a class="back" href="../boker">⌂ Bøker</a><article class="detail">${book.token ? `<img src="${book.slug}/media/${book.token}" alt="">` : ""}<div><h1>${escape(book.title)}</h1><p class="meta">${escape([book.author, book.category].filter(Boolean).join(" · "))}</p><p class="summary">${escape(book.summary)}</p></div></article>`));
  });
  app.get<{ Params: { slug: string; token: string } }>("/boker/:slug/media/:token", async (request, reply) => {
    const book = slugPattern.test(request.params.slug) ? (await published()).find((entry) => entry.slug === request.params.slug) : null;
    if (!book?.cover || book.token !== request.params.token) return reply.code(404).send();
    try {
      const info = await vault.stat(book.cover);
      if (!info.isFile || info.isSymlink || info.size > 8 * 1024 * 1024) return reply.code(404).send();
      return reply.type(mime[path.posix.extname(book.cover).toLowerCase()] ?? "application/octet-stream").send(await vault.readBytes(book.cover));
    } catch { return reply.code(404).send(); }
  });
};
