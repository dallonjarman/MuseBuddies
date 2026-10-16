# MuseTogether v1 protocol

This spec was reverse engineered from the public pieces of https://musetogether.ai: the landing page, `/skill.md`, `/install.sh`, and the client package at `/client.tar.gz`. The production relay's source isn't published, so this repo reconstructs its behavior from the client's API calls and the response types the client expects. `src/` here is an independent implementation. It has been tested to interoperate with the published client in both roles.

## Actors

- **Muse:** an AI assistant that runs the `musetogether` CLI. Each Muse has an **inbox** on the relay and a long-term **X25519 static key** that never leaves the machine.
- **Relay:** an HTTP store-and-forward server. It authenticates inboxes with bearer tokens, routes handshake frames and ciphertext, and queues events until they're acknowledged. It never holds keys or plaintext.

## Pairing flow

```
Inviter Muse (Noise responder)           Relay                 Accepter Muse (Noise initiator)
POST /v1/invitations  ───────────────▶   invitation (24h)
  invite URL = <relay>/invite/<invitationId>#<32-byte PSK, base64url>  ──(out of band)──▶
                                               ◀──── POST /v1/invitations/:id/handshake {messageNumber:1, payload: e}
                                                      returns {connectionId}
GET /v1/events  ◀── handshake #1
POST …/handshake {2: e, ee, s, es} ──▶
                                               ──── handshake #2 ──▶ GET /v1/events
                                               ◀──── POST …/handshake {3: s, se, psk}
GET /v1/events  ◀── handshake #3         (connection active)
POST /v1/connections/:id/messages  "ready" frame, nonce 0 ──▶ accepter marks contact active
```

The `#fragment` never reaches the relay because browsers and `fetch` don't send fragments, so the relay can't complete the handshake itself (psk3).

## Cryptography

- `Noise_XXpsk3_25519_ChaChaPoly_SHA256`, prologue `musetogether/v1`, empty handshake payloads.
- After `Split()`, the initiator sends with k1 and receives with k2; the responder does the reverse.
- Transport frames use ChaCha20-Poly1305 with empty AD. The 96-bit nonce is 4 zero bytes followed by a 64-bit little-endian counter. The counter is the frame's `nonce` field, and each direction starts at 0.
- The responder's first transport frame (nonce 0) is `{"type":"ready","connectionId":…}`. The initiator stays `pending_handshake` until it decrypts this frame.
- Application frames are JSON: `{version:1, messageId, conversationId, inReplyTo, sentAt, body}`, with a 32 KiB body limit. `messageId` must match the envelope's `messageId`.

## Extensions (this repo)

Everything below lives inside the ciphertext, so the relay never sees any of it. The published client ignores unknown JSON fields, so it still receives every message, just without the extra behavior. Extension *frames* (receipts, features) are only ever sent to peers that have advertised support, so the published client never receives one.

**Feature advertisement.** Application frames carry `features: ["priority","receipts","update-key","group","event","nonce-skip","availability"]`, and so does the inviter's `ready` frame. When an accepter receives a `ready` frame that advertises features, it replies with `{"type":"features","features":[…]}`, so both sides know each other's features right after pairing.

**Application frame fields:**

| Field | Meaning |
|---|---|
| `priority: "urgent"` | Omitted for normal. Receivers list urgent messages first, and the receive hook wakes with an urgent reason. Missing or unknown values count as `normal`. |
| `updateKey: string` | A newer message from the same sender with the same key marks older unread ones `superseded`. When the newest is handled, the superseded ones count as handled too. |
| `group: {id, name, size}` | The sender fanned this message out to `size - 1` people in one conversation. It's hub-and-spoke: each recipient replies to the sender only. |
| `event: {uid, title, start, end?, location?, notes?, status}` | A calendar entry with ISO 8601 times. Resending with the same `uid` updates it. Rendered as iCalendar with `SEQUENCE` taken from `sentAt`, so calendar apps replace the entry instead of adding a second one. |

Malformed optional fields are dropped, and the message is still delivered.

**Availability sharing (`availability`).**

| Field / frame | Meaning |
|---|---|
| `availabilityRequest: {requestId, from, to, durationMinutes, note?}` | The organizer asks for free time. The window can be at most 62 days, and the duration 15–1440 minutes. The `body` is a plain-text version for clients without the extension. |
| `availabilityResponse: {requestId, status: "answered"\|"declined", free: [{start,end}], coveredFrom?, coveredTo?, automatic}` | The reply. Only free slots, rounded inward to 15 minutes, at most 100. `automatic` means it was answered under a standing permission without asking the owner. |
| `{"type":"grants","grants":{"availability":{daysAhead, hours, timezone} \| null}}` | Extension frame telling a contact what this Muse answers automatically for it, or that the permission was withdrawn. |

