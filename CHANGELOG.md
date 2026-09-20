# Changelog

All notable changes to ScribeDog are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/).

## [0.13.1] - 2026-09-20

### Bug Fixes
- Stop code block controls from covering the first line: the copy and language buttons now sit as two small badges on the block's top edge and only show while the caret is inside the block

## [0.13.0] - 2026-09-20

### Highlights
- Highlight text with a marker (`==text==`): toolbar button, Ctrl+Shift+H, or a marker mode for the pointer; the highlight goes into every export
- Auto-save (off by default): saves the note after a pause in typing and on the way out of a note
- Paste Markdown: pasted plain text with Markdown markers becomes headings, lists, tables and bold right away; Ctrl+Shift+V pastes the raw text
- Check spelling and grammar of the whole document without selecting text first (Ctrl+Shift+X)
- Zen mode text zoom: pinch on touch screens, Ctrl+wheel on the desktop, remembered separately from the document font size

### Improvements
- Show the note title as a breadcrumb; with folder notes on, each crumb opens that folder's note
- File tree: hide the .md extension, drop the file icons, add "New folder" to the context menu
- Heading numbering: choose whether numbers show everywhere or only in the outline, and whether the `{-}` marker is always visible or only in the heading being edited (#47)
- Add undo and redo buttons to the toolbar
- Phone layout: group the AI actions into one menu and move the AI quick settings into Settings
- Swipe from the left edge to open the file list on phones, swipe back to close it
- Download the server certificate from Settings, Account in the browser, with a short explanation and a link to the install guide
- Slightly lighter default text in the dark theme
- Grammar check now tolerates the loose JSON of small local models (prose around the array, fences mid-sentence, list-shaped answers)
- AI error messages can be dismissed with an X
- Disable page pinch zoom on phones and tablets; the layout is built for the width it has

### Bug Fixes
- Fix code blocks hanging the tab on Android
- Fix the on-screen keyboard opening on Android when ticking a checkbox or tapping an image
- Fix extra spacing below indented checkboxes that sometimes remained after removing them
- Fix Ctrl+Shift+Up/Down not moving a list item past a blockquote, image or paragraph next to the list

## [0.12.2] - 2026-09-19

### Bug Fixes
- Fix the app failing to load a note (and then failing to start at all) once it contains an image whose file name is purely numeric, such as photos from a phone camera

## [0.12.1] - 2026-09-19

### Highlights
- Add image picker on mobile/web and rework phone toolbar
- Serve the CA certificate over HTTPS for direct download

### Improvements
- Make docker-compose.yml's data dir fallback generic
- Rename person slots and make base paths env-driven

### Bug Fixes
- Keep context menu closed on Android double-tap selection

## [0.12.0] - 2026-09-18

### Highlights
- Add ScribeDog Server Edition: run ScribeDog as a self-hosted web app with a full file API, live updates, and a PUID/PGID Docker entrypoint
- Open a vault on a ScribeDog server directly from the desktop app, next to local folders
- Let a remote vault download notes and folders directly
- Enable folder notes
- Add automatic heading numbering

### Improvements
- Restructure the settings dialog into grouped settings pages
- Add a duplicate-file action to the file tree context menu
- Add a selection context menu with copy variants / copy a selection as Markdown or bare text on touch
- Add a paper-white surface option for dark theme

### Bug Fixes
- Fix outline active-heading detection at the scroll limit
- Scale default text opacity per theme
- Keep inline marks when only part of a block is serialized
- Pick a certificate for browsers that open the site by IP
- Keep a note ending in a code block clean on open

## [0.11.0] - 2026-09-12

### Highlights
- Add a live outline to the details panel: jump to any heading with a click or the keyboard, tracks the section you're in as you type or scroll

## [0.10.1] - 2026-09-11

### Bug Fixes
- Report skipped plan steps instead of always marking them done

## [0.10.0] - 2026-09-02

### Highlights
- Add a portable Windows build (ScribeDog_X.Y.Z_portable.zip) alongside the installer: no installation, no admin rights, no registry entries or Start Menu shortcuts.

## [0.9.1] - 2026-08-25

### Bug Fixes
- Fix AI chat failing with Ollama after a tool was used ("Value looks like object, but can't find closing '}' symbol")

## [0.9.0] - 2026-08-05

### Highlights
- Add a vault-wide chat agent with staged changes, checkpoints, and file tools (read, write, edit, rename, delete, search) across the whole vault, not just the open document

## [0.8.3] - 2026-07-30

### Bug Fixes
- Fix local AI connections (Ollama, Jan.ai, LM Studio) returning 403 in the installed app, while working fine in development

## [0.8.2] - 2026-07-30

### Highlights
- Enable find/replace without an open file, with cumulative folder match badges when searching across the vault
- Default the file tree to Manual sort order, so drag & drop works right away — the starting order is the familiar folders-first alphabetical one

### Improvements
- Add spacing to the shortcuts-settings dialog

### Bug Fixes
- Normalize pasted slices with stray hard breaks

## [0.8.1] - 2026-07-29

### Highlights
- Add fuzzy/approximate text matching with punctuation tolerance
- Add theme boot and enhance import/drag-drop UX
- Add retrieval-augmented generation with indexing

### Improvements
- Consolidate shortcuts into settings dialog

## [0.8.0] - 2026-07-28

### Highlights
- RAG: retrieval-augmented generation with document indexing and search
- RAG: knowledge base folder controls and file attachments
- Chat: handle links in AI-generated answers

## [0.7.1] - 2026-07-27

### Highlights
- Add details panel showing document stats (word count, reading time), links, and backlinks
- Improve PDF export quality with manuscript rendering and expanded font support

## [0.7.0] - 2026-07-26

### Highlights
- Add AI chat panel with agent tools and context management
- Add request timeout and running indicator for active session
- Add document versioning with diff preview and restore
- Add document links, navigation history, and customizable shortcuts

## [0.6.0] - 2026-07-23

### Highlights
- Add zen mode for distraction-free writing

## [0.5.4] - 2026-07-23

### Highlights
- Add code language picker for syntax highlighting

### Bug Fixes
- Write grammar-check explanations in the app UI language
- Honor the image display width in PDF, DOCX and ODT export
- Stop moving a file from deleting its images
- Never rewrite image paths that point outside the vault
- Persist rewritten image paths when moving an opened file

## [0.5.3] - 2026-07-22

### Bug Fixes
- Voice transcription is roughly 4x faster — whisper.cpp was being built
  without optimizations in release binaries

## [0.5.2] - 2026-07-20

### Improvements
- AI thinking mode is now disabled by default

## [0.5.1] - 2026-07-19

Improve voice transcription performance and language handling.

## [0.5.0] - 2026-07-19

### Highlights
- Add voice input with model download and streaming transcription
- Add custom assistants management with templates and settings
- Add zoom control, find/replace panel, and improved UI toggles

## [0.4.1] - 2026-07-19

### Highlights
- Add document printing with print-optimized styling
- Add file selection and batch delete/export operations

## [0.4.0] - 2026-07-18

### Highlights
- Add document import for PDF, DOCX, HTML with image extraction
- Add export to PDF, DOCX, ODT, HTML with emoji and sans-serif styling

## [0.3.0] - 2026-07-14

### Highlights
- Add AI-powered spelling and grammar check
- Add support for 10 languages: English, German, Spanish, French, Italian, Japanese, Portuguese, Russian, Ukrainian, and Chinese

## [0.2.0] - 2026-07-13

### Highlights
- Add AI diff review interface for before-accept workflow
- Add drag-and-drop file organization with vault metadata

## [0.1.0] - 2026-07-12

### Highlights
- Initial release of ScribeDog
