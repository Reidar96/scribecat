# Updating

## Versions

As with any update, back up the data folder first (see
[Backups](data-and-backups.md#backups)), so a bad update is a restore, not a
loss.

Images are published with both a numbered tag and a moving `latest` tag from
the same multi-architecture build. The repository Compose file defaults to
the current numbered release. To follow new releases automatically, set this
in `.env`:

```dotenv
SCRIBECAT_IMAGE=ghcr.io/reidar96/scribecat-server:latest
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

For Portainer, use `docker-compose.portainer-latest.yml` from the release if
you want to pull the registry image on each redeploy. It keeps the existing
`/volume1/notes:/data:rw` bind mount. The versioned Portainer Compose and
Docker archive remain available for local image import with `pull_policy: never`.
With a numbered image tag, `docker compose pull` fetches that exact server
and frontend build instead of following new releases.

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