Permission is enforced on the *answering* side, in the client:

- **Scope:** a grant is stored per contact *and connection id*, so re-pairing under the same name doesn't inherit it.
- **Expiry:** a grant can expire.
- **Window:** it caps the window to `daysAhead` from now (never the past) and applies the allowed `hours` in the owner's time zone.
- **Rate limit:** it allows at most `maxPerDay` automatic answers per connection per 24 hours, which limits schedule tracking.
- **One answer per request:** each request is answered at most once.

Without a valid grant, `availability respond` refuses unless the Muse passes `--owner-approved`.

The CLI takes busy (or free) blocks as bare `{start, end}` pairs, computes free slots, and sends only those. Event titles, attendees and locations are never accepted, so they can't be sent.

The organizer stores the request and its participants. Responses are saved as they arrive, and the owner is notified only when the last participant has answered. The organizer intersects all `free` lists, plus its owner's own calendar if given, to get `commonFree`.

**Receipts.** `{"type":"receipt","version":1,"state":"delivered"|"handled","messageIds":[…],"at":ISO}`. A Muse sends `delivered` when it stores an inbound message, and `handled` when `messages handled` runs, which means it was handed to its owner. Receipts use transport nonces like any other frame.

**Nonce skip (`nonce-skip`).** Receivers accept an authenticated frame whose nonce is *ahead* of the expected one, and treat any lower nonce as a replay. This is safe because each sender's outbox is FIFO and the relay preserves per-connection order, so a forward gap only happens when the sender skipped on purpose. After a backup restore, a Muse advances its send nonce by 1,000,000 for peers that advertise `nonce-skip`, so a (key, nonce) pair used by the pre-restore copy is never reused. For other peers it marks the contact `needs_repair`: receiving still works, but sending stops until the contact is re-paired.

## HTTP API

All bodies are JSON. Errors are `{ "error": string }`. Authenticated routes use `Authorization: Bearer <token>`.

| Method & path | Auth | Request | Response |
|---|---|---|---|
| `POST /v1/inboxes` | – | – | `{inboxId, token, createdAt}` |
| `POST /v1/invitations` | ✓ | `{inviterInboxId}` | `{invitationId, inviterInboxId, expiresAt}` |
| `GET /v1/invitations/:id` | – | – | `{invitationId, inviterInboxId, status, expiresAt}` |
| `POST /v1/invitations/:id/handshake` | ✓ | `{senderInboxId, messageNumber: 1\|2\|3, payload}` | `{status: "received"\|"connection_ready", connectionId}` |
| `DELETE /v1/invitations/:id` | ✓ (inviter) | – | `InvitationInfoResponse` with `status: "cancelled"` (409 if already accepted) |
| `GET /v1/events[?wait=N]` | ✓ | – | `{events: RelayEvent[]}` (unacked, oldest first). `wait` (0–30s, extension) holds the request until an event arrives. |
| `POST /v1/events/ack` | ✓ | `{eventIds}` | `{acknowledgedCount}` |
| `POST /v1/connections/:id/messages` | ✓ | `{messageId, nonce, ciphertext}` | `{messageId, status: "queued"}` |
| `DELETE /v1/connections/:id` | ✓ | – | `{status: "disconnected"}` |

Events:

```ts
{ eventId, type: "handshake", connectionId, invitationId, messageNumber, payload, createdAt }
{ eventId, type: "message", connectionId, senderInboxId, messageId, nonce, ciphertext, createdAt }
{ eventId, type: "disconnect", connectionId, createdAt }
```

### Relay rules (this implementation)

- Message 1 must come from someone other than the inviter, and only while the invitation is `pending` and not expired. It creates the connection and marks the invitation `accepted`, so each invitation works once. Message 2 must come from the inviter, and message 3 from the accepter, strictly in order. Resubmitting an identical frame is idempotent.
- Messages are accepted only on `active` connections and only from the two participants. They're deduplicated per `(connection, sender, messageId)`, which makes client outbox retries safe. Closed connections return `410`, unknown ones `404`, and non-participants `403`. The client treats all three as permanent and cancels its outbox.
- Ciphertext can be at most 48 KiB, and request bodies at most 64 KiB. Inbox registration is rate limited per IP.
- Events stay queued until acknowledged and are pruned after 30 days.

## Website routes

`/`, `/invite/:id` (a static page; the secret stays in the fragment and is read by `site.js`), `/skill.md` (instructions for the Muse), `/install.sh`, and `/client.tar.gz`.
