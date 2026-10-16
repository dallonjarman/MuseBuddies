#!/usr/bin/env bash
# MuseTogether receive hook. Runs on the Muse hook runtime every poll interval.
# It is read-only: it never acknowledges relay events or changes local state,
# so dry runs are safe. It only decides whether to wake the worker.
set -euo pipefail
source "$HATCH_HOOK_RUNTIME"
trap 'silent "Receive check failed; will retry" "{}"; exit 0' ERR

here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
state="${here}/../state/musetogether"
config="${state}/config.json"
node_path="$(jq -er '.nodePath' "$config")"
cli_path="$(jq -er '.cliPath' "$config")"
store_dir="$(jq -er '.storeDir' "$config")"
relay_url="$(jq -er '.relayUrl' "$config")"

local_state="$(MUSETOGETHER_DIR="$store_dir" "$node_path" --no-warnings "$cli_path" hook check 2>/dev/null)"
if jq -e '(.urgentMessagesCount // 0) > 0' <<< "$local_state" >/dev/null; then
  wake "MuseTogether has an URGENT message waiting" "$local_state"
  exit 0
fi
if jq -e '.pendingMessagesCount > 0 or .pendingOutboxCount > 0' <<< "$local_state" >/dev/null; then
  wake "MuseTogether has unfinished local work" "$local_state"
  exit 0
fi

# Long-poll: the relay holds the request up to 12s, so a message sent during the
# check is picked up now instead of next interval. Relays without long-poll
# support ignore ?wait and answer at once. Never log the token, envelopes, or bodies.
if ! response="$(curl --fail --silent --max-time 16 --max-filesize 4194304 \
  --header "@${state}/authorization.header" "${relay_url}/v1/events?wait=12" 2>/dev/null)"; then
  silent "Relay unavailable; will retry" '{}'
  exit 0
fi

count="$(jq -er '.events | if type == "array" then length else error("bad response") end' <<< "$response")"
if (( count > 0 )); then
  wake "MuseTogether has relay events" "{\"eventCount\":${count}}"
else
  silent "No MuseTogether messages waiting" '{}'
fi
