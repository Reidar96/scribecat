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
    for (const record of await vault.listMarkdownFiles()) {
      if (!record.relativePath.startsWith(`${folder}/`)) continue;
      try {
        const markdown = await vault.readText(record.relativePath);
        const meta = fields(markdown);
        if (meta["scribecat-plugin"] !== "shopping" || meta.type !== "shopping-list" || meta.published !== "true" || !SLUG.test(meta.slug ?? "")) continue;
        lists.push({ path: record.relativePath, slug: meta.slug, title: meta.title || meta.slug, markdown });
        slugs.set(meta.slug, (slugs.get(meta.slug) ?? 0) + 1);
      } catch { /* deleted during listing */ }
    }
    return lists.filter((list) => slugs.get(list.slug) === 1);
  }

  const html = (title: string, body: string) => `<!doctype html><html lang="no"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · Handleliste</title><style>body{font:1rem/1.55 system-ui,sans-serif;max-width:42rem;margin:auto;padding:1rem;color:#242424;background:#faf9f6}main{background:white;border:1px solid #e4e2de;border-radius:.8rem;padding:clamp(1rem,4vw,2rem)}a{color:#245d42}label{display:flex;gap:.65rem;padding:.4rem 0;align-items:center}input,button,select{font:inherit}input[type=text],select{min-width:0;padding:.55rem;border:1px solid #aaa;border-radius:.4rem}input[type=checkbox]{width:1.15rem;height:1.15rem;accent-color:#245d42}button{padding:.5rem .75rem;border:1px solid #aaa;border-radius:.4rem;background:#f4f4f1}form.add{display:flex;gap:.5rem;margin-top:1rem}form.add input{flex:1}.done{text-decoration:line-through;color:#777}section{border-top:1px solid #e4e2de;margin-top:1rem}</style></head><body><nav><a href="../handleliste">⌂ Handlelister</a></nav><main>${body}</main></body></html>`;

  app.get("/handleliste", async (_request, reply) => {
    const lists = await published();
    return reply.type("text/html; charset=utf-8").send(html("Handlelister", `<h1>Handlelister</h1><ul>${lists.map((list) => `<li><a href="handleliste/${list.slug}">${escapeHtml(list.title)}</a></li>`).join("")}</ul>`));
  });
  app.get("/handleliste/app.js", async (_request, reply) => reply.type("application/javascript; charset=utf-8").send(
    "document.addEventListener('change',event=>{if(event.target.matches('form.toggle input[type=checkbox]'))event.target.form.requestSubmit()})"
  ));
  app.get<{ Params: { slug: string } }>("/handleliste/:slug", async (request, reply) => {
    const list = SLUG.test(request.params.slug) ? (await published()).find((item) => item.slug === request.params.slug) : null;
    if (!list) return reply.code(404).send();
    const lines = list.markdown.replace(/^---\r?\n[\s\S]*?\r?\n---/, "").split(/\r?\n/);
    let itemIndex = 0;
    const content = lines.map((line) => {
      const heading = /^## (.+)$/.exec(line);
      if (heading) return `<section><h2>${escapeHtml(heading[1])}</h2>`;
      const item = /^- \[([ x])\] (.+)$/.exec(line);
      if (!item) return "";
      const index = itemIndex++;
      return `<form class="toggle" method="post" action="${list.slug}/toggle"><input type="hidden" name="index" value="${index}"><label class="${item[1] === "x" ? "done" : ""}"><input type="checkbox" ${item[1] === "x" ? "checked" : ""}>${escapeHtml(item[2])}</label><noscript><button type="submit">Endre</button></noscript></form>`;
    }).join("");
    const categories = [...list.markdown.matchAll(/^##\s+(.+)$/gm)].map((match) => match[1].trim());
    const add = `<form class="add" method="post" action="${list.slug}/items"><input type="text" name="item" maxlength="120" required placeholder="Ny vare"><select name="category">${categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("")}</select><button type="submit">Legg til</button></form>`;
    return reply.type("text/html; charset=utf-8").send(html(list.title, `<h1>${escapeHtml(list.title)}</h1>${content}${add}<script defer src="../handleliste/app.js"></script>`));
  });

  async function mutate(slug: string, payload: Record<string, unknown>, mode: "add" | "toggle"): Promise<boolean> {
    const operation = pending.then(async () => {
      const list = (await published()).find((item) => item.slug === slug);
      if (!list) return false;
      let markdown = list.markdown;
      if (mode === "add") {
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
        markdown = markdown.replace(/^- \[([ x])\] (.+)$/gm, (line, checked: string) => count++ === index ? line.replace(/^(- \[)[ x](\])/, `$1${checked === "x" ? " " : "x"}$2`) : line);
        if (count <= index) return false;
      }
      await vault.writeText(list.path, markdown);
      return true;
    });
    pending = operation.catch(() => undefined);
    return operation;
  }

  for (const mode of ["add", "toggle"] as const) {
    app.post<{ Params: { slug: string }; Body: Record<string, unknown> }>(`/handleliste/:slug/${mode === "add" ? "items" : "toggle"}`, async (request, reply) => {
      if (!SLUG.test(request.params.slug) || (!request.headers.origin && !request.headers.referer)) return reply.code(403).send();
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
