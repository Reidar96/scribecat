# ScribeDog Server Edition

Run ScribeDog as a self-hosted web app: your notes live in a folder on the
server, you edit them in the browser, and a single password protects the
instance.

> **Status: early.** The web app is the desktop app's own frontend, so it
> looks and works the same, but the server behind it is still growing. Today
> it covers the whole file side (the file tree, creating, renaming, moving and
> deleting notes and folders, images, manual sort order, version history, live
> updates when files change on disk), the account side (login, logout,
> changing the password, brute-force protection) and the cloud AI providers
> (rewrite, insert, grammar check), with the API keys stored encrypted on the
> server. Not there yet: the chat agent and its vault tools, the knowledge
> base, and local AI models. Features that only exist natively (local folders,
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
| `SCRIBEDOG_TRUST_PROXY` | `1` | How many reverse proxies stand in front. The bundled Caddy is one. `false` for none (the server is reached directly); a number, or a list of proxy addresses, otherwise. It decides which address a request counts as, which is what the login lock is applied to. |
| `SCRIBEDOG_SESSION_MAX_AGE_DAYS` | `60` | How long a session stays valid without activity (sliding, capped at 60). |
| `SCRIBEDOG_LOGIN_MAX_ATTEMPTS` | `5` | Failed logins from one address before it is locked out. |
| `SCRIBEDOG_LOGIN_LOCK_SECONDS` | `60` | How long the first lock lasts. Each further series of failures multiplies it by five. |
| `SCRIBEDOG_LOGIN_LOCK_MAX_SECONDS` | `900` | Upper limit for that escalation. |
| `SCRIBEDOG_ALLOWED_ORIGINS` | *(empty)* | Extra origins accepted on requests that change something, e.g. `https://notes.example.com`. Only needed if your proxy passes on a different host than the browser uses. |
| `SCRIBEDOG_LLM_ALLOWED_HOSTS` | the three cloud providers | Hosts the server may forward AI requests to. Add your own gateway here if you use one. |
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

## Your password

One password protects the instance; there is no user name. Three things are
worth knowing about it.

**Changing it** is in Settings → Account. It takes effect everywhere at once:
every other signed-in device is signed out, and the device you changed it on
stays signed in. Stored API keys survive the change, re-encrypted under the
new password.

**Wrong guesses are slowed down.** After five failures from one address the
next attempt is refused for a minute, after the next five for five minutes,
then fifteen, which is the ceiling. A correct password clears the count. The
numbers are configurable (see Configuration); behind a reverse proxy the count
follows `X-Forwarded-For`, so one attacker does not lock out the household.

**Forgotten it?** Delete `.scribedog/server/auth.json`, set
`SCRIBEDOG_INIT_PASSWORD` again and restart. Your notes are untouched, but the
stored API keys are not: they are encrypted with a key derived from the old
password and cannot be recovered. The app says so once and asks you to enter
them again.

## AI

The cloud providers (OpenAI, Anthropic, Mistral) work in the browser. Enter
the API key in Settings → AI as you would on the desktop; from there on it
differs from the desktop in two ways worth knowing.

**The key stays on the server.** It is encrypted with a key derived from your
login password and kept in `.scribedog/server/secrets.json`. The browser never
receives it back: the settings field shows "stored" instead of a value, and
requests to the provider are sent by the server, which fills the key in on the
way out. So someone who copies the data folder gets your notes (they are plain
Markdown on purpose) but not your API keys, and a browser extension or a stray
script in the page has nothing to find.

**The server talks to the provider, not the browser.** Browsers block direct
calls to another site's API, and sending the key to the tab to try would give
up what the paragraph above buys. The server only forwards to the three
provider hosts over https; anything else is refused, so this cannot become a
way to reach something else on your network. If you use your own gateway in
front of a provider, add its host to `SCRIBEDOG_LLM_ALLOWED_HOSTS`.

Local models (Ollama, Jan.ai, LM Studio) are not available in the browser yet.
On a server "localhost" is the container, not your machine, and reaching a
model on your own device from a web page is a separate piece of work.

## Where your data is

`./scribedog-data` is bind-mounted into the container as `/data`. It holds:

- your notes, as ordinary `.md` files in whatever folders you like;
- `images/` for pictures pasted or dropped into notes;
- `.scribedog/` with the same sidecars the desktop app keeps (version
  history, manual sort order, chat sessions), written by the web app through
  the server, plus `.scribedog/server-data-version`, which says which layout
  the folder is in (see Updating);
- `.scribedog/server/` with the server's own files: `auth.json` (the password
  hash), `session-secret` (signs session cookies) and `secrets.json` (the
  encrypted API keys). It is created on first start with mode `0600` and is
  the one place the file API never reaches.

Changes made on the host (a sync tool, an editor over SSH) show up in open
browser tabs within a second: the server watches the folder and pushes a
signal over a WebSocket, the app rescans.

Because it is a plain folder, back it up like any other folder with the tool
you already use. Deleting `.scribedog/server/auth.json` resets the password:
set `SCRIBEDOG_INIT_PASSWORD` again and restart.

## Updating

Images are published per version, with no `latest` tag: you pick a version and
keep it until you decide to move. Put the one you want in `.env`,

```dotenv
SCRIBEDOG_IMAGE=ghcr.io/snooky234/scribedog-server:0.11.0
```

and update with

```bash
docker compose pull
docker compose up -d
```

Building from the repository instead works as well:

```bash
git pull && docker compose up -d --build
```

Sessions survive restarts and updates; nobody has to sign in again.

**Going back a version** is fine as long as the data folder's layout has not
moved on. The server writes its layout version to
`.scribedog/server-data-version`, brings an older folder forward on start, and
refuses to start on a folder written by a newer server rather than reading a
format it does not know. If that happens, start the newer version again, or
restore the folder from a backup made before the upgrade. Release notes say
when a version changes the layout.

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
| `POST` | `/api/auth/password` | `{ "currentPassword": "...", "newPassword": "..." }` → new password, every other session ends |
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
| `GET` | `/api/secrets` | which API keys are stored, never their values |
| `PUT` | `/api/secrets/:id` | `{ "value": "..." }` → store a key (an empty value removes it) |
| `DELETE` | `/api/secrets/:id` | remove a key |
| `GET`/`POST` | `/api/llm/request` | forwards one request to the AI provider named in `X-Scribedog-Llm-Url` |
| `GET` | `/api/events` | WebSocket; sends `{"type":"files-changed"}` when the vault changes on disk |
| `GET` | `/api/health` | liveness probe |

The `/fs` routes are the frontend's filesystem layer, one call per
primitive. Paths are relative to the vault and may not point outside it
(symlinks included) or into `.scribedog/server/`; the vault root,
`.scribedog` itself and the data-version marker cannot be renamed or removed.

Requests that change something must come from this instance: the session
cookie is `SameSite=Lax`, and the server additionally rejects a request whose
`Origin` or `Referer` names another site. A request with neither header (curl,
a script) is accepted, since it cannot be a browser carrying someone else's
cookie.
