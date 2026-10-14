import { readPluginMarkdown } from "./pluginFiles.js";
import { publicCss, publicFrame } from "./theme.js";
import { createHash } from "node:crypto";
import path from "node:path";
import type { FastifyPluginAsync } from "fastify";
import type { Vault } from "../vault/files.js";

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const imagePattern = /\.(?:png|jpe?g|webp|gif)$/i;
const mime: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".pdf": "application/pdf" };
const escape = (text: string) => text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
type Item = { path: string; slug: string; title: string; category: string; location: string; description: string; notes: string; fields: Record<string, string>; cover: string | null; token: string | null; receipt: string | null; receiptToken: string | null };
const facets: Record<string, string> = { kategori: "category", plassering: "location" };
const labels: Record<string, string> = { kategori: "Kategorier", plassering: "Plasseringer" };

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

const page = (title: string, content: string) => {
  const back = /class="back" href="([^"]+)"/.exec(content)?.[1];
  const home = back?.endsWith("/inventar") ? back : back ? "../../../inventar" : "inventar";
  const clean = content.replace(/<nav>[\s\S]*?<\/nav>/, "");
  return `<!doctype html><html lang="no"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · Inventar</title><style>${publicCss}</style></head><body>${publicFrame("Inventar", clean, home, [["Statistikk", `${home}/statistikk`], ["Kategorier", `${home}/oversikt/kategori`], ["Plasseringer", `${home}/oversikt/plassering`]] as Array<[string, string]>)}</body></html>`;
};

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
    for (const record of await readPluginMarkdown(vault, folder)) {
      try {
        const markdown = record.markdown;
        const fields = metadata(markdown);
        if (fields["scribecat-plugin"] !== "inventory" || fields.type !== "item" || fields.published !== "true" || !slugPattern.test(fields.slug ?? "")) continue;
        counts.set(fields.slug, (counts.get(fields.slug) ?? 0) + 1);
        const description = /^## Beskrivelse\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m.exec(markdown)?.[1].trim() ?? "";
        const notes = /^## Notater\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m.exec(markdown)?.[1].trim() ?? "";
        const base = path.posix.dirname(record.relativePath);
        let cover: string | null = null;
        if (fields.cover && !fields.cover.startsWith("/") && !fields.cover.includes("\\") && !fields.cover.includes("?") && !fields.cover.includes("#")) {
          const candidate = path.posix.normalize(path.posix.join(base, fields.cover));
          if (candidate.startsWith(`${base}/`) && imagePattern.test(candidate)) cover = candidate;
        }
        let receipt: string | null = null;
        if (fields.receipt && !fields.receipt.startsWith("/") && !fields.receipt.includes("\\") && !fields.receipt.includes("?") && !fields.receipt.includes("#")) {
          const candidate = path.posix.normalize(path.posix.join(base, fields.receipt));
          if (candidate.startsWith(`${base}/_attachments/`) && mime[path.posix.extname(candidate).toLowerCase()]) receipt = candidate;
        }
        result.push({ path: record.relativePath, slug: fields.slug, title: fields.name || fields.slug,
          category: fields.category || "", location: fields.location || "", description, notes, fields, cover, receipt,
          token: cover ? createHash("sha256").update(`${record.relativePath}\0${cover}`).digest("hex").slice(0, 32) : null,
          receiptToken: receipt ? createHash("sha256").update(`${record.relativePath}\0${receipt}`).digest("hex").slice(0, 32) : null });
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
    return reply.type("text/html; charset=utf-8").send(page("Inventar", `<h1>Inventar</h1><nav><a href="inventar/statistikk">Statistikk</a> · <a href="inventar/oversikt/kategori">Kategorier</a> · <a href="inventar/oversikt/plassering">Plasseringer</a></nav><form class="filters" method="get"><input type="search" name="q" value="${escape(query)}" placeholder="Søk i inventar" aria-label="Søk"><select name="category"><option value="">Alle kategorier</option>${categories.map((category) => `<option value="${escape(category)}" ${category === selectedCategory ? "selected" : ""}>${escape(category)}</option>`).join("")}</select><button>Søk</button></form><div class="cards">${cards}</div>`));
  });
  app.get("/inventar/statistikk", async (_request, reply) => {
    const items = await published();
    const total = items.reduce((sum, item) => sum + (Number(item.fields["purchase-price"]?.replace(/[^\d,.-]/g, "").replace(",", ".")) || 0) * (Number(item.fields.quantity) || 1), 0);
    return reply.type("text/html; charset=utf-8").send(page("Statistikk", `<a class="back" href="../inventar">⌂ Inventar</a><h1>Statistikk</h1><div class="public-stats"><div><span>Gjenstander</span><strong>${items.length}</strong></div><div><span>Kategorier</span><strong>${new Set(items.map((item) => item.category).filter(Boolean)).size}</strong></div><div><span>Plasseringer</span><strong>${new Set(items.map((item) => item.location).filter(Boolean)).size}</strong></div><div><span>Samlet pris</span><strong>${escape(new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 2 }).format(total))} kr</strong></div></div>`));
  });
  app.get<{ Params: { field: string } }>("/inventar/oversikt/:field", async (request, reply) => {
    const field = facets[request.params.field]; if (!field) return reply.code(404).send();
    const values = [...new Set((await published()).map((item) => item[field as "category" | "location"]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "no"));
    return reply.type("text/html; charset=utf-8").send(page(labels[request.params.field], `<a class="back" href="../../inventar">⌂ Inventar</a><h1>${labels[request.params.field]}</h1><div class="cards">${values.map((value) => `<a class="card" href="${request.params.field}/${encodeURIComponent(value)}"><div>${escape(value)}</div></a>`).join("")}</div>`));
  });
  app.get<{ Params: { field: string; value: string } }>("/inventar/oversikt/:field/:value", async (request, reply) => {
    const field = facets[request.params.field]; if (!field) return reply.code(404).send();
    const items = (await published()).filter((item) => item[field as "category" | "location"] === request.params.value);
    if (!items.length) return reply.code(404).send();
    return reply.type("text/html; charset=utf-8").send(page(request.params.value, `<a class="back" href="../${request.params.field}">← ${labels[request.params.field]}</a><h1>${escape(request.params.value)}</h1><div class="cards">${items.map((item) => `<a class="card" href="../../${item.slug}">${item.token ? `<img src="../../${item.slug}/media/${item.token}" alt="">` : ""}<div>${escape(item.title)}</div></a>`).join("")}</div>`));
  });
  app.get<{ Params: { slug: string } }>("/inventar/:slug", async (request, reply) => {
    const item = slugPattern.test(request.params.slug) ? (await published()).find((entry) => entry.slug === request.params.slug) : null;
    if (!item) return reply.code(404).send();
    const fieldLabels: Record<string, string> = { category: "Kategori", location: "Plassering", quantity: "Antall", purchased: "Kjøpt", "purchase-price": "Pris", "warranty-until": "Garanti til", "serial-number": "Serienummer", favorite: "Favoritt" };
    const hidden = new Set(["scribecat-plugin", "type", "name", "slug", "cover", "receipt", "published"]);
    const details = Object.entries(item.fields).filter(([key, value]) => !hidden.has(key) && value)
      .map(([key, value]) => `<p><strong>${escape(fieldLabels[key] ?? key.replace(/-/g, " "))}:</strong> ${escape(value)}</p>`).join("");
    return reply.type("text/html; charset=utf-8").send(page(item.title, `<a class="back" href="../inventar">⌂ Inventar</a><article class="detail">${item.token ? `<img src="${item.slug}/media/${item.token}" alt="">` : ""}<div><h1>${escape(item.title)}</h1>${details}<h2>Beskrivelse</h2><p class="description">${escape(item.description)}</p>${item.notes ? `<h2>Notater</h2><p class="description">${escape(item.notes)}</p>` : ""}${item.receiptToken ? `<p><a href="${item.slug}/kvittering/${item.receiptToken}">Se kvittering</a></p>` : ""}</div></article>`));
  });
  app.get<{ Params: { slug: string; token: string } }>("/inventar/:slug/kvittering/:token", async (request, reply) => {
    const item = slugPattern.test(request.params.slug) ? (await published()).find((entry) => entry.slug === request.params.slug) : null;
    if (!item?.receipt || item.receiptToken !== request.params.token) return reply.code(404).send();
    try {
      const info = await vault.stat(item.receipt);
      if (!info.isFile || info.isSymlink || info.size > 12 * 1024 * 1024) return reply.code(404).send();
      return reply.header("Content-Disposition", "inline").type(mime[path.posix.extname(item.receipt).toLowerCase()]).send(await vault.readBytes(item.receipt));
    } catch { return reply.code(404).send(); }
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
