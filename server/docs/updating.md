# Updating

## Versions

As with any update, back up the data folder first (see
[Backups](data-and-backups.md#backups)), so a bad update is a restore, not a
loss.

Images are published per version and also keep a moving `latest` tag for
convenience. The Compose file defaults to the current published version, so a
plain pull gets the same release as the desktop app. To pin another version,
put it in `.env`:

```dotenv
SCRIBECAT_IMAGE=ghcr.io/reidar96/scribecat-server:0.25.3
```

Then update with:

```bash
docker compose pull
docker compose up -d
```

For a repository checkout, building from source instead works as well:

```bash
git pull
docker compose up -d --build
```

When you use a versioned image, `docker compose pull` fetches that exact
server/frontend build; it does not depend on whatever image happens to be
left locally from an older release.

Sessions and the desktop apps' access keys survive restarts and updates;
nobody has to sign in again.

## The desktop app and the server

Both come from the same repository and share its version number. Keep them
at the same version where you can; when a release needs the two updated
together (the desktop app needs a route the older server does not have, or
the other way round), the release notes say so.

## Going back a version

Going back is fine as long as the data folder's layout has not moved on. The
server writes its layout version to `.scribecat/server-data-version`, brings
an older folder forward on start, and refuses to start on a folder written by
a newer server rather than reading a format it does not know. If that
happens, start the newer version again, or restore the folder from a backup
made before the upgrade. Release notes say when a version changes the layout.

## Reading the release notes

Every release lists its changes in the repository's `CHANGELOG.md`. Before
an update, look for two words there: **layout** (the data folder changes, so
make a backup first and do not plan on going back) and **breaking**
(something you configured needs a change).
