import { readPluginMarkdown } from "./pluginFiles.js";
import { publicCss, publicFrame } from "./theme.js";
import { createHash } from "node:crypto";
import path from "node:path";
import type { FastifyPluginAsync } from "fastify";
import type { Vault } from "../vault/files.js";

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const imagePattern = /\.(?:png|jpe?g|webp|gif)$/i;
const mime: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
const escape = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
type Book = { path: string; slug: string; title: string; author: string; category: string; series: string; collection: string; status: string; finished: string; summary: string; cover: string | null; token: string | null };
const facets: Record<string, string> = { kategori: "category", forfatter: "author", serie: "series", samling: "collection" };
const facetLabels: Record<string, string> = { kategori: "Kategorier", forfatter: "Forfattere", serie: "Serier", samling: "Samlinger" };

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

const page = (title: string, content: string) => {
  const back = /class="back" href="([^"]+)"/.exec(content)?.[1];
  const home = back?.endsWith("/boker") ? back : back ? "../../../boker" : "boker";
  const clean = content.replace(/<nav>[\s\S]*?<\/nav>/, "");
  return `<!doctype html><html lang="no"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · Bøker</title><style>${publicCss}</style></head><body>${publicFrame("Bøker", clean, home, [["Statistikk", `${home}/statistikk`], ["Kategorier", `${home}/oversikt/kategori`], ["Forfattere", `${home}/oversikt/forfatter`], ["Serier", `${home}/oversikt/serie`], ["Samlinger", `${home}/oversikt/samling`]] as Array<[string, string]>)}</body></html>`;
};

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
    for (const record of await readPluginMarkdown(vault, folder)) {
      try {
        const markdown = record.markdown;
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
        result.push({ path: record.relativePath, slug: fields.slug, title: fields.title || fields.slug, author: fields.author || "", category: fields.category || "", series: fields.series || "", collection: fields.collection || "", status: fields.status || "", finished: fields.finished || "", summary, cover,
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
    return reply.type("text/html; charset=utf-8").send(page("Bøker", `<h1>Bøker</h1><nav><a href="boker/statistikk">Statistikk</a> · ${Object.keys(facets).map((key) => `<a href="boker/oversikt/${key}">${facetLabels[key]}</a>`).join(" · ")}</nav><form class="filters" method="get"><input name="q" type="search" aria-label="Søk" placeholder="Søk i bøker" value="${escape(q)}"><select name="category"><option value="">Alle kategorier</option>${categories.map((item) => `<option value="${escape(item)}" ${item === category ? "selected" : ""}>${escape(item)}</option>`).join("")}</select><button>Søk</button></form><div class="cards">${cards}</div>`));
  });
  app.get("/boker/statistikk", async (_request, reply) => {
    const books = await published();
    const months = books.filter((book) => book.status === "finished" && /^\d{4}-\d{2}/.test(book.finished)).reduce<Record<string, number>>((acc, book) => { const month = book.finished.slice(0, 7); acc[month] = (acc[month] ?? 0) + 1; return acc; }, {});
    return reply.type("text/html; charset=utf-8").send(page("Statistikk", `<a class="back" href="../boker">⌂ Bøker</a><h1>Statistikk</h1><div class="public-stats"><div><span>Bøker</span><strong>${books.length}</strong></div><div><span>Lest</span><strong>${books.filter((book) => book.status === "finished").length}</strong></div><div><span>Forfattere</span><strong>${new Set(books.map((book) => book.author).filter(Boolean)).size}</strong></div></div><h2>Fullført per måned</h2>${Object.entries(months).sort(([a], [b]) => b.localeCompare(a)).map(([month, count]) => `<p>${escape(month)}: ${count}</p>`).join("") || "<p>Ingen registrerte datoer.</p>"}`));
  });
  app.get<{ Params: { field: string } }>("/boker/oversikt/:field", async (request, reply) => {
    const key = facets[request.params.field]; if (!key) return reply.code(404).send();
    const values = [...new Set((await published()).map((book) => book[key as "category" | "author" | "series" | "collection"]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "no"));
    return reply.type("text/html; charset=utf-8").send(page(facetLabels[request.params.field], `<a class="back" href="../../boker">⌂ Bøker</a><h1>${facetLabels[request.params.field]}</h1><div class="cards">${values.map((value) => `<a class="card" href="${request.params.field}/${encodeURIComponent(value)}"><div>${escape(value)}</div></a>`).join("")}</div>`));
  });
  app.get<{ Params: { field: string; value: string } }>("/boker/oversikt/:field/:value", async (request, reply) => {
    const key = facets[request.params.field]; if (!key) return reply.code(404).send();
    const books = (await published()).filter((book) => book[key as "category" | "author" | "series" | "collection"] === request.params.value);
    if (!books.length) return reply.code(404).send();
    return reply.type("text/html; charset=utf-8").send(page(request.params.value, `<a class="back" href="../${request.params.field}">← ${facetLabels[request.params.field]}</a><h1>${escape(request.params.value)}</h1><div class="cards">${books.map((book) => `<a class="card" href="../../${book.slug}">${book.token ? `<img src="../../${book.slug}/media/${book.token}" alt="">` : ""}<div>${escape(book.title)}</div></a>`).join("")}</div>`));
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
