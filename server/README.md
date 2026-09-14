# ScribeDog Server Edition

Run ScribeDog as a self-hosted web app: your notes live in a folder on the
server, you edit them in the browser, and a single password protects the
instance.

> **Status: usable.** The web app is the desktop app's own frontend, so it
> looks and works the same, on a desktop browser as well as on a phone or
> tablet. It covers the whole file side (the file tree, creating, renaming,
> moving and deleting notes and folders, images, manual sort order, version
> history, live updates when files change on disk), the account side (login,
> logout, changing the password, brute-force protection), the AI side (rewrite,
> insert, grammar check, and the chat with its vault agent: staged proposals,
> review, checkpoints and undo) with the cloud providers through the server
> and their API keys stored encrypted there, or with a local model on the
> device you browse from. Two things stay desktop only on purpose: the
> knowledge base (the vault search index lives in the desktop app's native
> process) and built-in dictation (see "Dictation" below for what to use
> instead). Features that need the native shell (local folders, import from
> local files, export to a local folder, the image file picker, the updater)
> are hidden.

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
| `SCRIBEDOG_SITE_ADDRESS` | `localhost` | Host name or IP Caddy answers on: `localhost`, the LAN name or IP of the box, or a public domain. Several, separated by commas, if the box is reached under more than one name. |
| `SCRIBEDOG_DEFAULT_SNI` | the site address | Only matters with several site addresses: which one's certificate answers a browser that names none, which is what browsers do when they open the app by IP address. Set it to that IP. |
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

## Several people on one host

ScribeDog has one password and one vault per instance, on purpose: there are
no accounts, no sharing rules and no permissions to get wrong. Two people on
one box therefore get two instances, each under its own path prefix behind one
Caddy. [`examples/multi-instance/`](examples/multi-instance/) is a complete
compose file for that:

```bash
cd server/examples/multi-instance
cp .env.example .env         # one init password per instance, host name, ids
docker compose up -d --build
```

which serves `https://<host>/anna/` and `https://<host>/bob/` from two
containers with two data folders (`anna-data`, `bob-data`). Each instance has
its own password and its own session cookie, scoped to its prefix, so signing
in to one says nothing about the other. Adding a third means one more service
block, one more `handle` block in the Caddyfile and one more folder.

Two details of the Caddyfile are worth knowing if you write your own:

- The instances are routed with `handle /anna*`, not `handle_path`: the
  prefix has to reach the container intact, because the app answers under it
  and would otherwise neither find its assets nor scope its cookie.
- A browser that opens the site by IP address sends no server name, and with
  more than one site Caddy needs `default_sni` to pick a certificate (see
  `SCRIBEDOG_DEFAULT_SNI` above).

**Keeping the folders apart.** The data folders are plain folders on the
host, so whoever can read `anna-data` can read Anna's notes. If the people
sharing the box also have shell access to it, give every instance its own
Linux user and folder permissions to match:

```bash
sudo useradd --system --no-create-home anna
sudo mkdir anna-data && sudo chown anna:anna anna-data && sudo chmod 700 anna-data
id anna                       # -> the ANNA_PUID / ANNA_PGID for .env
```

The container starts as root, hands the folder to that user and drops to it,
so the files it writes stay that user's. This keeps ordinary users out of
each other's notes; it does not keep root out, and nothing on the host can
(see "Where your data is").

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

## On a phone or tablet

The same app, laid out for the screen it is on. Below about 640 px (a phone)
the file list is a sheet behind the button at the top left and comes up by
itself while no note is open; the formatting toolbar sits at the bottom, above
the keyboard, and scrolls sideways; the save button is the status pill in the
header, and everything else the toolbar offers on the desktop (find and
replace, details, zoom, zen mode, print, spell check, versions, back and
forward) is in the header's menu. The chat and the details panel open as
full-screen sheets. Up to about 920 px (a tablet in portrait) the file list
stays next to the note and the chat comes in from the right; above that the
layout is the desktop one. On a touch screen every tree row has a "…" button
for its menu (a long press works on Android too), and "Move to…" in that menu
does what dragging does with a mouse.

