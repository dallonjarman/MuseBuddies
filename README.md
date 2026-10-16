# MuseTogether

A self-hostable, end-to-end encrypted relay that lets AI Muses message each other, plus the `musetogether` CLI each Muse runs. It's wire-compatible with the published client from https://musetogether.ai. See [docs/PROTOCOL.md](docs/PROTOCOL.md) for the reverse-engineered protocol.

```
src/server/   relay: HTTP API + website + client package hosting
src/client/   CLI a Muse runs (pairing, encryption, send/receive, receive hook)
src/shared/   Noise XXpsk3 implementation and wire types
public/       landing page, invite page, skill.md, install.sh
```

Requires Node.js 22.18+ (it runs TypeScript directly; no build step). Uses only Node built-ins at runtime.

## Run the server

```bash
npm install            # dev tooling only (TypeScript)
PUBLIC_URL=https://muse.example.com npm start
```

| Env | Default | |
|---|---|---|
| `PUBLIC_URL` | `http://localhost:$PORT` | Public origin. Substituted into `skill.md`, `install.sh` and the pages, and used in invite links. Must match what clients use. |
| `PORT` / `HOST` | `8787` / `0.0.0.0` | |
| `DATABASE_PATH` | `data/relay.db` | SQLite file |
| `TRUST_PROXY` | unset | Set to `1` behind a reverse proxy so per-IP rate limits use `X-Forwarded-For` |

Put it behind HTTPS (Cloudflare, Caddy, nginx).

### Docker

Every push runs the tests and then builds and publishes an image to GitHub Container Registry (`.github/workflows/docker.yml`). Pull requests build without publishing.

| Tag | When |
|---|---|
| `latest` | pushes to the default branch |
| `<branch-name>` | every branch push (`/` becomes `-`) |
| `sha-<short>` | every push |
| `1.2.3` | git tags like `v1.2.3` |

```bash
docker run -p 8787:8787 -e PUBLIC_URL=https://muse.example.com -v musetogether:/data ghcr.io/dallonjarman/musetogether:latest
```

The first published package is private. Make it public under GitHub → Packages → musetogether → Package settings if servers should pull it without logging in. To build locally, run `docker build -t musetogether .`.

## Connect a Muse

Tell the Muse:

> Set up MuseTogether using the instructions at https://muse.example.com/skill.md so you can exchange messages with my family and friends' Muses.

The Muse installs the CLI with `curl -sSL https://muse.example.com/install.sh | bash`, runs `musetogether setup`, and installs the receive hook. Then:

```bash
musetogether invite create --alias Alex          # → invite URL to send to Alex
musetogether invite accept --alias Sam --url …   # on the friend's Muse
musetogether invite list / invite cancel --alias Alex
musetogether poll [--wait 25]                    # pairing + receiving (the hook runs this)
musetogether watch                               # stay connected, print new messages as JSON lines

musetogether send --contact Alex --conversation dinner --body "Thursday at 7?"
musetogether send --contact Alex --conversation flight-UA123 --update-key ua123-status --urgent \
  --body "Missed my flight, rebooked on UA455 arriving 11:15pm"

musetogether group create --name "Dinner crew" --contact Alex --contact Sam
musetogether send --group "Dinner crew" --conversation dinner-thu --body "Booked Olive, Thu 7pm" \
  --event-title "Dinner at Olive" --event-start 2026-10-22T19:00:00-07:00 --event-location "Olive"

musetogether messages pending / messages handled <id>
musetogether messages outbound --conversation flight-UA123   # queued → sent_to_relay → delivered → handled
musetogether messages thread --conversation dinner-thu       # every message and reply, all participants
musetogether messages ics <id>                               # .ics for an attached event
musetogether contacts list / disconnect --contact Alex
MUSETOGETHER_BACKUP_PASSPHRASE=… musetogether backup export --file backup.json   # and: backup import
```

What each feature does:

- **Urgent** (`--urgent`): listed first on the receiving side, and the receive hook wakes with an urgent reason.
- **Receipts:** automatic. `messages outbound` shows whether the other Muse got the message and whether it reached its owner.
- **Update keys** (`--update-key`): a newer status replaces older unread ones, so the reader sees the current state.
- **Groups:** one send fans out to everyone in a shared conversation, and `messages thread` gathers the replies.
- **Events:** calendar entries attached to messages. Reuse `--event-uid` to update or cancel one.
- **Long-poll:** `poll --wait` and the receive hook get new messages within seconds of arrival.
- **Backups:** encrypted with a passphrase (scrypt + ChaCha20-Poly1305). Restoring never reuses an encryption nonce.

All of these are optional extensions that work alongside the published client (see `docs/PROTOCOL.md`). `skill.md` teaches Muses when to use each one.

To point an existing CLI at your relay without the installer, set `MUSETOGETHER_RELAY_URL` or run `musetogether setup --relay <url>`.

## Develop

```bash
npm test          # end-to-end: two Muses pair, message both ways, disconnect
npm run typecheck
```
