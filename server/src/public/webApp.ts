import type { FastifyInstance } from "fastify";

/** Each public collection is an independent Home Screen app, including subpages. */
export function registerPublicWebApp(app: FastifyInstance, route: string, name: string): string {
  const root = `${app.prefix}${route}`.replace(/\/+/g, "/");
  const icon = `${root}/icon.svg`;
  app.get(`${route}/manifest.webmanifest`, async (_request, reply) => reply
    .header("Cache-Control", "no-cache")
    .type("application/manifest+json; charset=utf-8")
    .send({ id: root, name: `ScribeCat · ${name}`, short_name: name, lang: "no", start_url: root, scope: root, display: "standalone", background_color: "#f7f6fa", theme_color: "#f7f6fa", icons: [{ src: icon, sizes: "any", type: "image/svg+xml", purpose: "any maskable" }] }));
  app.get(`${route}/icon.svg`, async (_request, reply) => reply.type("image/svg+xml; charset=utf-8").send(
    '<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 192 192"><rect width="192" height="192" rx="44" fill="#a855f7"/><path d="M60 48h72a12 12 0 0 1 12 12v72a12 12 0 0 1-12 12H60a12 12 0 0 1-12-12V60a12 12 0 0 1 12-12zm16 32h40m-40 20h40m-40 20h24" fill="none" stroke="white" stroke-width="9" stroke-linecap="round"/></svg>'
  ));
  return `<meta name="theme-color" content="#f7f6fa"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="default"><meta name="apple-mobile-web-app-title" content="${name}"><link rel="manifest" href="${root}/manifest.webmanifest"><link rel="apple-touch-icon" href="${icon}">`;
}