Add the site to the home screen (Chrome: "Add to Home screen", Safari: share
sheet, "Add to Home Screen") and it opens without the browser chrome. The
session cookie lasts 60 days of use, so the password is asked for rarely.

Chrome and Safari on phones show a certificate warning for Caddy's local CA
just like the desktop browsers; import `caddy-root.crt` on the device once
(Android: Settings, Security, Install a certificate; iOS: open the file,
install the profile, then trust it under Certificate Trust Settings) or accept
the warning.

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

**The chat agent works on the vault through the server.** Everything the
desktop agent does, the web app does too: it reads and searches your notes,
proposes new notes and edits, and every proposal waits for your review before
it touches a file. The pieces it keeps between sessions live in the vault,
next to the notes: open proposals in `.scribedog/staged-changes.json`,
the checkpoints behind the undo button in `.scribedog/checkpoints/`, and the
chat history in `.scribedog/chat-sessions.json`. So they follow the vault,
not the browser: open the same server from another device and the pending
proposals and the undo history are there. Each step of an agent run is one
request through the server to the provider, and each note the agent reads is
one request to the server, so a long run over many notes takes a little
longer over Wi-Fi than on the desktop; it does not need anything else.

The knowledge base (the vault search index with embeddings) is desktop only
for now: its index lives in the desktop app's native process. The agent's
own `search_files` and `read_file` tools do not need it.

### A model on your own device

Ollama, Jan.ai and LM Studio work too, with one difference to the desktop
app: the *browser* talks to them, not the server. "localhost" in the API URL
is therefore the device you are sitting at, not the server, and the model
server there has to accept requests from a web page. Two things decide
whether that works, and the app tells you which one is in the way when a
request fails.

**The model server has to allow this page's origin.** Browsers only let a
page call another server if that server says so (CORS), and the local model
servers only say so for pages served from localhost unless told otherwise.
The settings dialog shows the exact origin to allow (`https://<host>` as you
open ScribeDog, with the port if it is not 443):

| Server | What to do |
| --- | --- |
| Ollama | Start it with `OLLAMA_ORIGINS=https://<host>` in its environment (on Windows, set the variable in the user's environment and restart Ollama from the tray). Without it Ollama refuses the page (403). |
| Jan.ai | Settings, Local API Server: keep CORS on and add `<host>` (host name and port, no scheme) to *Trusted Hosts*. |
| LM Studio | In the server settings, enable CORS. |

**Over a public address, the browser asks once.** Chrome and Edge (since 142)
treat a page loaded from the internet reaching into your local network as
something you have to allow: a prompt appears on the first request, and the
answer is remembered per site (it is in the site settings if you want to
change it). Pages loaded from a home network address are not asked. Firefox
has no such prompt. Safari has not been tested.

Everything else is as on the desktop: the AI settings live in the browser, so
each device keeps its own. A phone without a model server simply picks a
cloud provider in its own settings; the API key is stored once on the server
and works from every device.

### Dictation

The desktop app's dictation runs Whisper in its native process; the server
does not transcribe, and the web app has no microphone button. Use what the
device already has, all of which type straight into the editor:

- **Windows:** press Win+H with the cursor in the note (voice typing, needs
  a one-time download of the language pack under Settings, Time & language,
  Speech).
- **macOS:** press the dictation key or Fn twice (System Settings, Keyboard,
  Dictation). Recent macOS versions transcribe on the device.
- **Phones and tablets:** the microphone key on the keyboard (Gboard, iOS).

The one thing the app could add on its own is a button on the browser's
Web Speech API, and it deliberately does not: in Chrome and Edge that API
sends the audio to Google's servers, Firefox does not support it at all, and
the system dictation above is on every device already, offline where the
system does it offline.

## Where your data is

`./scribedog-data` is bind-mounted into the container as `/data`. It holds:

- your notes, as ordinary `.md` files in whatever folders you like;
- `images/` for pictures pasted or dropped into notes;
- `.scribedog/` with the same sidecars the desktop app keeps (version
  history, manual sort order, chat sessions, the agent's pending proposals
  and checkpoints), written by the web app through the server, plus
  `.scribedog/server-data-version`, which says which layout the folder is in
  (see Updating);
- `.scribedog/server/` with the server's own files: `auth.json` (the password
  hash), `session-secret` (signs session cookies) and `secrets.json` (the
  encrypted API keys). It is created on first start with mode `0600` and is
  the one place the file API never reaches.

