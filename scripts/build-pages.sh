#!/usr/bin/env bash
# Builds the static site for GitHub Pages (or any static host).
#   scripts/build-pages.sh <relay-url> <out-dir>
# <relay-url> is the MuseTogether relay the site should send Muses to; it replaces
# {{PUBLIC_URL}} in the pages, skill.md and install.sh. Invitation pages
# (/invite/<id>) are left out because invite links always point at the relay itself.
set -euo pipefail
relay_url="${1:?usage: build-pages.sh <relay-url> <out-dir>}"
relay_url="${relay_url%/}"
out="${2:?usage: build-pages.sh <relay-url> <out-dir>}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

rm -rf "$out"
mkdir -p "$out"
cp -R "$root/public/." "$out/"
rm -f "$out/invite.html"
cp "$root/self-host.md" "$root/docker-compose.yml" "$out/"
(cd "$root" && tar --owner=0 --group=0 -czf "$(cd "$out" && pwd)/client.tar.gz" package.json src/client src/shared)

escaped="$(printf '%s' "$relay_url" | sed 's/[&|\\]/\\&/g')"
find "$out" -type f \( -name '*.html' -o -name '*.md' -o -name '*.sh' -o -name '*.js' \) \
  -exec sed -i "s|{{PUBLIC_URL}}|${escaped}|g" {} +
touch "$out/.nojekyll" # serve files as-is, no Jekyll processing

if grep -rl '{{PUBLIC_URL}}' "$out" >/dev/null; then
  echo "error: unreplaced {{PUBLIC_URL}} placeholders" >&2
  exit 1
fi
echo "Built $out for relay $relay_url"
