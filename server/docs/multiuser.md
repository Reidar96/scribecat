# Multiple users on one host

ScribeDog has one password and one vault per instance, on purpose: there are
no accounts, no sharing rules and no permissions to get wrong. Two or more
people on one box therefore get one instance each, every one under its own
path prefix, behind a single shared Caddy.
[`examples/multi-instance/`](../examples/multi-instance/) is a complete
compose file for that (two instances, `anna` and `bob`, as a starting
template).

Starting here right away, even for a single person, saves you the later move
described below. Adding, and removing, a person is not fully automatic
either way: it is copying and renaming one service block in
`docker-compose.yml` and one `handle` block in the Caddyfile by hand each
time, not a single command, though the instances you are not touching keep
running throughout.

Pick the section below that matches your situation.

## Setting it up from scratch

1. Get the three files the compose stack needs:
   ```bash
   mkdir -p scribedog-multi && cd scribedog-multi
   curl -fsSL -o docker-compose.yml https://raw.githubusercontent.com/snooky234/scribedog/main/server/examples/multi-instance/docker-compose.yml
   curl -fsSL -o Caddyfile https://raw.githubusercontent.com/snooky234/scribedog/main/server/examples/multi-instance/Caddyfile
   curl -fsSL -o .env https://raw.githubusercontent.com/snooky234/scribedog/main/server/examples/multi-instance/.env.example
   ```
   `anna` and `bob` are placeholder names in all three files; rename them to
   whatever you like, as long as the name stays consistent across
   `docker-compose.yml`, the Caddyfile and `.env`. Want to start with just one
   person, or more than two? Remove or copy a service block (plus its
   Caddyfile `handle` block and its two `.env` lines) the same way
   [Removing a person](#removing-a-person) or
   [Adding another person later](#adding-another-person-later) describe,
   before your first `docker compose up` instead of after.
2. Open `.env` and set:
   - `ANNA_INIT_PASSWORD` and `BOB_INIT_PASSWORD`: eight characters or more
     each, or that instance rejects it and keeps restarting.
   - `SCRIBEDOG_SITE_ADDRESS`: the box's LAN IP or host name, not `localhost`,
     unless every person opens the app on this same machine (see
     [Getting started](getting-started.md#install)).
   - `SCRIBEDOG_HTTP_PORT` / `SCRIBEDOG_HTTPS_PORT`: only if 80/443 are
     already used on this host (see
     [Troubleshooting](getting-started.md#troubleshooting)).
3. Start it:
   ```bash
   docker compose pull
   docker compose up -d
   ```
   Or clone the repository and run `docker compose up -d --build` to build
   from source instead (same trade-off as
   [Getting started](getting-started.md#install)).

This serves `https://<host>/anna/` and `https://<host>/bob/` from two
containers with two data folders (`anna-data`, `bob-data`). Each instance has
its own password and its own session cookie, scoped to its prefix, so signing
in to one says nothing about the other.

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

1. In `docker-compose.yml`, copy one service block and rename it:
   `scribedog-bob` becomes `scribedog-<name>`, its `SCRIBEDOG_BASE_PATH`
   becomes `/<name>`, its `SCRIBEDOG_INIT_PASSWORD` points at a new
   `<NAME>_INIT_PASSWORD` variable, its `PUID`/`PGID` use ids not already in
   use, and its volume becomes `./<name>-data:/data`.
2. Add the new service to Caddy's `depends_on` list.
3. In the Caddyfile, add a matching block next to the existing ones:
   ```caddyfile
   handle /<name>* {
       reverse_proxy scribedog-<name>:3000
   }
   ```
4. Still in the Caddyfile, add the new instance to the fallback `handle`
   block too (the message a client without a prefix gets). This does not
   affect routing, but the message goes stale otherwise.
5. Add `<NAME>_INIT_PASSWORD=` (eight characters or more) to `.env`.
6. Run `docker compose up -d`. This starts only the new container; the
   running ones are untouched.

## Removing a person

1. If you want to keep their notes, back up the data folder now (e.g.
   `./bob-data`); removing the service does not delete it, but do this before
   you forget.
2. Remove that service block from `docker-compose.yml` (and drop it from
   Caddy's `depends_on`).
3. Remove the matching `handle /bob* { ... }` block from the Caddyfile, and
   drop that person from the fallback `handle` block's message.
4. Remove `BOB_INIT_PASSWORD` (and `BOB_PUID`/`BOB_PGID` if you set them)
   from `.env`.
5. Run `docker compose up -d --remove-orphans`. This stops and removes the
   now-undefined container in one step; the remaining instances keep running.
6. Delete `./bob-data` once you are sure you no longer need it, or after
   moving it elsewhere per step 1.

## Moving an existing single instance here

Your notes are not at risk: the data folder is untouched by any of this until
step 4.

1. Stop the single instance: `docker compose down` in its folder.
2. Get the three multi-instance files into a new folder, as in step 1 of
   "Setting it up from scratch" above.
3. In the new `docker-compose.yml`, rename one service (`scribedog-anna` by
   default) to match the person who already has it: its container name, its
   `SCRIBEDOG_BASE_PATH`, and its volume path.
4. Move that person's data folder (`./scribedog-data` in the single-instance
   default) into the new volume path, e.g. `./<name>-data`.
5. Fill in `.env` for both people (see step 2 of "Setting it up from
   scratch"), matching the site address and ports you already had for the
   existing instance.
6. Start it: `docker compose up -d` (or `--build` if you build from source).

If the single instance served the bare `https://<host>/` before
(`SCRIBEDOG_BASE_PATH` empty), it now answers under its own prefix instead,
like the other instance. Update any bookmarks and the desktop app's
server-vault connection to the new address.

## Caddyfile details

Two things are worth knowing if you write your own Caddyfile instead of the
bundled one:

- The instances are routed with `handle /anna*`, not `handle_path`: the
  prefix has to reach the container intact, because the app answers under it
  and would otherwise neither find its assets nor scope its cookie.
- A browser that opens the site by IP address sends no server name, and with
  more than one site Caddy needs `default_sni` to pick a certificate (see
  `SCRIBEDOG_DEFAULT_SNI` in [Configuration](configuration.md)).

## Keeping the folders apart

The data folders are plain folders on the host, so whoever can read
`anna-data` can read Anna's notes. If the people sharing the box also have
shell access to it, give every instance its own Linux user and folder
permissions to match:

```bash
sudo useradd --system --no-create-home anna
sudo mkdir anna-data && sudo chown anna:anna anna-data && sudo chmod 700 anna-data
id anna                       # -> the ANNA_PUID / ANNA_PGID for .env
```

The container starts as root, hands the folder to that user and drops to it,
so the files it writes stay that user's. This keeps ordinary users out of
each other's notes; it does not keep root out, and nothing on the host can
(see [Security](security.md)).
