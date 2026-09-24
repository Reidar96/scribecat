<div align="center">

<img src="src/assets/scribecat-logo-animated.svg" alt="ScribeCat logo" width="160">

# ScribeCat

**A clean, self-hosted WYSIWYG Markdown editor.**  
**All AI tools and AI integrations have been removed — plain files, no subscription, no lock-in.**

</div>

ScribeCat is a streamlined Markdown writing environment for people who want the comfort of a visual editor without giving up ordinary files.

Your notes remain plain `.md` files in a normal folder. Images are stored beside the notes in local `_attachments/` folders, tags are stored as portable YAML frontmatter, and the library remains readable outside ScribeCat.

## Highlights

- True WYSIWYG Markdown editing
- Plain Markdown files with no proprietary document format
- File and folder navigation
- Tables, links, images, lists, callouts and formatting
- Search and replace
- Version history
- Import and export
- Auto-save enabled by default, with draft recovery
- Light and dark appearance
- English and Norwegian Bokmål, plus the other bundled interface languages
- Server edition for browser access and self-hosting
- Local offline dictation with whisper.cpp
- Plain relative Markdown links and image paths
- Note-local `_attachments/` folders
- Customizable keyboard shortcuts, including the option to disable individual shortcuts

### Portable tags

ScribeCat supports multiple tags per note. Tags are edited from the Details panel and stored directly in standard YAML frontmatter:

```markdown
---
tags:
  - "project"
  - "important"
  - "work"
---

# My note
```

The YAML metadata is hidden from the WYSIWYG writing surface and from rendered exports such as PDF, DOCX, HTML and print, while remaining part of the original Markdown file.

The file sidebar includes a tag overview with counts. Selecting a tag filters the file list to matching notes.

### Cross-device document locking

A note can be locked against accidental editing. Locks are stored with the vault in:

```text
.scribecat/document-locks.json
```

This means a note locked on one device also opens locked on another device using the same vault. Locks are preserved when notes or folders are renamed or moved.

A locked note remains readable and searchable. The lock icon indicates the state without adding a red tint or border around the document.

### Auto-save

Auto-save is enabled by default for new installations. It can be changed globally under **Settings → General**, and the document menu controls the same setting.

### Flexible writing layout

On desktop and tablet, the file sidebar can be hidden and restored with a dedicated button.

The editor also offers two document-width modes:

- **Full width** — uses the available editor space
- **Compact** — centers the writing area at roughly 900 px for a more comfortable reading and writing width on large screens

The chosen layout is remembered locally on the device.

### Multi-select file operations

The file sidebar includes an explicit selection mode with checkbox-style markers. Multiple notes and folders can be selected and then moved or deleted together.

Keyboard multi-selection is still available, while the visible selection mode makes the same workflow practical on touch devices.

### Server account controls

In the server edition, account actions live under **Settings → Account**. This includes password management, signed-in devices, server certificate information and **Sign out**.

## What ScribeCat intentionally leaves out

All AI writing tools and AI integrations have been removed from ScribeCat: no AI assistant, model selector, AI rewriting, agent chat, knowledge-base AI, model-provider settings, AI OCR, LLM proxy, or AI credential storage.

Local offline dictation is kept as a normal writing feature and runs on the device with whisper.cpp.

The built-in spellcheck feature has also been removed; the editor does not depend on ScribeCat-managed spellcheck dictionaries.

The goal is a quieter writing tool: open a folder, write, organize, and keep the files yours.

## Language

All bundled interface languages are retained. English is the default language for a new installation, and Norwegian Bokmål is included as a complete interface option.

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

Versioned Docker images are published alongside `latest`, for example:

```text
ghcr.io/reidar96/scribecat-server:0.17.1
```

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
