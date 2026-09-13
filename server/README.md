# ScribeDog Server Edition

Run ScribeDog as a self-hosted web app: your notes live in a folder on the
server, you edit them in the browser, and a single password protects the
instance.

> **Status: early.** The web app is the desktop app's own frontend, so it
> looks and works the same, but the server behind it is still growing. Today
> it covers login/logout and the whole file side: the file tree, creating,
> renaming, moving and deleting notes and folders, images (paste and drop),
> manual sort order, version history, and live updates when files change on
> disk. The AI features are not adapted for the browser yet (an API key
> entered in the settings is kept in memory for the tab only), the chat agent
> and the knowledge base are not wired up, and there is no rate limiting on
> the login yet. Features that only exist natively (local folders,
> import from local files, export to a local folder, the image file picker,
> dictation, the updater) are hidden.

## Quick start

Requirements: Docker with the Compose plugin.

```bash
cd server
cp .env.example .env         # set SCRIBEDOG_INIT_PASSWORD (8+ characters), PUID/PGID
docker compose up -d --build # creates ./scribedog-data if it is not there
```

Open <https://localhost/> and sign in with the password you set. On the very
first start with an empty folder the server creates a `Welcome.md` so there is
something to open.

Your browser will warn about the certificate on the first visit: Caddy signs
it with its own local CA. Either accept the warning, or import the CA once so
every device you use trusts it:

```bash
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt
```

Then add `caddy-root.crt` to your OS or browser trust store.

## Configuration

Everything is set through environment variables in `.env` (read by
`docker-compose.yml`).

| Variable | Default | What it does |
| --- | --- | --- |
| `SCRIBEDOG_INIT_PASSWORD` | | Password for the first start. Only used while no password exists in the data folder; afterwards it is ignored (the server logs a note) and can be removed. |
| `SCRIBEDOG_BASE_PATH` | *(empty)* | Serve the app under a path prefix, e.g. `/anna`. See below. |
| `SCRIBEDOG_SITE_ADDRESS` | `localhost` | Host name or IP Caddy answers on: `localhost`, the LAN name or IP of the box, or a public domain. |
| `SCRIBEDOG_TLS` | `internal` | `internal` uses Caddy's local CA. For a public domain set your e-mail address and Caddy obtains a Let's Encrypt certificate. |
| `SCRIBEDOG_HTTP_PORT` / `SCRIBEDOG_HTTPS_PORT` | `80` / `443` | Host ports Caddy listens on. |
| `PUID` / `PGID` | `1000` / `1000` | User and group the server runs as. The container starts as root, hands `./scribedog-data` to these ids and drops to them, so match them to your own user (`id -u`, `id -g`) and the notes stay yours on the host. |

Variables the server itself understands (set on the `scribedog` service if you
run it without the bundled compose file):

| Variable | Default | What it does |
| --- | --- | --- |
| `SCRIBEDOG_VAULT_PATH` | `/data` | Folder with the notes. |
| `SCRIBEDOG_HOST` / `SCRIBEDOG_PORT` | `0.0.0.0` / `3000` | Where the server listens. |
| `SCRIBEDOG_COOKIE_SECURE` | `true` | Session cookie carries the `Secure` flag. Set to `false` only for plain-http development on localhost. |
| `SCRIBEDOG_TRUST_PROXY` | `true` | Trust `X-Forwarded-*` headers from the reverse proxy. |
| `SCRIBEDOG_SESSION_MAX_AGE_DAYS` | `60` | How long a session stays valid without activity (sliding, capped at 60). |
| `SCRIBEDOG_LOG_LEVEL` | `info` | Pino log level. |
| `SCRIBEDOG_WEB_DIST_DIR` | `../dist-web` | Directory with the built web client (see Development). The Docker image sets it. |

## Running under a path prefix

Set `SCRIBEDOG_BASE_PATH=/anna` and the app answers under
`https://<host>/anna/` only. `https://<host>/` then returns 404 on purpose.
Everything follows the prefix: the page, its assets, the API and the session
cookie's `Path`, so two instances on the same host under different prefixes do
not see each other's cookies. `https://<host>/anna` (no trailing slash)
redirects to `https://<host>/anna/`.

The reverse proxy passes the path through unchanged; it must not strip the
prefix. The bundled Caddyfile already does this. If you put your own nginx or
Traefik in front, proxy `/anna` to the container as `/anna`, not as `/`.

Changing the prefix later logs everyone out (the cookie was scoped to the old
path); that is all.

## TLS and the reverse proxy

The server speaks plain HTTP and expects a reverse proxy to terminate TLS. The
compose file ships with Caddy for that:

