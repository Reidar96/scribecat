#!/bin/sh
# Starts as root so the data folder can be handed to the user the server
# runs as, then drops privileges (the PUID/PGID pattern). A bind mount that
# Compose created on the fly is owned by root, and without this step the
# first start would fail with a permission error on the vault.
#
# Started with a non-root `user:` in the compose file, there is nothing to
# fix and nothing to drop; the command runs as that user directly.
set -eu

DATA_DIR="${SCRIBEDOG_VAULT_PATH:-/data}"

if [ "$(id -u)" != "0" ]; then
  exec "$@"
fi

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

case "$PUID$PGID" in
  *[!0-9]*) echo "[scribedog] PUID and PGID must be numeric (got PUID=$PUID PGID=$PGID)." >&2; exit 1 ;;
esac

# Give the ids a name so os.userInfo() and $HOME resolve; the image's "node"
# account is reused when the ids match, otherwise a fresh one is created.
if ! getent group "$PGID" >/dev/null 2>&1; then
  addgroup -g "$PGID" scribedog
fi
GROUP_NAME="$(getent group "$PGID" | cut -d: -f1)"

if ! getent passwd "$PUID" >/dev/null 2>&1; then
  adduser -D -H -u "$PUID" -G "$GROUP_NAME" scribedog
fi
USER_NAME="$(getent passwd "$PUID" | cut -d: -f1)"
export HOME="/home/$USER_NAME"

mkdir -p "$DATA_DIR"

# Only touch ownership when something is not already owned by the target
# user: a vault of thousands of notes should not be chowned on every start.
if [ -n "$(find "$DATA_DIR" ! -user "$PUID" -print -quit 2>/dev/null)" ]; then
  echo "[scribedog] handing $DATA_DIR to uid $PUID / gid $PGID"
  chown -R "$PUID:$PGID" "$DATA_DIR"
fi

exec su-exec "$PUID:$PGID" "$@"
