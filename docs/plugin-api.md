# ScribeCat plugin architecture (API v1)

ScribeCat stores plugin content as ordinary Markdown. A plugin adds a view over files; disabling it never deletes files. Structured fields use YAML frontmatter, and content remains readable in any Markdown editor. `.scribecat/plugins.json` stores only plugin preferences, pinned shortcuts and folder policies.

## Bundled manifests

`src/plugins/registry.ts` defines the built-in manifest format and the enabled plugins. Every manifest declares `id`, display names, `version`, icon, content/view kind, optional default folder and capabilities. The current IDs are `journal`, `tasks`, `graph`, `quick-notes`, `books`, `shopping`, `recipes` and `inventory`. Up to three enabled plugins may be pinned. The Apps view lists every enabled plugin.

Preferences are per vault. `enabled` hides a plugin's interface when false. `folder`, `showInFiles`, `includeInSearch`, `includeInGraph` and `includeInMove` are resolved through the central path policy. The older Journal and Tasks settings remain readable and are mirrored into the registry, preserving existing vaults and user data. Disabling a plugin does not hide its Markdown files from the normal editor.

## Bundled TypeScript API

`createPluginApi(id, vaultPath, onOpen)` returns a `PluginApiV1` context with `listMarkdown`, `readMarkdown`, `saveMarkdown`, `openMarkdown` and `policyFor`. The host checks the active vault, enabled state, declared capability, `.md` extension and owning folder on each operation. `saveMarkdown` uses the application's file store so drafts, versions and file lists stay in sync. Built-in content views can use this API to work with their own files. Direct filesystem APIs are not a plugin permission boundary for code bundled into the application.

Example Markdown:

```markdown
---
scribecat-plugin: recipes
type: recipe
title: Focaccia
slug: focaccia
servings: 6
published: false
---

# Focaccia

## Ingredienser

- 500 g mel

## Fremgangsmåte

1. Bland ingrediensene.
```

Use relative image links in Markdown and ScribeCat's existing `_attachments` folders. Do not put required content in an opaque plugin database. Caches must be rebuildable from Markdown.

## Public View

The server's `/public/recipes` and `/public/recipes/:slug` routes are separate from the authenticated vault API. They require `recipes.enabled`, `recipes.publicView`, and a recipe file with `scribecat-plugin: recipes`, `type: recipe`, `published: true` and a valid explicit slug. Published recipes are re-read from Markdown. The server escapes HTML, does not expose private Markdown link destinations, sets a restrictive CSP and serves only referenced images through a document-scoped token with a size and image-type limit. The public routes cannot write, enumerate the vault, search private notes or read arbitrary attachment paths. Turning off Public View, disabling Recipes or setting `published: false` revokes access on the next request. Configure HTTPS and access control at the deployment boundary as needed.

## External plugins (later phase)

API v1 currently runs **bundled, trusted plugins only**. Installing third-party executable code requires a separate isolated runtime, capability enforcement outside the plugin's own process, signed or otherwise verified packages, API version compatibility checks, lifecycle management, restricted attachment/search hooks, and clear user consent. The current TypeScript types are a starting contract, not a promise that arbitrary third-party JavaScript is safe to load. An external plugin should not be installed by copying code into the vault.
