# Getting started

## What you need

- A machine that runs [Docker](https://docs.docker.com/engine/install/) with
  the [Compose plugin](https://docs.docker.com/compose/install/linux/): a home
  server, a Raspberry Pi (64-bit), a NAS with Docker, a small cloud VM.
- A folder for your notes. Docker creates it if it does not exist.
- Five minutes.

## Install

Two ways to get it running.

**Option 1: published image from GHCR** (recommended, especially on a
Raspberry Pi or other modest hardware, no build step). Get the three files
the compose stack needs:

```bash
mkdir -p scribedog-server/caddy && cd scribedog-server
curl -fsSL -o docker-compose.yml https://raw.githubusercontent.com/snooky234/scribedog/v0.12.0/server/docker-compose.yml
curl -fsSL -o caddy/Caddyfile https://raw.githubusercontent.com/snooky234/scribedog/v0.12.0/server/caddy/Caddyfile
curl -fsSL -o .env https://raw.githubusercontent.com/snooky234/scribedog/v0.12.0/server/.env.example
```

Open `.env` and set two things:

- `SCRIBEDOG_INIT_PASSWORD`: the password for the first start, eight
  characters or more. It is only used until a password exists in the data
  folder; after that the server ignores it (and says so in the log), so you
  can remove it from the file later.
- `PUID` and `PGID`: the user and group your notes should belong to on the
  host, usually your own (`id -u` and `id -g`). The container hands the data
  folder to these ids, so the files stay yours.

`SCRIBEDOG_IMAGE` is already set to the current version, so there is nothing
to change there for the latest release. Two reasons you might still touch it:
you would rather pull from Docker Hub than GHCR (same image, set it to
`snooky234/scribedog-server:0.12.0`, no registry host needed in the name), or
you want an older version on purpose (pin that tag instead).

Then start it:

```bash
docker compose pull
docker compose up -d
```

**Option 2: build from source** instead, cloning the whole repository:

```bash
git clone https://github.com/snooky234/scribedog.git
cd scribedog/server
cp .env.example .env
```

Open `.env` and set three things: `SCRIBEDOG_INIT_PASSWORD` and `PUID`/`PGID`
as in option 1, plus `SCRIBEDOG_IMAGE`: empty it (it comes pre-filled from
`.env.example`) so Compose builds instead of pulling.

Then start it:

```bash
docker compose up -d --build
```

This compiles the whole frontend and server on that machine, which is a few
minutes on a normal PC and considerably longer, sometimes tight on RAM, on a
Pi.

Either way, this creates `./scribedog-data` if it is not there and starts two
containers: the ScribeDog server and Caddy, which provides HTTPS.

If that fails with `port is already allocated`, something else on that
machine already uses port 80 or 443 (Pi-hole, another reverse proxy, a NAS
admin UI). Run `docker compose down` first, then set `SCRIBEDOG_HTTP_PORT`
and `SCRIBEDOG_HTTPS_PORT` in `.env` to a free pair, e.g. `8080` and `8443`,
and start it again; see [Configuration](configuration.md) for both variables.

## First sign-in

Open <https://localhost/> on the machine itself, or `https://<name-or-IP>/`
from another device on your network, and sign in with the password you set.
On the very first start with an empty folder the server creates a
`Welcome.md` so there is something to open.

If you open the app from another device, tell Caddy the address it is reached
under: set `SCRIBEDOG_SITE_ADDRESS` in `.env` to the host name or IP of the
box (several, separated by commas, if it has more than one) and run
`docker compose up -d` again. See [Configuration](configuration.md).

## The certificate warning

Your browser will warn about the certificate on the first visit: Caddy signs
it with its own local certificate authority (CA), because there is no public
domain to get a certificate for. You can accept the warning, or import the
CA once so every browser on the device trusts it (and, if you use it, the
[desktop app](desktop-app.md), which needs the CA in the system store):

```bash
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt
```

Then add `caddy-root.crt` to the trust store:

| Where | How |
| --- | --- |
| Windows | Double-click the file, "Install Certificate", current user, "Place all certificates in the following store", *Trusted Root Certification Authorities*. Confirm the security warning. |
| macOS | Double-click the file to add it to Keychain Access, open it there and set "When using this certificate" to *Always Trust*. |
| Linux | Depends on the distribution; for Debian and Ubuntu copy it to `/usr/local/share/ca-certificates/caddy-root.crt` and run `sudo update-ca-certificates`. Firefox has its own store: Settings, Privacy & Security, Certificates, View Certificates, Import. |
| Android | Settings, Security, Encryption & credentials, Install a certificate, CA certificate. |
| iOS | Open the file (send it to the device by mail or AirDrop), install the profile under Settings, then enable it under Settings, General, About, Certificate Trust Settings. |

With a public domain and ports 80 and 443 reachable from the internet you can
skip all this: set `SCRIBEDOG_SITE_ADDRESS` to the domain and `SCRIBEDOG_TLS`
to your e-mail address, and Caddy obtains a Let's Encrypt certificate.

## On a phone

Open the same address in the phone's browser and sign in. Add the site to
the home screen (Chrome: "Add to Home screen"; Safari: share sheet, "Add to
Home Screen") and it opens without the browser chrome, like an app. You stay
signed in for 60 days of use. More in [Phones and tablets](phones-and-tablets.md).

## On your computer, in the desktop app

If you use ScribeDog on the desktop, you do not have to use the browser at
all: the desktop app can open the server's vault directly, with AI and
dictation running on your computer. See
[The desktop app as a client](desktop-app.md).

## What next

- [Configuration](configuration.md) if the box is reached under a name or
  IP, if you want a path prefix, or several people share one host.
- [AI](ai.md) to connect a cloud provider or a model on your own device.
- [Your data and backups](data-and-backups.md) before the notes become
  important.
