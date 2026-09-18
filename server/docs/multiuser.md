# Multiple users on one host

ScribeDog has one password and one vault per instance, on purpose: there are
no accounts, no sharing rules and no permissions to get wrong. Two or more
people on one box therefore get one instance each, every one under its own
path prefix, behind a single shared Caddy.
[`examples/multi-instance/`](../examples/multi-instance/) is a complete
compose file for that: two ready-made slots, `PERSON1` and `PERSON2`
(`anna`/`bob` by default), as a starting template.

Starting here right away, even for a single person, saves you the later move
described below. To rename a person, change `PERSON1_BASE_PATH` in `.env`
(the one place their URL-facing name lives, driving both
`docker-compose.yml` and the Caddyfile without editing either) and, if you
want the data folder renamed to match, `PERSON1_DATA_DIR` too. Adding or
removing a person still means copying or deleting a numbered block by hand
in `docker-compose.yml` and the Caddyfile (not a single command), but it is
copying a number, not renaming strings across three files, and the
instances you are not touching keep running throughout.

Pick the section below that matches your situation.

## Setting it up from scratch

### 1. Get the three files the compose stack needs

```bash
mkdir -p scribedog-multi && cd scribedog-multi
curl -fsSL -o docker-compose.yml https://raw.githubusercontent.com/snooky234/scribedog/main/server/examples/multi-instance/docker-compose.yml
curl -fsSL -o Caddyfile https://raw.githubusercontent.com/snooky234/scribedog/main/server/examples/multi-instance/Caddyfile
curl -fsSL -o .env https://raw.githubusercontent.com/snooky234/scribedog/main/server/examples/multi-instance/.env.example
```

Starting with a different number of people than two? Do this next, before
your first `docker compose up`:

