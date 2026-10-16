// The MuseTogether relay: a store-and-forward mailbox. It never sees plaintext or keys;
// it only routes Noise handshake frames and encrypted transport frames between inboxes.
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  INVITATION_TTL_MS,
  MAX_CIPHERTEXT_BYTES,
  type CreateInvitationResponse,
  type HandshakeSubmissionRequest,
  type HandshakeSubmissionResponse,
  type InvitationInfoResponse,
  type InvitationStatus,
  type PostMessageRequest,
  type RegisterInboxResponse,
  type RelayEvent
} from "../shared/protocol.ts";

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const MAX_HANDSHAKE_BYTES = 1024;
const MAX_EVENTS_PER_POLL = 200;
const EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const BASE64URL = /^[A-Za-z0-9_-]*$/;

type NewEvent = RelayEvent extends infer E ? (E extends RelayEvent ? Omit<E, "eventId" | "createdAt"> : never) : never;

const id = (prefix: string, bytes = 16): string => `${prefix}${crypto.randomBytes(bytes).toString("base64url")}`;
const hashToken = (token: string): string => crypto.createHash("sha256").update(token).digest("hex");

interface InvitationRow {
  id: string;
  inviter_inbox_id: string;
  status: InvitationStatus;
  expires_at: number;
  connection_id: string | null;
}

interface ConnectionRow {
  id: string;
  invitation_id: string;
  inviter_inbox_id: string;
  accepter_inbox_id: string;
  status: "handshaking" | "active" | "closed";
  handshake_step: number;
}

function decodedLength(b64: string): number {
  return Buffer.from(b64, "base64url").length;
}

export class Relay {
  readonly db: DatabaseSync;
  private readonly now: () => number;
  /** Called after an event is queued for an inbox (used to wake long-polls). */
  onEnqueue: ((inboxId: string) => void) | null = null;

