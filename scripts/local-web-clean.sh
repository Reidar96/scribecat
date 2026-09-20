#!/usr/bin/env bash
# Cleans up after local development of the server edition: stops the running
# processes and removes the logs and PID files, optionally the test vault too.
#
#   scripts/local-web-clean.sh                    # logs and PID files only
#   scripts/local-web-clean.sh --with-vault       # also delete the test vault
#   scripts/local-web-clean.sh --with-vault --yes # no confirmation prompt
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT_DIR/scripts/.run"
VAULT_PATH="${SCRIBEDOG_VAULT_PATH:-$HOME/scribedog-test-vault}"

WITH_VAULT=false
SKIP_CONFIRM=false
for arg in "$@"; do
  case "$arg" in
    --with-vault) WITH_VAULT=true ;;
    --yes) SKIP_CONFIRM=true ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

bash "$ROOT_DIR/scripts/local-web-stop.sh"

echo "Removing logs and PID files ($RUN_DIR) ..."
rm -rf "$RUN_DIR"

if [[ "$WITH_VAULT" != true ]]; then
  echo "Keeping the vault at $VAULT_PATH. Pass --with-vault to delete it."
  exit 0
fi

if [[ ! -d "$VAULT_PATH" ]]; then
  echo "No vault found at $VAULT_PATH."
  exit 0
fi

# Deleting the vault throws away its notes, the stored password and the
# server metadata in .scribedog/, so make sure it is really the test vault.
if [[ "$SKIP_CONFIRM" != true ]]; then
  read -r -p "Delete the vault and all notes in it? $VAULT_PATH [y/N] " reply
  if [[ ! "$reply" =~ ^[yY]$ ]]; then
    echo "Cancelled, the vault is untouched."
    exit 0
  fi
fi

echo "Deleting vault: $VAULT_PATH"
rm -rf "$VAULT_PATH"
echo "Done."
