# ScribeCat Server Edition

Run ScribeCat as a self-hosted web app: your notes live in a folder on your
own server, you edit them in the browser or in the ScribeCat desktop app, and
a single password protects the instance.

## Your workspace, on your own server

Bring ScribeCat's visual Markdown editor, calendar, tasks and graph to your browser. Keep notes and attachments on your own disk or NAS, open them on a phone or tablet, and connect the desktop app to the same vault.

- Ordinary Markdown files with portable links and tags.
- Password sign-in, session management and live file updates.
- Docker deployment with the supplied Caddy HTTPS configuration.
- The same core workspace as the desktop app, with responsive layouts.

Local offline dictation remains a desktop feature. ScribeCat does not include AI writing assistants, chat agents or model-provider integrations.

[See the product overview](../README.md) · [Browse all features](../docs/features.md)

## Documentation

The user guide lives in [`docs/`](docs/README.md):

- [Getting started](docs/getting-started.md): install, first sign-in, the
  certificate, phones.
- [Configuration](docs/configuration.md): settings, path prefix, several
  people on one host, reverse proxies.
- [The desktop app as a client](docs/desktop-app.md)
- [Phones and tablets](docs/phones-and-tablets.md), including dictation.
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
cp .env.example .env         # set SCRIBECAT_INIT_PASSWORD (8+ characters), PUID/PGID
docker compose up -d # creates ./scribecat-data if it is not there
```

Open <https://localhost/> and sign in with the password you set. Your browser
will warn about the certificate on the first visit (Caddy signs it with its
own local CA); [Getting started](docs/getting-started.md) explains how to
import it once, and what to set so the server answers under its network name.

To open the vault in the desktop app, choose "Add server vault…" in the
sidebar's vault menu and enter the same address and password; see
[The desktop app as a client](docs/desktop-app.md).
