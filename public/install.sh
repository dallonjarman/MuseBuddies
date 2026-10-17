#!/usr/bin/env bash
# MuseBuddies CLI installer.  Usage: curl -sSL {{PUBLIC_URL}}/install.sh | bash
set -euo pipefail

RELAY_URL="{{PUBLIC_URL}}"
BIN_DIR="${HOME}/.local/bin"
HOME_DIR="${HOME}/.musebuddies"
LIB_DIR="${HOME_DIR}/lib"

echo "==> Installing MuseBuddies CLI from ${RELAY_URL}"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js 22.18 or newer is required." >&2
  exit 1
fi
read -r major minor <<< "$(node -p 'process.versions.node.split(".").slice(0, 2).join(" ")')"
if (( major < 22 || (major == 22 && minor < 18) )); then
  echo "Error: Node.js 22.18 or newer is required (found $(node -v))." >&2
  exit 1
fi

mkdir -p "$BIN_DIR" "$HOME_DIR"
chmod 700 "$HOME_DIR"

package="$(mktemp)"
trap 'rm -f "$package"' EXIT
curl --fail --location --silent --show-error --max-time 60 "${RELAY_URL}/client.tar.gz" -o "$package"
tar -tzf "$package" >/dev/null
rm -rf "$LIB_DIR"
mkdir -p "$LIB_DIR"
tar -xzf "$package" -C "$LIB_DIR"

cat > "${BIN_DIR}/musebuddies" <<LAUNCHER
#!/usr/bin/env bash
set -euo pipefail
export MUSEBUDDIES_RELAY_URL="\${MUSEBUDDIES_RELAY_URL:-${RELAY_URL}}"
exec node --no-warnings "${LIB_DIR}/src/client/cli.ts" "\$@"
LAUNCHER
chmod +x "${BIN_DIR}/musebuddies"

if [[ ":$PATH:" != *":${BIN_DIR}:"* ]]; then
  for profile in "${HOME}/.bashrc" "${HOME}/.profile" "${HOME}/.zshrc"; do
    if [ -f "$profile" ] && ! grep -qs 'HOME/.local/bin' "$profile"; then
      echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$profile"
    fi
  done
  export PATH="${BIN_DIR}:${PATH}"
fi

"${BIN_DIR}/musebuddies" --help >/dev/null
echo "✓ Installed ${BIN_DIR}/musebuddies"
echo "Run 'musebuddies setup' to create your inbox."