  constructor(dbPath = ":memory:", now: () => number = Date.now) {
    this.db = new DatabaseSync(dbPath);
    this.now = now;
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS inboxes (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS invitations (
        id TEXT PRIMARY KEY,
        inviter_inbox_id TEXT NOT NULL REFERENCES inboxes(id),
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        connection_id TEXT
      );
      CREATE TABLE IF NOT EXISTS connections (
        id TEXT PRIMARY KEY,
        invitation_id TEXT NOT NULL UNIQUE REFERENCES invitations(id),
        inviter_inbox_id TEXT NOT NULL,
        accepter_inbox_id TEXT NOT NULL,
        status TEXT NOT NULL,
        handshake_step INTEGER NOT NULL,
        handshake_payloads TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        inbox_id TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_by_inbox ON events(inbox_id, seq);
      CREATE TABLE IF NOT EXISTS delivered_messages (
        connection_id TEXT NOT NULL,
        sender_inbox_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (connection_id, sender_inbox_id, message_id)
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  private tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  private iso(ms: number): string {
    return new Date(ms).toISOString();
  }

  private enqueue(inboxId: string, event: NewEvent): void {
    const now = this.now();
    const eventId = id("evt_");
    const body = JSON.stringify({ eventId, ...event, createdAt: this.iso(now) });
    this.db.prepare("INSERT INTO events (id, inbox_id, body, created_at) VALUES (?, ?, ?, ?)").run(eventId, inboxId, body, now);
    // Runs after the surrounding transaction has committed.
    queueMicrotask(() => this.onEnqueue?.(inboxId));
  }

  // ---- auth ----

  authenticate(authorization: string | undefined): string {
    const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? "");
    if (!match) throw new HttpError(401, "Missing bearer token");
    const row = this.db.prepare("SELECT id FROM inboxes WHERE token_hash = ?").get(hashToken(match[1])) as { id: string } | undefined;
    if (!row) throw new HttpError(401, "Invalid token");
    return row.id;
  }

  // ---- inboxes ----

  registerInbox(): RegisterInboxResponse {
    const inboxId = id("inbox_");
    const token = crypto.randomBytes(32).toString("base64url");
    const now = this.now();
    this.db.prepare("INSERT INTO inboxes (id, token_hash, created_at) VALUES (?, ?, ?)").run(inboxId, hashToken(token), now);
    return { inboxId, token, createdAt: this.iso(now) };
  }

  // ---- invitations ----

  createInvitation(callerInboxId: string, body: { inviterInboxId?: unknown }): CreateInvitationResponse {
    if (body.inviterInboxId !== undefined && body.inviterInboxId !== callerInboxId) {
      throw new HttpError(403, "inviterInboxId does not match the authenticated inbox");
    }
    const invitationId = id("", 16);
    const now = this.now();
    const expiresAt = now + INVITATION_TTL_MS;
    this.db
      .prepare("INSERT INTO invitations (id, inviter_inbox_id, status, created_at, expires_at) VALUES (?, ?, 'pending', ?, ?)")
      .run(invitationId, callerInboxId, now, expiresAt);
    return { invitationId, inviterInboxId: callerInboxId, expiresAt: this.iso(expiresAt) };
  }

  private getInvitation(invitationId: string): InvitationRow {
    const row = this.db.prepare("SELECT * FROM invitations WHERE id = ?").get(invitationId) as InvitationRow | undefined;
    if (!row) throw new HttpError(404, "Invitation not found");
    if (row.status === "pending" && row.expires_at <= this.now()) {
      this.db.prepare("UPDATE invitations SET status = 'expired' WHERE id = ?").run(invitationId);
      row.status = "expired";
    }
    return row;
  }

  invitationInfo(invitationId: string): InvitationInfoResponse {
    const row = this.getInvitation(invitationId);
    return { invitationId: row.id, inviterInboxId: row.inviter_inbox_id, status: row.status, expiresAt: this.iso(row.expires_at) };
  }

  cancelInvitation(callerInboxId: string, invitationId: string): InvitationInfoResponse {
    return this.tx(() => {
      const row = this.getInvitation(invitationId);
      if (row.inviter_inbox_id !== callerInboxId) throw new HttpError(403, "Only the inviter can cancel an invitation");
      if (row.status === "accepted") throw new HttpError(409, "Invitation was already accepted; disconnect the connection instead");
      if (row.status === "pending") {
        this.db.prepare("UPDATE invitations SET status = 'cancelled' WHERE id = ?").run(invitationId);
        row.status = "cancelled";
      }
      return { invitationId: row.id, inviterInboxId: row.inviter_inbox_id, status: row.status, expiresAt: this.iso(row.expires_at) };
    });
  }

  submitHandshake(callerInboxId: string, invitationId: string, req: Partial<HandshakeSubmissionRequest>): HandshakeSubmissionResponse {
    if (req.senderInboxId !== undefined && req.senderInboxId !== callerInboxId) {
      throw new HttpError(403, "senderInboxId does not match the authenticated inbox");
    }
    const n = req.messageNumber;
    if (n !== 1 && n !== 2 && n !== 3) throw new HttpError(400, "messageNumber must be 1, 2 or 3");
    const payload = req.payload;
    if (typeof payload !== "string" || payload.length === 0 || !BASE64URL.test(payload) || decodedLength(payload) > MAX_HANDSHAKE_BYTES) {
      throw new HttpError(400, "payload must be a base64url handshake frame");
    }

    return this.tx(() => {
      const invitation = this.getInvitation(invitationId);

      if (n === 1) {
        if (callerInboxId === invitation.inviter_inbox_id) throw new HttpError(400, "You cannot accept your own invitation");
        if (invitation.status === "accepted" && invitation.connection_id) {
          // Idempotent retry by the same accepter with the same frame.
          const conn = this.getConnection(invitation.connection_id);
          if (conn.accepter_inbox_id === callerInboxId && this.storedFrame(conn.id, 1) === payload) {
            return { status: "received", connectionId: conn.id };
          }
        }
        if (invitation.status === "expired") throw new HttpError(410, "Invitation has expired");
        if (invitation.status === "cancelled") throw new HttpError(410, "Invitation was cancelled");
        if (invitation.status !== "pending") throw new HttpError(409, "Invitation has already been used");

        const connectionId = id("conn_");
        const now = this.now();
        this.db
          .prepare(
            `INSERT INTO connections (id, invitation_id, inviter_inbox_id, accepter_inbox_id, status, handshake_step, handshake_payloads, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'handshaking', 1, ?, ?, ?)`
          )
          .run(connectionId, invitation.id, invitation.inviter_inbox_id, callerInboxId, JSON.stringify({ 1: payload }), now, now);
        this.db.prepare("UPDATE invitations SET status = 'accepted', connection_id = ? WHERE id = ?").run(connectionId, invitation.id);
        this.enqueue(invitation.inviter_inbox_id, { type: "handshake", connectionId, invitationId: invitation.id, messageNumber: 1, payload });
        return { status: "received", connectionId };
      }

      if (!invitation.connection_id) throw new HttpError(409, "Handshake has not started");
      const conn = this.getConnection(invitation.connection_id);
      if (conn.status === "closed") throw new HttpError(410, "Connection is closed");
      const expectedSender = n === 2 ? conn.inviter_inbox_id : conn.accepter_inbox_id;
      const recipient = n === 2 ? conn.accepter_inbox_id : conn.inviter_inbox_id;
      if (callerInboxId !== expectedSender) throw new HttpError(403, `Handshake message ${n} must come from the ${n === 2 ? "inviter" : "accepter"}`);

      const ready = (): HandshakeSubmissionResponse =>
        n === 3 ? { status: "connection_ready", connectionId: conn.id } : { status: "received", connectionId: conn.id };
      if (conn.handshake_step >= n) {
        if (this.storedFrame(conn.id, n) === payload) return ready();
        throw new HttpError(409, `Handshake message ${n} was already submitted`);
      }
      if (conn.handshake_step !== n - 1) throw new HttpError(409, `Expected handshake message ${conn.handshake_step + 1}`);

      const frames = this.frames(conn.id);
      frames[n] = payload;
      this.db
        .prepare("UPDATE connections SET handshake_step = ?, handshake_payloads = ?, status = ?, updated_at = ? WHERE id = ?")
        .run(n, JSON.stringify(frames), n === 3 ? "active" : "handshaking", this.now(), conn.id);
      this.enqueue(recipient, { type: "handshake", connectionId: conn.id, invitationId: invitation.id, messageNumber: n, payload });
      return ready();
    });
  }

  // ---- connections ----

  private getConnection(connectionId: string): ConnectionRow {
    const row = this.db.prepare("SELECT * FROM connections WHERE id = ?").get(connectionId) as ConnectionRow | undefined;
    if (!row) throw new HttpError(404, "Connection not found");
    return row;
  }

  private frames(connectionId: string): Record<number, string> {
    const row = this.db.prepare("SELECT handshake_payloads FROM connections WHERE id = ?").get(connectionId) as { handshake_payloads: string };
    return JSON.parse(row.handshake_payloads) as Record<number, string>;
  }

  private storedFrame(connectionId: string, n: number): string | undefined {
    return this.frames(connectionId)[n];
  }

  private participant(conn: ConnectionRow, inboxId: string): { peer: string } {
    if (inboxId === conn.inviter_inbox_id) return { peer: conn.accepter_inbox_id };
    if (inboxId === conn.accepter_inbox_id) return { peer: conn.inviter_inbox_id };
    throw new HttpError(403, "Not a participant in this connection");
  }

  postMessage(callerInboxId: string, connectionId: string, req: Partial<PostMessageRequest>): { messageId: string; status: "queued" } {
    const { messageId, nonce, ciphertext } = req;
    if (typeof messageId !== "string" || messageId.length === 0 || messageId.length > 128) throw new HttpError(400, "Invalid messageId");
    if (typeof nonce !== "number" || !Number.isSafeInteger(nonce) || nonce < 0) throw new HttpError(400, "Invalid nonce");
    if (typeof ciphertext !== "string" || !BASE64URL.test(ciphertext) || ciphertext.length === 0) throw new HttpError(400, "Invalid ciphertext");
    if (decodedLength(ciphertext) > MAX_CIPHERTEXT_BYTES) throw new HttpError(413, "Ciphertext too large");

    return this.tx(() => {
      const conn = this.getConnection(connectionId);
      const { peer } = this.participant(conn, callerInboxId);
      if (conn.status === "closed") throw new HttpError(410, "Connection is closed");
      if (conn.status !== "active") throw new HttpError(409, "Connection handshake is not complete");

      const inserted = this.db
        .prepare("INSERT OR IGNORE INTO delivered_messages (connection_id, sender_inbox_id, message_id, created_at) VALUES (?, ?, ?, ?)")
        .run(connectionId, callerInboxId, messageId, this.now());
      if (inserted.changes > 0) {
        this.enqueue(peer, { type: "message", connectionId, senderInboxId: callerInboxId, messageId, nonce, ciphertext });
      }
      return { messageId, status: "queued" };
    });
  }

  disconnect(callerInboxId: string, connectionId: string): { status: "disconnected" } {
    return this.tx(() => {
      const conn = this.getConnection(connectionId);
      const { peer } = this.participant(conn, callerInboxId);
      if (conn.status !== "closed") {
        this.db.prepare("UPDATE connections SET status = 'closed', updated_at = ? WHERE id = ?").run(this.now(), connectionId);
        this.enqueue(peer, { type: "disconnect", connectionId });
      }
      return { status: "disconnected" };
    });
  }

  // ---- events ----

  pollEvents(inboxId: string): { events: RelayEvent[] } {
    const rows = this.db
      .prepare("SELECT body FROM events WHERE inbox_id = ? ORDER BY seq LIMIT ?")
      .all(inboxId, MAX_EVENTS_PER_POLL) as { body: string }[];
    return { events: rows.map((r) => JSON.parse(r.body) as RelayEvent) };
  }

  ackEvents(inboxId: string, body: { eventIds?: unknown }): { acknowledgedCount: number } {
    const ids = body.eventIds;
    if (!Array.isArray(ids) || ids.length > 1000 || !ids.every((x) => typeof x === "string")) {
      throw new HttpError(400, "eventIds must be an array of strings");
    }
    return this.tx(() => {
      const stmt = this.db.prepare("DELETE FROM events WHERE id = ? AND inbox_id = ?");
      let count = 0;
      for (const eventId of ids as string[]) count += Number(stmt.run(eventId, inboxId).changes);
      return { acknowledgedCount: count };
    });
  }

  // ---- housekeeping ----

  prune(): void {
    const now = this.now();
    this.db.prepare("UPDATE invitations SET status = 'expired' WHERE status = 'pending' AND expires_at <= ?").run(now);
    this.db.prepare("DELETE FROM events WHERE created_at < ?").run(now - EVENT_RETENTION_MS);
    this.db.prepare("DELETE FROM delivered_messages WHERE created_at < ?").run(now - EVENT_RETENTION_MS);
    this.db.prepare("UPDATE connections SET handshake_payloads = '{}' WHERE status != 'handshaking' AND updated_at < ?").run(now - INVITATION_TTL_MS);
  }
}
