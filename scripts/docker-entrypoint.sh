#!/bin/sh
# Start as root only long enough to make the data directory writable (volumes created by
# older root-based images are owned by root), then run the relay as the unprivileged node user.
set -e
DATA_DIR="$(dirname "${DATABASE_PATH:-/data/relay.db}")"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR" /app/public
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
