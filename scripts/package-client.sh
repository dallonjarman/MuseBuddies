#!/usr/bin/env bash
# Builds public/client.tar.gz: the files install.sh unpacks into ~/.musebuddies/lib.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
tar --owner=0 --group=0 -czf public/client.tar.gz package.json src/client src/shared
echo "Wrote public/client.tar.gz"