- **No domain (home network, IP or local host name):** keep
  `SCRIBEDOG_TLS=internal`. Caddy uses its own local CA; import
  `caddy-root.crt` as described above so browsers stop warning.
- **Public domain:** set `SCRIBEDOG_SITE_ADDRESS=notes.example.com` and
  `SCRIBEDOG_TLS=you@example.com`. Ports 80 and 443 must be reachable from the
  internet for Let's Encrypt.

Do not expose the server without TLS beyond `localhost`: the password would
travel in clear text.

## Where your data is

`./scribedog-data` is bind-mounted into the container as `/data`. It holds:

- your notes, as ordinary `.md` files in whatever folders you like;
- `images/` for pictures pasted or dropped into notes;
- `.scribedog/` with the same sidecars the desktop app keeps (version
  history, manual sort order, chat sessions), written by the web app through
  the server, plus `.scribedog/server/auth.json` with the password hash and
  `.scribedog/server/session-secret`, which signs session cookies. The
  `server/` part is created on first start with mode `0600` and is the one
  place the file API never reaches.

Changes made on the host (a sync tool, an editor over SSH) show up in open
browser tabs within a second: the server watches the folder and pushes a
signal over a WebSocket, the app rescans.

Because it is a plain folder, back it up like any other folder with the tool
you already use. Deleting `.scribedog/server/auth.json` resets the password:
set `SCRIBEDOG_INIT_PASSWORD` again and restart.

## Updating

```bash
docker compose pull   # or: git pull && docker compose build
docker compose up -d
```

Sessions survive restarts and updates; nobody has to sign in again.

## Development

The web client is the desktop app's frontend (`/src` in the repository
root) built for the browser; the server only serves that build. So there are
two packages involved:

```bash
# repository root: build the web client into dist-web/
npm install
npm run build:web

# server
cd server
npm install
SCRIBEDOG_VAULT_PATH=/path/to/notes SCRIBEDOG_INIT_PASSWORD=devpassword SCRIBEDOG_COOKIE_SECURE=false npm run dev                              # http://localhost:3000
```

The server reads `index.html` once at startup, so restart it after a new
`npm run build:web`. For UI work with hot reload run `npm run dev:web` in
the repository root instead (<http://localhost:5173>, API calls are proxied to
port 3000).

```bash
npm test          # unit and API tests (vitest), in server/
npm run typecheck
npm run test:e2e  # browser test against a running instance, see below
```

The browser test drives a real instance, usually the compose stack:

```bash
npx playwright install chromium
SCRIBEDOG_E2E_URL=https://localhost/ SCRIBEDOG_E2E_PASSWORD=... npm run test:e2e
# or, with a base path:
SCRIBEDOG_E2E_URL=https://localhost/anna/ SCRIBEDOG_E2E_PASSWORD=... npm run test:e2e
```

It expects a note `Projects/Roadmap.md` in the vault (override with
`SCRIBEDOG_E2E_NOTE`) and overwrites it.

The Docker image is built from the repository root (`docker compose` in
`server/` already uses `..` as the build context) because it needs both
packages.

## API

All routes live under the base path. Every route except login, session and
health needs the session cookie.

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/login` | `{ "password": "..." }` → sets the session cookie |
| `POST` | `/api/auth/logout` | clears the cookie |
| `GET` | `/api/auth/session` | `{ "authenticated": true\|false }` |
| `GET` | `/api/files` | list of `.md` files with modification times |
| `GET` | `/api/fs/entries?path=Notes` | directory listing (`path=` for the root) |
| `GET` | `/api/fs/stat?path=…` | size, times, kind of one entry |
| `GET` | `/api/fs/exists?path=…` | `{ "exists": true|false }` |
| `POST` | `/api/fs/mkdir` | `{ "path": "…", "recursive": true }` |
| `GET` | `/api/fs/text?path=…` | read a text file |
| `PUT` | `/api/fs/text` | `{ "path": "…", "content": "…" }` → create or overwrite (parent folder must exist) |
| `GET` | `/api/fs/file?path=…` | read a binary file (images get their content type) |
| `PUT` | `/api/fs/file?path=…` | body as `application/octet-stream` → create or overwrite |
| `POST` | `/api/fs/rename` | `{ "from": "…", "to": "…" }` (files and folders) |
| `POST` | `/api/fs/remove` | `{ "path": "…", "recursive": true }` (a folder without `recursive` must be empty) |
| `GET` | `/api/events` | WebSocket; sends `{"type":"files-changed"}` when the vault changes on disk |
| `GET` | `/api/health` | liveness probe |

The `/fs` routes are the frontend's filesystem layer, one call per
primitive. Paths are relative to the vault and may not point outside it
(symlinks included) or into `.scribedog/server/`; the vault root and
`.scribedog` itself cannot be renamed or removed.
