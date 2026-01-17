#!/usr/bin/env bash
set -euo pipefail

# Start a trusted HTTPS tunnel for iPhone camera testing (no cert install needed).
#
# This script:
#  1) Ensures the inventory-service is running locally (HTTP)
#  2) Starts an HTTPS tunnel (ngrok preferred, cloudflared fallback)
#
# Requirements (install ONE):
#  - ngrok: https://ngrok.com/  (brew install ngrok/ngrok/ngrok)
#  - cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/
#
# Usage:
#   ./scripts/start-https-tunnel.sh --port 4001
#   ./scripts/start-https-tunnel.sh --port 4001 --db test_ui

PORT="${PORT:-4001}"
DB_NAME="${DB_NAME:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)
      PORT="$2"; shift 2 ;;
    --db)
      DB_NAME="$2"; shift 2 ;;
    -h|--help)
      cat <<EOF
Usage: $(basename "$0") [--port 4001] [--db test_ui]

Starts the local server (if not already running) and then starts a trusted HTTPS tunnel.
Open the printed https:// URL on your iPhone and go to /ui/.
EOF
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 2
      ;;
  esac
done

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"

is_listening() {
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1
}

SERVER_PID=""
cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if ! is_listening; then
  echo "Starting local inventory-service on http://localhost:$PORT" >&2
  pushd "$ROOT_DIR" >/dev/null
  if [[ -n "$DB_NAME" ]]; then
    DB_NAME="$DB_NAME" PORT="$PORT" node index.js &
  else
    PORT="$PORT" node index.js &
  fi
  SERVER_PID="$!"
  popd >/dev/null

  # Wait briefly for port.
  for _ in {1..30}; do
    if is_listening; then break; fi
    sleep 0.2
  done

  if ! is_listening; then
    echo "Server did not start or port $PORT not listening." >&2
    exit 1
  fi
else
  echo "Local server already listening on port $PORT" >&2
fi

if command -v ngrok >/dev/null 2>&1; then
  echo "Starting ngrok tunnel..." >&2
  echo "When ngrok prints a URL like https://xxxx.ngrok-free.app, open: https://xxxx.ngrok-free.app/ui/" >&2
  exec ngrok http "$PORT"
elif command -v cloudflared >/dev/null 2>&1; then
  echo "Starting cloudflared tunnel..." >&2
  echo "Look for the https://trycloudflare.com URL and open: <that-url>/ui/" >&2
  exec cloudflared tunnel --url "http://localhost:$PORT"
else
  echo "Neither ngrok nor cloudflared is installed." >&2
  echo "Install one of:" >&2
  echo "  brew install ngrok/ngrok/ngrok" >&2
  echo "  brew install cloudflared" >&2
  exit 1
fi
