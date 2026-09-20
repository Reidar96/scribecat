#!/usr/bin/env bash
# Stops the server and Vite dev server started by scripts/local-web-start.sh.
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT_DIR/scripts/.run"

SERVER_PID_FILE="$RUN_DIR/server.pid.local"
VITE_PID_FILE="$RUN_DIR/vite.pid.local"

kill_by_pid_file() {
  local pid_file="$1" label="$2" pid
  [[ -f "$pid_file" ]] || return 0
  pid="$(cat "$pid_file")"
  if kill -0 "$pid" 2>/dev/null; then
    echo "Stopping $label (pid $pid) ..."
    kill "$pid" 2>/dev/null
  fi
  rm -f "$pid_file"
}

# npm spawns the actual node process as a child, and on Windows that child
# does not always go down with the pid recorded at start. So whatever is
# still listening on the two ports is stopped as well.
listener_pids() {
  local port="$1"
  case "$(uname -s)" in
    MINGW* | MSYS* | CYGWIN*)
      # Field 2 is the local address; matching only that avoids picking up
      # clients connected to the port. Field order is stable across locales.
      netstat -ano 2>/dev/null | awk -v suffix=":$port\$" '$2 ~ suffix && $NF != 0 { print $NF }' | sort -u
      ;;
    *)
      command -v lsof >/dev/null 2>&1 && lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null
      ;;
  esac
}

kill_pid() {
  local pid="$1"
  case "$(uname -s)" in
    MINGW* | MSYS* | CYGWIN*) taskkill //PID "$pid" //T //F >/dev/null 2>&1 ;;
    *) kill "$pid" 2>/dev/null ;;
  esac
}

kill_by_port() {
  local port="$1" pid
  for pid in $(listener_pids "$port"); do
    echo "Stopping leftover process on port $port (pid $pid) ..."
    kill_pid "$pid"
  done
}

kill_by_pid_file "$SERVER_PID_FILE" "server"
kill_by_pid_file "$VITE_PID_FILE" "Vite"
kill_by_port 3000
kill_by_port 5173

echo "Done."
