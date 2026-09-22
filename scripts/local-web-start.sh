#!/usr/bin/env bash
# Starts both halves of the server edition for local development:
# the server on port 3000 and the Vite dev server on port 5173, which
# proxies /api/* to the server. See server/docs/development.md.
#
# Both run in the background; logs and PID files land in scripts/.run/.
# Stop them with scripts/local-web-stop.sh.
#
# Override SCRIBECAT_VAULT_PATH or SCRIBECAT_INIT_PASSWORD to use a
# different vault or password:
#   SCRIBECAT_VAULT_PATH=~/notes scripts/local-web-start.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT_DIR/scripts/.run"
mkdir -p "$RUN_DIR"

VAULT_PATH="${SCRIBECAT_VAULT_PATH:-$HOME/scribecat-test-vault}"
INIT_PASSWORD="${SCRIBECAT_INIT_PASSWORD:-devpassword}"

SERVER_PID_FILE="$RUN_DIR/server.pid.local"
VITE_PID_FILE="$RUN_DIR/vite.pid.local"
SERVER_LOG="$RUN_DIR/server.log"
VITE_LOG="$RUN_DIR/vite.log"

is_running() {
  local pid_file="$1"
  [[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null
}

if is_running "$SERVER_PID_FILE" || is_running "$VITE_PID_FILE"; then
  echo "Something is already running. Run scripts/local-web-stop.sh first." >&2
  exit 1
fi

# The server refuses to start on a vault path that does not exist yet.
mkdir -p "$VAULT_PATH"

echo "Starting server (vault: $VAULT_PATH) ..."
(
  cd "$ROOT_DIR/server"
  SCRIBECAT_VAULT_PATH="$VAULT_PATH" \
  SCRIBECAT_INIT_PASSWORD="$INIT_PASSWORD" \
  SCRIBECAT_COOKIE_SECURE=false \
  npm run dev > "$SERVER_LOG" 2>&1 &
  echo $! > "$SERVER_PID_FILE"
)

# --host 0.0.0.0 binds every interface: it fixes localhost resolving to ::1
# only on some systems, and it makes the dev server reachable from other
# devices on the same network (e.g. a phone), not just this machine.
echo "Starting Vite dev server ..."
(
  cd "$ROOT_DIR"
  npm run dev:web -- --host 0.0.0.0 > "$VITE_LOG" 2>&1 &
  echo $! > "$VITE_PID_FILE"
)

sleep 1
echo ""
echo "Server log: $SERVER_LOG"
echo "Vite log:   $VITE_LOG"
echo ""
echo "Frontend (this machine): http://127.0.0.1:5173/"
# Lists real network adapters only: VPNs, WSL and virtual switches also show
# up as non-internal IPv4 addresses and would otherwise be printed as if they
# were reachable from a phone on the same WLAN, which they are not.
LAN_IPS="$(node -e '
const skip = /vpn|tun|tap|wsl|virtual|hyper-v|default switch|docker|wireguard|zerotier|tailscale/i;
const nets = require("os").networkInterfaces();
for (const [name, list] of Object.entries(nets)) {
  if (skip.test(name)) continue;
  for (const net of list ?? []) {
    if (net.family === "IPv4" && !net.internal && !net.address.startsWith("169.254.")) {
      console.log(net.address);
    }
  }
}
' 2>/dev/null)"
if [[ -n "$LAN_IPS" ]]; then
  echo "Frontend (other devices, same WLAN):"
  while IFS= read -r ip; do
    echo "  http://$ip:5173/"
  done <<< "$LAN_IPS"
fi
echo "Password: $INIT_PASSWORD (first start only; stored in the vault afterwards)"
echo ""
echo "Stop with: scripts/local-web-stop.sh"