- **Just one person:** delete `PERSON2`'s parts: its two lines in `.env`,
  its `scribedog-2` block in `docker-compose.yml` (plus its entry in
  `depends_on` and in Caddy's `environment:`), and its `handle` block in
  the Caddyfile.
- **More than two people:** copy a `PERSON<N>` slot the same way
  [Adding another person later](#adding-another-person-later) describes,
  just before your first start instead of after.

### 2. Open `.env` and set

- `PERSON1_INIT_PASSWORD` and `PERSON2_INIT_PASSWORD`: eight characters or
  more each, or that instance rejects it and keeps restarting.
- `PERSON1_BASE_PATH` and `PERSON2_BASE_PATH`: where each instance
  answers, e.g. `/anna`. Change these to rename a person.
- `PERSON1_DATA_DIR` and `PERSON2_DATA_DIR`: the data folder name,
  `anna-data` and `bob-data` by default. Renaming `BASE_PATH` does not
  rename this too, so change it as well if you want the folder to match
  (or leave it if you don't care, or are pointing it at a folder you
  already have, see [Moving an existing single instance
  here](#moving-an-existing-single-instance-here)).
- `SCRIBEDOG_SITE_ADDRESS`: the box's LAN IP or host name, not `localhost`,
  unless every person opens the app on this same machine (see
  [Getting started](getting-started.md#install)).
- `SCRIBEDOG_HTTP_PORT` / `SCRIBEDOG_HTTPS_PORT`: only if 80/443 are
  already used on this host (see
  [Troubleshooting](getting-started.md#troubleshooting)).

### 3. Start it

```bash
docker compose pull
docker compose up -d
```

Or clone the repository and run `docker compose up -d --build` to build from
source instead (same trade-off as [Getting started](getting-started.md#install)).

This serves `https://<host>/anna/` and `https://<host>/bob/` (or whatever you
set `PERSON1_BASE_PATH` / `PERSON2_BASE_PATH` to) from two containers with
two data folders (`anna-data`, `bob-data` by default). Each instance has its
own password and its own session cookie, scoped to its prefix, so signing in
to one says nothing about the other.

## Next steps

Sign in at each instance's own address, `https://<host>/<name>/` instead of
the bare `https://<host>/`. From there, [Getting started](getting-started.md)
applies unchanged, one instance at a time:

- `docker compose up` failed? [Troubleshooting](getting-started.md#troubleshooting)
  covers the common port conflict.
- [First sign-in](getting-started.md#first-sign-in): the first login and the
  `Welcome.md` note that instance starts with.
- [The certificate warning](getting-started.md#the-certificate-warning): why
  the browser warns, and how to trust Caddy's local CA instead of clicking
  through it every time.
- [On a phone](getting-started.md#on-a-phone) and
  [in the desktop app](getting-started.md#on-your-computer-in-the-desktop-app):
  using that instance outside the browser.
- [What next](getting-started.md#what-next): configuration, AI providers, and
  backups, per instance.

## Adding another person later

1. Open `docker-compose.yml` and:
   - Copy the last `scribedog-<N>` service block, bump the number
     (`scribedog-2` copied becomes `scribedog-3`), and point its
     `SCRIBEDOG_BASE_PATH`, `SCRIBEDOG_INIT_PASSWORD`, `PUID`, `PGID` and
     volume at the matching `PERSON3_*` variables.
   - Add `- scribedog-3` to the `caddy` service's `depends_on:` list.
   - Add `PERSON3_BASE_PATH: ${PERSON3_BASE_PATH:-/PERSON3_UNSET}` to the
     `caddy` service's `environment:` block, next to
     `PERSON1_BASE_PATH` / `PERSON2_BASE_PATH`.
2. Open the Caddyfile and add a matching block next to the existing ones,
   again just the next number:
   ```caddyfile
   handle {$PERSON3_BASE_PATH:/PERSON3_UNSET}* {
       reverse_proxy scribedog-3:3000
   }
   ```
3. Open `.env` and add `PERSON3_INIT_PASSWORD=` (eight characters or more)
   and `PERSON3_BASE_PATH=/carol` (or whatever path you want).
4. Run `docker compose up -d`. This starts only the new container; the
   running ones are untouched. The fallback 404 (a client without a prefix)
   is deliberately generic and does not list instances, so nothing else in
   the Caddyfile needs touching for this.

## Removing a person

1. If you want to keep their notes, back up the data folder now (e.g.
   `./bob-data`); removing the service does not delete it, but do this before
   you forget.
2. Remove that `PERSON<N>` service block from `docker-compose.yml` (and drop
   it from Caddy's `depends_on` and from Caddy's `environment:` block).
3. Remove the matching `handle {$PERSON2_BASE_PATH:/bob}* { ... }` block
   from the Caddyfile.
4. Remove that person's `PERSON<N>_*` variables from `.env`.
5. Run `docker compose up -d --remove-orphans`. This stops and removes the
   now-undefined container in one step; the remaining instances keep running.
6. Delete `./bob-data` once you are sure you no longer need it, or after
   moving it elsewhere per step 1.

## Moving an existing single instance here

Your notes are not at risk: the data folder is untouched by any of this until
step 4, and even then it is a move, not a copy.

1. Stop the single instance: `docker compose down` in its folder.
2. Get the three multi-instance files into a new folder, as in step 1 of
   "Setting it up from scratch" above.
3. Move that person's data folder (`./scribedog-data` in the single-instance
   default) next to the new files, and change `PERSON1_DATA_DIR` in `.env` to
   its name (e.g. `PERSON1_DATA_DIR=scribedog-data`) so nothing needs
   renaming on disk. Set `PERSON1_BASE_PATH` to a path for that person (their
   old address if `SCRIBEDOG_BASE_PATH` was already set, otherwise pick one,
   e.g. `/anna`) and `PERSON1_PUID`/`PERSON1_PGID` to whatever the single
   instance used (its own `.env` already had these).
4. Fill in `PERSON2_*` for the second person (see step 2 of "Setting it up
   from scratch"), and match `SCRIBEDOG_SITE_ADDRESS` and the ports to what
   the existing instance already had.
5. Start it: `docker compose up -d` (or `--build` if you build from source).

If the single instance served the bare `https://<host>/` before
(`SCRIBEDOG_BASE_PATH` empty), it now answers under `PERSON1_BASE_PATH`
instead. Update any bookmarks and the desktop app's server-vault connection
to the new address.

## Caddyfile details

Two things are worth knowing if you write your own Caddyfile instead of the
bundled one:

- The instances are routed with `handle`, not `handle_path`: the prefix has
  to reach the container intact, because the app answers under it and would
  otherwise neither find its assets nor scope its cookie.
- A browser that opens the site by IP address sends no server name, and with
  more than one site Caddy needs `default_sni` to pick a certificate (see
  `SCRIBEDOG_DEFAULT_SNI` in [Configuration](configuration.md)).

## Keeping the folders apart

The data folders are plain folders on the host, so whoever can read
`anna-data` can read that person's notes. If the people sharing the box also
have shell access to it, give every instance its own Linux user and folder
permissions to match:

```bash
sudo useradd --system --no-create-home anna
sudo mkdir anna-data && sudo chown anna:anna anna-data && sudo chmod 700 anna-data
id anna                       # -> PERSON1_PUID / PERSON1_PGID in .env
```

The container starts as root, hands the folder to that user and drops to it,
so the files it writes stay that user's. This keeps ordinary users out of
each other's notes; it does not keep root out, and nothing on the host can
(see [Security](security.md)).
