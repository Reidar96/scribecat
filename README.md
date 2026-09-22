<div align="center">

<img src="src/assets/scribecat-logo-animated.svg" alt="ScribeCat logo" width="160">

# ScribeCat

**A clean, self-hosted WYSIWYG Markdown editor.**  
**All AI tools and AI integrations have been removed — plain files, no subscription, no lock-in.**

</div>

ScribeCat is a streamlined Markdown writing environment for people who want the comfort of a visual editor without giving up ordinary files.

Your notes remain plain `.md` files in a normal folder. Images are stored beside the notes in local `_attachments/` folders, so the library remains portable and readable outside ScribeCat.

## What ScribeCat keeps

- True WYSIWYG Markdown editing
- File and folder navigation
- Tables, links, images, lists, callouts and formatting
- Search and replace
- Version history
- Import and export
- Auto-save and draft recovery
- Light and dark appearance
- Multiple interface languages
- Server edition for browser access
- Plain relative Markdown links and image paths
- Note-local `_attachments/` folders

## What ScribeCat intentionally leaves out

All AI writing tools and AI integrations have been removed from ScribeCat: no AI assistant, model selector, AI rewriting, agent chat, knowledge-base AI, model-provider settings, AI OCR, LLM proxy, or AI credential storage.

Local offline dictation is kept as a normal non-AI writing feature. The goal is a quieter writing tool: open a folder, write, organize, and keep the files yours.

## Language

All bundled interface languages are retained. English is the default language for a new installation.

## File layout

A note and its images can live together like this:

```text
Notes/
└── 2026/
    ├── September.md
    └── _attachments/
        └── photo.jpg
```

The Markdown remains standard and relative:

```markdown
![](_attachments/photo.jpg)
```

## Server edition

The server edition is designed to run against an ordinary folder, including a NAS bind mount.

Example:

```yaml
services:
  scribecat:
    image: ghcr.io/reidar96/scribecat-server:latest
    container_name: ScribeCat
    ports:
      - 8117:3000
    volumes:
      - /volume1/notes:/data:rw
    environment:
      TZ: Europe/Oslo
      PUID: 0
      PGID: 0
      SCRIBECAT_INIT_PASSWORD: "CHANGE-ME"
      SCRIBECAT_VAULT_PATH: /data
      SCRIBECAT_HOST: 0.0.0.0
      SCRIBECAT_PORT: 3000
      SCRIBECAT_COOKIE_SECURE: "false"
      SCRIBECAT_TRUST_PROXY: "false"
    restart: unless-stopped
```

For a first start, use a strong password and remove `SCRIBECAT_INIT_PASSWORD` from the Compose file after the server has initialized its authentication data.

## Development

The web frontend can be checked with:

```bash
npm ci
npm run build:web
```

The server can be checked with:

```bash
cd server
npm ci
npm run build
```

The Docker server image is built from `server/Dockerfile`.

## Origin and license

ScribeCat is based on **ScribeDog**, created by the ScribeDog project and distributed under the MIT License. ScribeCat is an independent streamlined adaptation and is not presented as the upstream ScribeDog project.

The original copyright and MIT license are preserved in [LICENSE](LICENSE). Third-party notices remain in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

ScribeDog upstream: https://github.com/snooky234/scribedog
