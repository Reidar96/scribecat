import { readPluginMarkdown } from "./pluginFiles.js";
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
  const attempts = new Map<string, { count: number; reset: number }>();
  let pending: Promise<unknown> = Promise.resolve();
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_request, body, done) => {
    try { done(null, Object.fromEntries(new URLSearchParams(body as string))); } catch (error) { done(error as Error); }
  });
  app.addHook("onRequest", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "same-origin");
    reply.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
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

  const html = (title: string, body: string, links: Array<[string, string]> = []) => `<!doctype html><html lang="no"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · Handleliste</title><style>${publicCss}</style></head><body>${publicFrame("Handlelister", body, title === "Handlelister" ? "handleliste" : "../handleliste", links)}</body></html>`;

  app.get("/handleliste", async (_request, reply) => {
    const lists = await published();
    return reply.type("text/html; charset=utf-8").send(html("Handlelister", `<h1>Handlelister</h1><p class="meta">Delte lister du kan handle sammen med andre.</p><div class="cards">${lists.map((list) => `<a class="card" href="handleliste/${list.slug}"><div><strong>${escapeHtml(list.title)}</strong><p class="meta">Åpne handleliste →</p></div></a>`).join("")}</div>`));
  });
  app.get("/handleliste/app.js", async (_request, reply) => reply.type("application/javascript; charset=utf-8").send(
    "document.addEventListener('change',event=>{if(event.target.matches('form.toggle input[type=checkbox]'))event.target.form.requestSubmit()});document.addEventListener('submit',event=>{if(event.target.matches('form.delete-category')&&!confirm('Slette kategorien og alle varene i den?'))event.preventDefault()})"
  ));
  app.get<{ Params: { slug: string } }>("/handleliste/:slug", async (request, reply) => {
    const list = SLUG.test(request.params.slug) ? (await published()).find((item) => item.slug === request.params.slug) : null;
    if (!list) return reply.code(404).send();
    const lines = list.markdown.replace(/^---\r?\n[\s\S]*?\r?\n---/, "").split(/\r?\n/);
    let itemIndex = 0;
    let sectionOpen = false;
    let categoryIndex = 0;
    const content = lines.map((line) => {
      const heading = /^## (.+)$/.exec(line);
      if (heading) {
        const close = sectionOpen ? "</section>" : "";
        sectionOpen = true;
        return `${close}<section class="public-shopping-category" id="kategori-${categoryIndex++}"><div class="public-section-heading"><h2>${escapeHtml(heading[1])}</h2><form class="delete-category" method="post" action="${list.slug}/delete-category"><input type="hidden" name="category" value="${escapeHtml(heading[1])}"><button type="submit" aria-label="Slett kategorien ${escapeHtml(heading[1])}">Slett kategori</button></form></div>`;
      }
      const item = /^- \[([ x])\] (.+)$/.exec(line);
      if (!item) return "";
      const index = itemIndex++;
      return `<div class="public-shopping-item"><form class="toggle" method="post" action="${list.slug}/toggle"><input type="hidden" name="index" value="${index}"><label class="${item[1] === "x" ? "done" : ""}"><input type="checkbox" ${item[1] === "x" ? "checked" : ""}>${escapeHtml(item[2])}</label><noscript><button type="submit">Endre</button></noscript></form><form method="post" action="${list.slug}/delete-item"><input type="hidden" name="index" value="${index}"><button type="submit" aria-label="Slett ${escapeHtml(item[2])}">Slett</button></form></div>`;
    }).join("") + (sectionOpen ? "</section>" : "");
    const categories = [...list.markdown.matchAll(/^##\s+(.+)$/gm)].map((match) => match[1].trim());
    const add = `<form class="add" method="post" action="${list.slug}/items"><input type="text" name="item" maxlength="120" required placeholder="Ny vare"><select name="category">${categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("")}</select><button type="submit">Legg til</button></form>`;
    const addCategory = `<form class="add" method="post" action="${list.slug}/categories"><input type="text" name="category" maxlength="80" required placeholder="Ny kategori" aria-label="Ny kategori"><button type="submit">+ Kategori</button></form>`;
    return reply.type("text/html; charset=utf-8").send(html(list.title, `<h1>${escapeHtml(list.title)}</h1><p class="meta">Kryss av underveis, eller legg til det som mangler.</p>${content}${add}${addCategory}<script defer src="../handleliste/app.js"></script>`, categories.map((category, index) => [escapeHtml(category), `#kategori-${index}`])));
  });

  async function mutate(slug: string, payload: Record<string, unknown>, mode: "add" | "toggle" | "category" | "delete-item" | "delete-category"): Promise<boolean> {
    const operation = pending.then(async () => {
      const list = (await published()).find((item) => item.slug === slug);
      if (!list) return false;
      let markdown = list.markdown;
      if (mode === "delete-category") {
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
        let count = 0;
        markdown = markdown.replace(/^- \[([ x])\] (.+)$/gm, (line, checked: string) => count++ === index ? mode === "delete-item" ? "" : line.replace(/^(- \[)[ x](\])/, `$1${checked === "x" ? " " : "x"}$2`) : line);
        if (count <= index) return false;
      }
      await vault.writeText(list.path, markdown);
      return true;
    });
    pending = operation.catch(() => undefined);
    return operation;
  }

  for (const mode of ["add", "toggle", "category", "delete-item", "delete-category"] as const) {
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
