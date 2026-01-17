#!/usr/bin/env bash
set -euo pipefail

# Start ModernEx inventory-service with HTTPS using mkcert.
# This enables live iPhone camera scanning (getUserMedia) by serving the UI over https://
#
# Requirements:
#   - mkcert installed (recommended on macOS: brew install mkcert nss)
#   - mkcert root CA installed on your Mac: mkcert -install
#
# For iPhone (optional but usually required):
#   - Install mkcert rootCA.pem on the iPhone and trust it.
#     1) CAROOT=$(mkcert -CAROOT)
#     2) AirDrop "$CAROOT/rootCA.pem" to the iPhone
#     3) Settings -> General -> VPN & Device Management -> Install profile
#     4) Settings -> General -> About -> Certificate Trust Settings -> enable full trust

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

Generates a local dev TLS cert with mkcert (if needed) and starts the server with:
  SSL_KEY_PATH / SSL_CERT_PATH

Notes:
- Your iPhone must trust the mkcert root CA for Safari to allow camera access.
- If you just want a quick trusted URL without installing a CA on iPhone, use ngrok:
    ngrok http $PORT
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
SSL_DIR="$ROOT_DIR/.ssl"
CERT_FILE="$SSL_DIR/dev-cert.pem"
KEY_FILE="$SSL_DIR/dev-key.pem"

mkdir -p "$SSL_DIR"

if ! command -v mkcert >/dev/null 2>&1; then
  echo "mkcert is not installed." >&2
  echo "macOS (Homebrew): brew install mkcert nss" >&2
  echo "Then run: mkcert -install" >&2
  exit 1
fi

# Attempt to include LAN IPs so you can open https://<LAN-IP>:PORT/ui/ on your phone.
HOSTNAME_SHORT="$(scutil --get LocalHostName 2>/dev/null || hostname)"
LAN_IP=""
LAN_IP2=""
if command -v ipconfig >/dev/null 2>&1; then
  LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || true)"
  LAN_IP2="$(ipconfig getifaddr en1 2>/dev/null || true)"
fi

SANs=("localhost" "127.0.0.1" "::1" "$HOSTNAME_SHORT")
if [[ -n "$LAN_IP" ]]; then SANs+=("$LAN_IP"); fi
if [[ -n "$LAN_IP2" && "$LAN_IP2" != "$LAN_IP" ]]; then SANs+=("$LAN_IP2"); fi

if [[ ! -f "$CERT_FILE" || ! -f "$KEY_FILE" ]]; then
  echo "Generating dev TLS cert in $SSL_DIR" >&2
  echo "SANs: ${SANs[*]}" >&2
  mkcert -cert-file "$CERT_FILE" -key-file "$KEY_FILE" "${SANs[@]}" >/dev/null
fi

echo "Starting inventory-service with HTTPS on port $PORT" >&2
if [[ -n "$DB_NAME" ]]; then
  export DB_NAME
fi
export PORT
export SSL_CERT_PATH="$CERT_FILE"
export SSL_KEY_PATH="$KEY_FILE"

node "$ROOT_DIR/index.js"
