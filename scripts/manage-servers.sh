#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<EOF
Usage: $0 {start|stop|restart|status} {dev|test|prod} [port]

Defaults:
  dev -> DB_NAME=dev, port=4002
  test -> DB_NAME=test_ui, port=4001
  prod -> DB_NAME=prod, port=4011

Examples:
  $0 start test        # start test server (DB=test_ui, port 4001)
  $0 restart prod 4012 # restart prod on port 4012
EOF
  exit 1
}

if [ "$#" -lt 2 ]; then
  usage
fi

ACTION=$1
ENV_NAME=$2
OVERRIDE_PORT=${3-}

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$SCRIPT_DIR/.."
PID_FILE() { echo "/tmp/inventory-service-${ENV_NAME}.pid"; }
LOG_FILE() { echo "/tmp/inventory-service-${ENV_NAME}.log"; }
PORT_FILE() { echo "/tmp/inventory-service-${ENV_NAME}.port"; }

case "$ENV_NAME" in
  dev)
    DB_NAME=dev
    DEFAULT_PORT=4002
    ;;
  test)
    DB_NAME=test_ui
    DEFAULT_PORT=4001
    ;;
  prod)
    DB_NAME=prod
    DEFAULT_PORT=4011
    ;;
  *)
    echo "Unknown env: $ENV_NAME" >&2; usage
    ;;
esac

SAVED_PORTFILE=$(PORT_FILE)
if [ -f "$SAVED_PORTFILE" ]; then
  SAVED_PORT=$(cat "$SAVED_PORTFILE" 2>/dev/null || true)
  if [ -n "$SAVED_PORT" ]; then
    DEFAULT_PORT="$SAVED_PORT"
  fi
fi

PORT=${OVERRIDE_PORT:-$DEFAULT_PORT}

# If an override port is supplied, persist it as the new default for this env
if [ -n "${OVERRIDE_PORT-}" ]; then
  echo "$PORT" > "$SAVED_PORTFILE"
fi

PIDFILE=$(PID_FILE)
LOGFILE=$(LOG_FILE)

is_running_pid() {
  local pid=$1
  if [ -z "$pid" ]; then return 1; fi
  kill -0 "$pid" 2>/dev/null
}

stop() {
  if [ -f "$PIDFILE" ]; then
    PID=$(cat "$PIDFILE" 2>/dev/null || true)
    if is_running_pid "$PID"; then
      echo "Stopping PID $PID (from $PIDFILE)..."
      kill "$PID" || true
      for i in {1..10}; do
        if ! is_running_pid "$PID"; then break; fi
        sleep 1
      done
      if is_running_pid "$PID"; then
        echo "PID $PID did not stop, sending SIGKILL..."
        kill -9 "$PID" || true
      fi
      rm -f "$PIDFILE"
      echo "Stopped."
      return
    else
      echo "Stale PIDfile found (no process $PID). Removing PIDfile.";
      rm -f "$PIDFILE"
    fi
  fi

  # Fallback: kill process listening on the port
  PORT_PIDS=$(lsof -tiTCP:${PORT} -sTCP:LISTEN || true)
  if [ -n "$PORT_PIDS" ]; then
    echo "Found listeners on port $PORT: $PORT_PIDS. Killing..."
    kill $PORT_PIDS || true
    echo "Killed listeners on port $PORT."
  else
    echo "No running service detected for env '$ENV_NAME'."
  fi
}

start() {
  if [ -f "$PIDFILE" ]; then
    PID=$(cat "$PIDFILE" 2>/dev/null || true)
    if is_running_pid "$PID"; then
      echo "Server already running with PID $PID (from $PIDFILE). Use restart if needed."; return; fi
  fi

  # Also check port
  EXISTING=$(lsof -tiTCP:${PORT} -sTCP:LISTEN || true)
  if [ -n "$EXISTING" ]; then
    echo "Warning: port ${PORT} already in use by PIDs: $EXISTING"
    echo "Attempting to stop them before starting."
    kill $EXISTING || true
    sleep 1
  fi

  echo "Starting inventory-service (DB_NAME=$DB_NAME, PORT=$PORT)..."
  cd "$ROOT_DIR"
  nohup env DB_NAME="$DB_NAME" PORT="$PORT" node index.js > "$LOGFILE" 2>&1 &
  PID=$!
  echo "$PID" > "$PIDFILE"
  echo "Started PID $PID (logs: $LOGFILE)"
}

status() {
  if [ -f "$PIDFILE" ]; then
    PID=$(cat "$PIDFILE" 2>/dev/null || true)
    if is_running_pid "$PID"; then
      echo "Running: PID $PID (from $PIDFILE) listening on port $PORT (DB=$DB_NAME)"
      return
    else
      echo "PIDfile exists but no process $PID."
    fi
  fi
  PORT_PIDS=$(lsof -tiTCP:${PORT} -sTCP:LISTEN || true)
  if [ -n "$PORT_PIDS" ]; then
    echo "Process(es) listening on port $PORT: $PORT_PIDS"
  else
    echo "No process running for env '$ENV_NAME' (port $PORT)."
  fi
}

case "$ACTION" in
  start)
    start
    ;;
  stop)
    stop
    ;;
  restart)
    stop
    start
    ;;
  status)
    status
    ;;
  *)
    usage
    ;;
esac
