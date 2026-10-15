import { readPluginMarkdown } from "./pluginFiles.js";
import { registerPublicWebApp } from "./webApp.js";
import { publicCss, publicFrame } from "./theme.js";
import type { FastifyPluginAsync } from "fastify";
import type { Vault } from "../vault/files.js";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&#39;" })[char]!);
type List = { path: string; slug: string; title: string; markdown: string };

function fields(markdown: string): Record<string, string> {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown)?.[1] ?? "";
  return Object.fromEntries(frontmatter.split(/\r?\n/).map((line) => /^([a-z][\w-]*):\s*(.*)$/.exec(line)).filter((match) => !!match)
    .map((match) => [match![1], match![2].trim().replace(/^['"]|['"]$/g, "")])) as Record<string, string>;
}

export const publicShoppingRoutes: FastifyPluginAsync<{ vault: Vault }> = async (app, { vault }) => {
  const webAppHead = registerPublicWebApp(app, "/handleliste", "Handlelister");
  const attempts = new Map<string, { count: number; reset: number }>();
  let pending: Promise<unknown> = Promise.resolve();
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_request, body, done) => {
    try { done(null, Object.fromEntries(new URLSearchParams(body as string))); } catch (error) { done(error as Error); }
  });
  app.addHook("onRequest", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "same-origin");
    reply.header("Content-Security-Policy", "default-src 'none'; manifest-src 'self'; img-src 'self'; style-src 'unsafe-inline'; script-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  });

  async function published(): Promise<List[]> {
    let folder: string;
    try {
      const config = JSON.parse(await vault.readText(".scribecat/plugins.json")) as { plugins?: { shopping?: { enabled?: boolean; publicView?: boolean; folder?: string } } };
      const pref = config.plugins?.shopping;
      if (!pref?.enabled || !pref.publicView) return [];
      folder = pref.folder ?? "Handlelister";
      if (!folder || folder.startsWith("/") || folder.includes("\\") || folder.split("/").some((part) => !part || part === "." || part === ".." || part === ".scribecat")) return [];
    } catch { return []; }
    const lists: List[] = [];
    const slugs = new Map<string, number>();
    for (const record of await readPluginMarkdown(vault, folder)) {
      try {
        const markdown = record.markdown;
        const meta = fields(markdown);
        if (meta["scribecat-plugin"] !== "shopping" || meta.type !== "shopping-list" || meta.published !== "true" || !SLUG.test(meta.slug ?? "")) continue;
        lists.push({ path: record.relativePath, slug: meta.slug, title: meta.title || meta.slug, markdown });
        slugs.set(meta.slug, (slugs.get(meta.slug) ?? 0) + 1);
      } catch { /* deleted during listing */ }
    }
    return lists.filter((list) => slugs.get(list.slug) === 1);
  }

  const html = (title: string, body: string, links: Array<[string, string]> = []) => `<!doctype html><html lang="no"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">${webAppHead}<title>${escapeHtml(title)} · Handleliste</title><style>${publicCss}</style></head><body>${publicFrame("Handlelister", body, title === "Handlelister" ? "handleliste" : "../handleliste", links)}</body></html>`;

  app.get("/handleliste", async (_request, reply) => {
    const lists = await published();
    return reply.type("text/html; charset=utf-8").send(html("Handlelister", `<h1>Handlelister</h1><p class="meta">Delte lister du kan handle sammen med andre.</p><div class="cards">${lists.map((list) => `<a class="card" href="handleliste/${list.slug}"><div><strong>${escapeHtml(list.title)}</strong><p class="meta">Åpne handleliste →</p></div></a>`).join("")}</div>`));
  });
  app.get("/handleliste/app.js", async (_request, reply) => reply.type("application/javascript; charset=utf-8").send(
    "document.addEventListener('change',event=>{if(event.target.matches('form.toggle input[type=checkbox],form.rename-item input[name=name]'))event.target.form.requestSubmit()});document.addEventListener('submit',event=>{if(event.target.matches('form.delete-category')&&!confirm('Slette kategorien og alle varene i den?'))event.preventDefault()})"
  ));
  app.get<{ Params: { slug: string } }>("/handleliste/:slug", async (request, reply) => {
    const list = SLUG.test(request.params.slug) ? (await published()).find((item) => item.slug === request.params.slug) : null;
    if (!list) return reply.code(404).send();
    const lines = list.markdown.replace(/^---\r?\n[\s\S]*?\r?\n---/, "").split(/\r?\n/);
    const categories: Array<{ name: string; active: Array<{ index: number; text: string }>; done: Array<{ index: number; text: string }> }> = [];
    let itemIndex = 0;
    for (const line of lines) {
      const heading = /^## (.+)$/.exec(line);
      if (heading) { categories.push({ name: heading[1], active: [], done: [] }); continue; }
      const item = /^- \[([ x])\] (.+)$/.exec(line);
      if (!item) continue;
      const index = itemIndex++;
      const category = categories.at(-1);
      if (category) (item[1] === "x" ? category.done : category.active).push({ index, text: item[2] });
    }
    const renderItem = (item: { index: number; text: string }, done = false) => `<div class="public-shopping-item"><form class="toggle" method="post" action="${list.slug}/toggle"><input type="hidden" name="index" value="${item.index}"><label><input type="checkbox" aria-label="Fullført ${escapeHtml(item.text)}" ${done ? "checked" : ""}></label><noscript><button type="submit">Endre</button></noscript></form><form class="rename-item" method="post" action="${list.slug}/rename-item"><input type="hidden" name="index" value="${item.index}"><input type="text" name="name" required maxlength="120" aria-label="Navn på vare: ${escapeHtml(item.text)}" value="${escapeHtml(item.text)}" class="${done ? "done" : ""}"><noscript><button type="submit">Lagre</button></noscript></form><form method="post" action="${list.slug}/delete-item"><input type="hidden" name="index" value="${item.index}"><button type="submit" aria-label="Slett ${escapeHtml(item.text)}">×</button></form></div>`;
    const content = categories.map((category, index) => `<section class="public-shopping-category" id="kategori-${index}"><div class="public-section-heading"><form class="public-category-title" method="post" action="${list.slug}/rename-category"><input type="hidden" name="category" value="${escapeHtml(category.name)}"><input name="name" required maxlength="80" aria-label="Kategorinavn" value="${escapeHtml(category.name)}"><button type="submit" aria-label="Lagre kategorinavn" title="Lagre">✓</button></form><form class="delete-category" method="post" action="${list.slug}/delete-category"><input type="hidden" name="category" value="${escapeHtml(category.name)}"><button type="submit" aria-label="Slett kategorien ${escapeHtml(category.name)}" title="Slett kategori">×</button></form></div>${category.active.map((item) => renderItem(item)).join("")}<form class="add public-category-add" method="post" action="${list.slug}/items"><input type="hidden" name="category" value="${escapeHtml(category.name)}"><input type="text" name="item" maxlength="120" required placeholder="Legg til vare" aria-label="Ny vare i ${escapeHtml(category.name)}"><button type="submit" aria-label="Legg til vare">+</button></form>${category.done.length ? `<details class="public-completed"><summary>Fullført (${category.done.length})</summary>${category.done.map((item) => renderItem(item, true)).join("")}</details>` : ""}</section>`).join("");
    const addCategory = `<form class="add" method="post" action="${list.slug}/categories"><input type="text" name="category" maxlength="80" required placeholder="Ny kategori" aria-label="Ny kategori"><button type="submit">+ Kategori</button></form>`;
    const lists = await published();
    return reply.type("text/html; charset=utf-8").send(html(list.title, `<h1>${escapeHtml(list.title)}</h1><p class="meta">Kryss av underveis, eller legg til det som mangler.</p>${content}${addCategory}<script defer src="../handleliste/app.js"></script>`, lists.map((item) => [escapeHtml(item.title), `../handleliste/${item.slug}`])));
  });

  async function mutate(slug: string, payload: Record<string, unknown>, mode: "add" | "toggle" | "category" | "delete-item" | "delete-category" | "rename-category" | "rename-item"): Promise<boolean> {
    const operation = pending.then(async () => {
      const list = (await published()).find((item) => item.slug === slug);
      if (!list) return false;
      let markdown = list.markdown;
      if (mode === "rename-category") {
        const category = typeof payload.category === "string" ? payload.category : "";
        const name = typeof payload.name === "string" ? payload.name.trim() : "";
        const categories = [...markdown.matchAll(/^##\s+(.+)$/gm)].map((match) => match[1].trim());
        if (!categories.includes(category) || !name || name.length > 80 || /[\r\n\x00-\x1f#<>]/.test(name) || categories.some((item) => item !== category && item.toLocaleLowerCase("no") === name.toLocaleLowerCase("no"))) return false;
        markdown = markdown.split("\n").map((line) => line === `## ${category}` ? `## ${name}` : line).join("\n");
      } else if (mode === "delete-category") {
        const category = typeof payload.category === "string" ? payload.category : "";
        if (!category || ![...markdown.matchAll(/^##\s+(.+)$/gm)].some((match) => match[1].trim() === category)) return false;
        const lines = markdown.split(/\r?\n/);
        const start = lines.findIndex((line) => line === `## ${category}`);
        const end = lines.findIndex((line, index) => index > start && /^##\s+/.test(line));
        lines.splice(start, (end === -1 ? lines.length : end) - start);
        markdown = lines.join("\n");
      } else if (mode === "category") {
        const category = typeof payload.category === "string" ? payload.category.trim() : "";
        if (!category || category.length > 80 || /[\r\n\x00-\x1f#<>]/.test(category) ||
          [...markdown.matchAll(/^##\s+(.+)$/gm)].some((match) => match[1].trim().toLocaleLowerCase("no") === category.toLocaleLowerCase("no"))) return false;
        markdown = `${markdown.trimEnd()}\n\n## ${category}\n`;
      } else if (mode === "add") {
        const item = typeof payload.item === "string" ? payload.item.trim() : "";
        const category = typeof payload.category === "string" ? payload.category : "";
        if (!item || item.length > 120 || /[\r\n\x00-\x1f]/.test(item) || ![...markdown.matchAll(/^##\s+(.+)$/gm)].some((match) => match[1].trim() === category)) return false;
        const heading = [...markdown.matchAll(/^##\s+(.+)$/gm)].find((match) => match[1].trim() === category)!;
        const insert = heading.index! + heading[0].length;
        markdown = markdown.slice(0, insert) + `\n- [ ] ${item.replace(/[\\[\]*_`<>]/g, "")}\n` + markdown.slice(insert);
      } else {
        const index = Number(payload.index);
        if (!Number.isSafeInteger(index) || index < 0) return false;
        const name = mode === "rename-item" && typeof payload.name === "string" ? payload.name.trim() : "";
        if (mode === "rename-item" && (!name || name.length > 120 || /[\r\n\x00-\x1f]/.test(name))) return false;
        let count = 0;
        markdown = markdown.replace(/^- \[([ x])\] (.+)$/gm, (line, checked: string) => count++ === index ? mode === "delete-item" ? "" : mode === "rename-item" ? `- [${checked}] ${name.replace(/[\\[\]*_`<>]/g, "")}` : line.replace(/^(- \[)[ x](\])/, `$1${checked === "x" ? " " : "x"}$2`) : line);
        if (count <= index) return false;
      }
      await vault.writeText(list.path, markdown);
      return true;
    });
    pending = operation.catch(() => undefined);
    return operation;
  }

  for (const mode of ["add", "toggle", "category", "delete-item", "delete-category", "rename-category", "rename-item"] as const) {
    app.post<{ Params: { slug: string }; Body: Record<string, unknown> }>(`/handleliste/:slug/${mode === "add" ? "items" : mode === "category" ? "categories" : mode}`, async (request, reply) => {
      const source = request.headers.origin || request.headers.referer;
      let sameOrigin = false;
      try { sameOrigin = !!source && new URL(source).host === (request.headers.host || "localhost"); } catch { /* invalid origin */ }
      if (!SLUG.test(request.params.slug) || !sameOrigin) return reply.code(403).send();
      const now = Date.now();
      const client = attempts.get(request.ip);
      if (attempts.size > 2000) attempts.clear();
      if (client && client.reset > now && client.count >= 30) return reply.code(429).send();
      attempts.set(request.ip, { count: client && client.reset > now ? client.count + 1 : 1, reset: client && client.reset > now ? client.reset : now + 60_000 });
      if (!(await mutate(request.params.slug, request.body ?? {}, mode))) return reply.code(400).send();
      return reply.code(303).header("Location", `../${request.params.slug}`).send();
    });
  }
};
