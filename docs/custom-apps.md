# Egne apper i ScribeCat

Egne apper bruker et deklarativt manifest og lagrer poster som leselige Markdown-filer. ZIP-filen skal ha `manifest.json` på øverste nivå. Åpne Innstillinger → Apper og velg ZIP-filen.

Eksempel på `manifest.json`:

```json
{
  "schemaVersion": 1,
  "id": "mine-planter",
  "name": "Mine planter",
  "description": "En enkel oversikt over plantene.",
  "folder": "Mine planter",
  "fields": [
    { "key": "sted", "label": "Sted" },
    { "key": "stell", "label": "Stell", "multiline": true }
  ]
}
```

En post lagres i innholdsmappen:

```markdown
# Basilikum

## sted

Kjøkkenvindu

## stell

Vann når jorden er tørr.
```

Appens manifest installeres under `.scribecat/plugins/mine-planter/manifest.json`. Fjernes den mappen, forsvinner appen fra appvelgeren. Innholdsmappen beholdes når appen fjernes fra innstillingene. Eksisterende innebygde apper påvirkes ikke.

Sikkerhetsgrense: ZIP-importen leser kun manifestet. JavaScript, HTML, CSS og andre ZIP-filer kjøres eller installeres ikke. Feltnøkler er stabile identifikatorer, så endring av en nøkkel gjør at eldre Markdown-data ikke lenger vises i feltet.