Changes made on the host (a sync tool, an editor over SSH) show up in open
browser tabs within a second: the server watches the folder and pushes a
signal over a WebSocket, the app rescans.

Deleting `.scribedog/server/auth.json` resets the password: set
`SCRIBEDOG_INIT_PASSWORD` again and restart.

### Backups

Because it is a plain folder, back it up like any other folder with the tool
you already use; ScribeDog brings no backup feature of its own. Two things
matter in the choice: the copy should be encrypted (the notes are plain
Markdown), and it should keep history (a note deleted by mistake is only in
yesterday's copy). [restic](https://restic.net) and
[kopia](https://kopia.io) do both and run from a cron job or systemd timer
on the host, outside Docker, for example every night:

```bash
# once: restic init --repo /backup/scribedog   (or an S3/SFTP/rclone target)
0 3 * * * restic --repo /backup/scribedog backup /srv/scribedog/scribedog-data && restic --repo /backup/scribedog forget --keep-daily 14 --keep-weekly 8 --prune
```

Backing up while the app is running is fine: the folder holds small text and
JSON files that are written one at a time, there is no database with locks or
a write-ahead log, so the worst case is one note caught between two saves.

If the host cannot run a cron job (some NAS appliances), a backup container
in the compose file is the alternative: a `restic` or `kopia` image with
`./scribedog-data` mounted read-only and the repository mounted or reachable
over the network, scheduled by its own entrypoint. It is the same backup, just
a heavier way to schedule it.

**What a backup does not cover.** The notes are not encrypted at rest on
purpose (they stay readable with any editor, greppable, free of lock-in), so
whoever gets the disk gets the notes. If that matters where the box stands,
encrypt below the folder rather than in it: full-disk encryption (LUKS on a
server, the SD card of a Raspberry Pi included) or a transparent layer such as
[gocryptfs](https://nuetzlich.net/gocryptfs/) mounted at the bind-mount path.
Both are invisible to ScribeDog. What no file system setting covers is root
on the same host, who can read everything by definition; the server edition
does not try to (that would take client-side encryption, which would break
search and the agent's file tools), so the host's administrator is someone
you trust or yourself.

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

The browser tests drive a real instance, usually the compose stack. The
agent tests need the scripted model that `docker-compose.e2e.yml` adds to it
(`e2e/mock-llm`, reachable to the server as `https://llm.e2e.internal` and to
the tests on port 9081), so start the stack with both files:

```bash
docker compose -f docker-compose.yml -f docker-compose.e2e.yml up -d --build
npx playwright install chromium
SCRIBEDOG_E2E_URL=https://localhost/ SCRIBEDOG_E2E_PASSWORD=... npm run test:e2e
# or, with a base path:
SCRIBEDOG_E2E_URL=https://localhost/anna/ SCRIBEDOG_E2E_PASSWORD=... npm run test:e2e
```

They expect a note `Projects/Roadmap.md` in the vault (override with
`SCRIBEDOG_E2E_NOTE`) and overwrite it. `SCRIBEDOG_E2E_MOCK_URL` points them
at the mock if its port differs. The e2e compose file is for tests only: it
turns certificate checks off in the server container so it accepts the
mock's certificate from Caddy's local CA.

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
