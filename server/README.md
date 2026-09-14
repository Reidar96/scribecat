# ScribeDog Server Edition

Run ScribeDog as a self-hosted web app: your notes live in a folder on your
own server, you edit them in the browser or in the ScribeDog desktop app, and
a single password protects the instance.

> **Status: usable.** The web app is the desktop app's own frontend, so it
> looks and works the same, on a desktop browser as well as on a phone or
> tablet: the file tree, notes and folders, images, sort order, version
> history, live updates when files change on disk, login and password,
> brute-force protection, and the AI features (rewrite, insert, grammar check,
> the chat with its vault agent) with the cloud providers through the server
> or a local model on the device you browse from. The desktop app can open
> the same vault over the network, with its AI and dictation running locally.
> Two things stay desktop only on purpose: the knowledge base (its search
> index runs inside the desktop app) and built-in dictation.

## Documentation

The user guide lives in [`docs/`](docs/README.md):

- [Getting started](docs/getting-started.md): install, first sign-in, the
  certificate, phones.
- [Configuration](docs/configuration.md): settings, path prefix, several
  people on one host, reverse proxies.
- [The desktop app as a client](docs/desktop-app.md)
- [Phones and tablets](docs/phones-and-tablets.md), including dictation.
- [AI](docs/ai.md)
- [Security](docs/security.md)
- [Your data and backups](docs/data-and-backups.md)
- [Updating](docs/updating.md)
- [API](docs/api.md)
- [Development](docs/development.md)
- [FAQ](docs/faq.md)

## Quick start

Requirements: Docker with the Compose plugin.

```bash
cd server
cp .env.example .env         # set SCRIBEDOG_INIT_PASSWORD (8+ characters), PUID/PGID
docker compose up -d --build # creates ./scribedog-data if it is not there
```

Open <https://localhost/> and sign in with the password you set. Your browser
will warn about the certificate on the first visit (Caddy signs it with its
own local CA); [Getting started](docs/getting-started.md) explains how to
import it once, and what to set so the server answers under its network name.

To open the vault in the desktop app, choose "Add server vault…" in the
sidebar's vault menu and enter the same address and password; see
[The desktop app as a client](docs/desktop-app.md).
