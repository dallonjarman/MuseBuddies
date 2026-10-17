// Local, private client state: identity keys, contacts with session keys, messages, outbox, groups.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AvailabilityRequest, AvailabilityResponse, GroupInfo, PlanEvent, Priority, SharingGrants, TimeSlot } from "../shared/protocol.ts";

// Settings read MUSEBUDDIES_<name>, falling back to MUSETOGETHER_<name> from before the rename.
export function setting(name: string): string | undefined {
  return process.env[`MUSEBUDDIES_${name}`] ?? process.env[`MUSETOGETHER_${name}`];
}

// ~/.musebuddies, or ~/.musetogether when a store from before the rename lives there. It checks for
// the database itself, since reinstalling creates ~/.musebuddies for the CLI's files.
export function storeDir(): string {
  const configured = setting("DIR");
  if (configured) return configured;
  const current = path.join(os.homedir(), ".musebuddies");
  const legacy = path.join(os.homedir(), ".musetogether");
  const has = (dir: string): boolean => fs.existsSync(path.join(dir, "state.db"));
  return !has(current) && has(legacy) ? legacy : current;
}

export interface Identity {
  inboxId: string;
  token: string;
  staticPrivateKey: string;
  staticPublicKey: string;
  relayUrl: string;
  createdAt: string;
}

/** needs_repair: session keys can't be used safely after a restore; re-invite this contact. */
export type ContactStatus = "pending_handshake" | "active" | "disconnected" | "needs_repair";

export interface Contact {
  alias: string;
  role: "inviter" | "accepter";
  status: ContactStatus;
  invitationId: string;
  connectionId: string | null;
  psk: string;
  handshakeState: string | null;
  peerStaticKey: string | null;
  peerFeatures: string[];
  /** What this contact's Muse has said it shares with us automatically. */
  peerGrants: SharingGrants | null;
  sendKey: string | null;
  sendNonce: number;
  receiveKey: string | null;
  receiveNonce: number;
  createdAt: string;
  updatedAt: string;
}

export type MessageStatus = "pending_send" | "sent" | "pending_muse" | "handled" | "superseded";

export interface Message {
  messageId: string;
  connectionId: string;
  contact: string | null;
  conversationId: string;
  inReplyTo: string | null;
  direction: "inbound" | "outbound";
  body: string;
  status: MessageStatus;
  priority: Priority;
  updateKey: string | null;
  group: GroupInfo | null;
  event: PlanEvent | null;
  availabilityRequest: AvailabilityRequest | null;
  availabilityResponse: AvailabilityResponse | null;
  sentAt: string;
  createdAt: string;
  /** Outbound: when the peer's Muse confirmed receipt / handed it to its owner. */
  deliveredAt: string | null;
  handledAt: string | null;
}

export interface OutboxItem {
  messageId: string;
  connectionId: string;
  nonce: number;
  ciphertext: string;
}

export interface Group {
  name: string;
  groupId: string;
  members: string[];
  createdAt: string;
}

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (v === null || v === undefined ? null : (v as string));
const json = <T>(v: unknown, fallback: T): T => {
  if (typeof v !== "string") return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};

const contactFromRow = (r: Row): Contact => ({
  alias: r.alias as string,
  role: r.role as Contact["role"],
  status: r.status as ContactStatus,
  invitationId: r.invitation_id as string,
  connectionId: str(r.connection_id),
  psk: r.psk as string,
  handshakeState: str(r.handshake_state),
  peerStaticKey: str(r.peer_static_key),
  peerFeatures: json<string[]>(r.peer_features, []),
  peerGrants: json<SharingGrants | null>(r.peer_grants, null),
  sendKey: str(r.send_key),
  sendNonce: Number(r.send_nonce),
  receiveKey: str(r.receive_key),
  receiveNonce: Number(r.receive_nonce),
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string
});

const messageFromRow = (r: Row): Message => ({
  messageId: r.message_id as string,
  connectionId: r.connection_id as string,
  contact: str(r.alias),
  conversationId: r.conversation_id as string,
  inReplyTo: str(r.in_reply_to),
  direction: r.direction as Message["direction"],
  body: r.body as string,
  status: r.status as MessageStatus,
  priority: r.priority === "urgent" ? "urgent" : "normal",
  updateKey: str(r.update_key),
  group: json<GroupInfo | null>(r.group_json, null),
  event: json<PlanEvent | null>(r.event_json, null),
  availabilityRequest: json<AvailabilityRequest | null>(r.availability_request_json, null),
  availabilityResponse: json<AvailabilityResponse | null>(r.availability_response_json, null),
  sentAt: r.sent_at as string,
  createdAt: r.created_at as string,
  deliveredAt: str(r.delivered_at),
  handledAt: str(r.handled_at)
});

/** Columns added after the first release; added to existing stores on open. */
const MIGRATIONS: [table: string, column: string, ddl: string][] = [
  ["messages", "priority", "TEXT NOT NULL DEFAULT 'normal'"],
  ["messages", "update_key", "TEXT"],
  ["messages", "group_json", "TEXT"],
  ["messages", "event_json", "TEXT"],
  ["messages", "delivered_at", "TEXT"],
  ["messages", "handled_at", "TEXT"],
  ["contacts", "peer_features", "TEXT NOT NULL DEFAULT '[]'"],
  ["contacts", "peer_grants", "TEXT"],
  ["messages", "availability_request_json", "TEXT"],
  ["messages", "availability_response_json", "TEXT"]
];

/** A standing permission this owner gave one contact's Muse. Bound to the connection, not just the name. */
export interface AvailabilityGrant {
  alias: string;
  connectionId: string;
  daysAhead: number;
  hours: string | null;
  timezone: string;
  maxPerDay: number;
  expiresAt: string | null;
  createdAt: string;
}

export interface OrganizedRequest {
  requestId: string;
  conversationId: string;
  from: string;
  to: string;
  durationMinutes: number;
  note: string | null;
  participants: string[];
  createdAt: string;
}

export interface ReceivedAvailability {
  contact: string;
  status: "answered" | "declined";
  free: TimeSlot[];
  automatic: boolean;
  coveredFrom: string | null;
  coveredTo: string | null;
  receivedAt: string;
}

const grantFromRow = (r: Row): AvailabilityGrant => ({
  alias: r.alias as string,
  connectionId: r.connection_id as string,
  daysAhead: Number(r.days_ahead),
  hours: str(r.hours),
  timezone: r.timezone as string,
  maxPerDay: Number(r.max_per_day),
  expiresAt: str(r.expires_at),
  createdAt: r.created_at as string
});

const MESSAGE_SELECT = "SELECT m.*, c.alias FROM messages m LEFT JOIN contacts c ON c.connection_id = m.connection_id";

export class Store {
  readonly dir: string;
  readonly db: DatabaseSync;

  constructor(dir = storeDir(), readOnly = false) {
    this.dir = dir;
    const dbPath = path.join(dir, "state.db");
    if (readOnly) {
      this.db = new DatabaseSync(dbPath, { readOnly: true });
      return;
    }
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(dbPath);
    try {
      fs.chmodSync(dbPath, 0o600);
    } catch {
      // best effort
    }
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS identity (
        inbox_id TEXT PRIMARY KEY, token TEXT NOT NULL, static_private_key TEXT NOT NULL,
        static_public_key TEXT NOT NULL, relay_url TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS contacts (
        alias TEXT PRIMARY KEY, role TEXT NOT NULL, status TEXT NOT NULL, invitation_id TEXT NOT NULL,
        connection_id TEXT UNIQUE, psk TEXT NOT NULL, handshake_state TEXT, peer_static_key TEXT,
        send_key TEXT, send_nonce INTEGER NOT NULL DEFAULT 0, receive_key TEXT, receive_nonce INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        message_id TEXT PRIMARY KEY, connection_id TEXT NOT NULL, conversation_id TEXT NOT NULL, in_reply_to TEXT,
        direction TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL, sent_at TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS outbox (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT NOT NULL UNIQUE, connection_id TEXT NOT NULL,
        nonce INTEGER NOT NULL, ciphertext TEXT NOT NULL, status TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS processed_events (event_id TEXT PRIMARY KEY, processed_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS availability_grants (
        alias TEXT PRIMARY KEY, connection_id TEXT NOT NULL, days_ahead INTEGER NOT NULL, hours TEXT, timezone TEXT NOT NULL,
        max_per_day INTEGER NOT NULL, expires_at TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS availability_answers (
        request_id TEXT NOT NULL, connection_id TEXT NOT NULL, automatic INTEGER NOT NULL, answered_at TEXT NOT NULL,
        PRIMARY KEY (request_id, connection_id)
      );
      CREATE TABLE IF NOT EXISTS availability_requests (
        request_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, from_at TEXT NOT NULL, to_at TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL, note TEXT, participants TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS availability_responses (
        request_id TEXT NOT NULL, contact TEXT NOT NULL, status TEXT NOT NULL, free TEXT NOT NULL, automatic INTEGER NOT NULL,
        covered_from TEXT, covered_to TEXT, received_at TEXT NOT NULL, PRIMARY KEY (request_id, contact)
      );
      CREATE TABLE IF NOT EXISTS contact_groups (
        name TEXT PRIMARY KEY, group_id TEXT NOT NULL UNIQUE, members TEXT NOT NULL, created_at TEXT NOT NULL
      );
    `);
    this.migrate();
    this.db.exec("CREATE INDEX IF NOT EXISTS messages_by_conversation ON messages(conversation_id, sent_at)");
  }

  private migrate(): void {
    for (const [table, column, ddl] of MIGRATIONS) {
      const columns = (this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
      if (!columns.includes(column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    }
  }

  close(): void {
    this.db.close();
  }

  tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  // ---- identity ----

  getIdentity(): Identity | null {
    const r = this.db.prepare("SELECT * FROM identity LIMIT 1").get() as Row | undefined;
    if (!r) return null;
    return {
      inboxId: r.inbox_id as string,
      token: r.token as string,
      staticPrivateKey: r.static_private_key as string,
      staticPublicKey: r.static_public_key as string,
      relayUrl: r.relay_url as string,
      createdAt: r.created_at as string
    };
  }

  saveIdentity(i: Identity): void {
    this.db
      .prepare("INSERT INTO identity VALUES (?, ?, ?, ?, ?, ?)")
      .run(i.inboxId, i.token, i.staticPrivateKey, i.staticPublicKey, i.relayUrl, i.createdAt);
  }

  // ---- contacts ----

  getContact(alias: string): Contact | null {
    const r = this.db.prepare("SELECT * FROM contacts WHERE alias = ?").get(alias) as Row | undefined;
    return r ? contactFromRow(r) : null;
  }

  getContactByConnection(connectionId: string): Contact | null {
    const r = this.db.prepare("SELECT * FROM contacts WHERE connection_id = ?").get(connectionId) as Row | undefined;
    return r ? contactFromRow(r) : null;
  }

  getPendingInvite(invitationId: string): Contact | null {
    const r = this.db
      .prepare("SELECT * FROM contacts WHERE invitation_id = ? AND role = 'inviter' AND status = 'pending_handshake'")
      .get(invitationId) as Row | undefined;
    return r ? contactFromRow(r) : null;
  }

  listContacts(): Contact[] {
    return (this.db.prepare("SELECT * FROM contacts ORDER BY created_at").all() as Row[]).map(contactFromRow);
  }

  saveContact(c: Contact): void {
    c.updatedAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO contacts (alias, role, status, invitation_id, connection_id, psk, handshake_state, peer_static_key,
           peer_features, peer_grants, send_key, send_nonce, receive_key, receive_nonce, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(c.alias, c.role, c.status, c.invitationId, c.connectionId, c.psk, c.handshakeState, c.peerStaticKey,
        JSON.stringify(c.peerFeatures), c.peerGrants ? JSON.stringify(c.peerGrants) : null, c.sendKey, c.sendNonce, c.receiveKey, c.receiveNonce, c.createdAt, c.updatedAt);
  }

  deleteContact(alias: string): void {
    this.db.prepare("DELETE FROM contacts WHERE alias = ?").run(alias);
  }

  // ---- messages ----

  hasMessage(messageId: string): boolean {
    return this.db.prepare("SELECT 1 FROM messages WHERE message_id = ?").get(messageId) !== undefined;
  }

  getMessage(messageId: string): Message | null {
    const r = this.db.prepare(`${MESSAGE_SELECT} WHERE m.message_id = ?`).get(messageId) as Row | undefined;
    return r ? messageFromRow(r) : null;
  }

  saveMessage(m: Omit<Message, "contact" | "deliveredAt" | "handledAt">): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO messages
           (message_id, connection_id, conversation_id, in_reply_to, direction, body, status, priority,
            update_key, group_json, event_json, availability_request_json, availability_response_json, sent_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(m.messageId, m.connectionId, m.conversationId, m.inReplyTo, m.direction, m.body, m.status, m.priority,
        m.updateKey, m.group ? JSON.stringify(m.group) : null, m.event ? JSON.stringify(m.event) : null,
        m.availabilityRequest ? JSON.stringify(m.availabilityRequest) : null,
        m.availabilityResponse ? JSON.stringify(m.availabilityResponse) : null, m.sentAt, m.createdAt);
  }

  /** Marks earlier unread messages from the same connection with the same update key as superseded. */
  supersede(connectionId: string, updateKey: string, newerSentAt: string): number {
    const r = this.db
      .prepare(
        `UPDATE messages SET status = 'superseded'
         WHERE connection_id = ? AND update_key = ? AND direction = 'inbound' AND status = 'pending_muse' AND sent_at <= ?`
      )
      .run(connectionId, updateKey, newerSentAt);
    return Number(r.changes);
  }

  pendingMessages(): Message[] {
    const rows = this.db
      .prepare(`${MESSAGE_SELECT} WHERE m.status = 'pending_muse' ORDER BY m.priority = 'urgent' DESC, m.created_at`)
      .all() as Row[];
    return rows.map(messageFromRow);
  }

  markHandled(messageId: string): boolean {
    const r = this.db
      .prepare("UPDATE messages SET status = 'handled', handled_at = ? WHERE message_id = ? AND direction = 'inbound' AND status IN ('pending_muse', 'superseded')")
      .run(new Date().toISOString(), messageId);
    return Number(r.changes) > 0;
  }

  /** Applies a peer's receipt to our outbound messages on that connection. */
  applyReceipt(connectionId: string, state: "delivered" | "handled", messageIds: string[], at: string): void {
    const stmt =
      state === "delivered"
        ? this.db.prepare("UPDATE messages SET delivered_at = COALESCE(delivered_at, ?) WHERE message_id = ? AND connection_id = ? AND direction = 'outbound'")
        : this.db.prepare(
            "UPDATE messages SET handled_at = COALESCE(handled_at, ?), delivered_at = COALESCE(delivered_at, ?) WHERE message_id = ? AND connection_id = ? AND direction = 'outbound'"
          );
    for (const id of messageIds) {
      if (state === "delivered") stmt.run(at, id, connectionId);
      else stmt.run(at, at, id, connectionId);
    }
  }

  listMessages(filter: { conversationId?: string; contact?: string; direction?: "inbound" | "outbound"; limit?: number }): Message[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (filter.conversationId) {
      where.push("m.conversation_id = ?");
      args.push(filter.conversationId);
    }
    if (filter.contact) {
      where.push("c.alias = ?");
      args.push(filter.contact);
    }
    if (filter.direction) {
      where.push("m.direction = ?");
      args.push(filter.direction);
    }
    const sql = `${MESSAGE_SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY m.sent_at DESC, m.created_at DESC LIMIT ?`;
    args.push(filter.limit ?? 50);
    return (this.db.prepare(sql).all(...args) as Row[]).map(messageFromRow).reverse();
  }

  // ---- outbox ----

  queueOutbox(item: OutboxItem): void {
    this.db
      .prepare("INSERT INTO outbox (message_id, connection_id, nonce, ciphertext, status) VALUES (?, ?, ?, ?, 'pending')")
      .run(item.messageId, item.connectionId, item.nonce, item.ciphertext);
  }

  pendingOutbox(connectionId?: string): OutboxItem[] {
    const sql = "SELECT message_id, connection_id, nonce, ciphertext FROM outbox WHERE status = 'pending'";
    const rows = (connectionId
      ? this.db.prepare(`${sql} AND connection_id = ? ORDER BY seq`).all(connectionId)
      : this.db.prepare(`${sql} ORDER BY seq`).all()) as Row[];
    return rows.map((r) => ({
      messageId: r.message_id as string,
      connectionId: r.connection_id as string,
      nonce: Number(r.nonce),
      ciphertext: r.ciphertext as string
    }));
  }

  markOutboxSent(messageId: string): void {
    this.tx(() => {
      this.db.prepare("UPDATE outbox SET status = 'sent' WHERE message_id = ?").run(messageId);
      this.db.prepare("UPDATE messages SET status = 'sent' WHERE message_id = ? AND status = 'pending_send'").run(messageId);
    });
  }

  cancelOutbox(connectionId: string): void {
    this.db.prepare("UPDATE outbox SET status = 'cancelled' WHERE connection_id = ? AND status = 'pending'").run(connectionId);
  }

  // ---- events ----

  isProcessed(eventId: string): boolean {
    return this.db.prepare("SELECT 1 FROM processed_events WHERE event_id = ?").get(eventId) !== undefined;
  }

  markProcessed(eventId: string): void {
    this.db.prepare("INSERT OR IGNORE INTO processed_events VALUES (?, ?)").run(eventId, new Date().toISOString());
  }

  /** The inbound message carrying an availability request. */
  findAvailabilityRequestMessage(requestId: string): Message | null {
    const rows = this.db
      .prepare(`${MESSAGE_SELECT} WHERE m.direction = 'inbound' AND m.availability_request_json IS NOT NULL ORDER BY m.created_at DESC`)
      .all() as Row[];
    return rows.map(messageFromRow).find((m) => m.availabilityRequest?.requestId === requestId) ?? null;
  }

  // ---- availability: what we share ----

  saveGrant(g: AvailabilityGrant): void {
    this.db
      .prepare("INSERT OR REPLACE INTO availability_grants VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(g.alias, g.connectionId, g.daysAhead, g.hours, g.timezone, g.maxPerDay, g.expiresAt, g.createdAt);
  }

  getGrant(alias: string): AvailabilityGrant | null {
    const r = this.db.prepare("SELECT * FROM availability_grants WHERE alias = ?").get(alias) as Row | undefined;
    return r ? grantFromRow(r) : null;
  }

  listGrants(): AvailabilityGrant[] {
    return (this.db.prepare("SELECT * FROM availability_grants ORDER BY alias").all() as Row[]).map(grantFromRow);
  }

  deleteGrant(alias: string): boolean {
    return Number(this.db.prepare("DELETE FROM availability_grants WHERE alias = ?").run(alias).changes) > 0;
  }

  recordAnswer(requestId: string, connectionId: string, automatic: boolean): void {
    this.db.prepare("INSERT OR REPLACE INTO availability_answers VALUES (?, ?, ?, ?)").run(requestId, connectionId, automatic ? 1 : 0, new Date().toISOString());
  }

  hasAnswered(requestId: string, connectionId: string): boolean {
    return this.db.prepare("SELECT 1 FROM availability_answers WHERE request_id = ? AND connection_id = ?").get(requestId, connectionId) !== undefined;
  }

  automaticAnswersSince(connectionId: string, sinceIso: string): number {
    const r = this.db
      .prepare("SELECT COUNT(*) AS n FROM availability_answers WHERE connection_id = ? AND automatic = 1 AND answered_at >= ?")
      .get(connectionId, sinceIso) as { n: number };
    return Number(r.n);
  }

  // ---- availability: what we organize ----

  saveOrganizedRequest(r: OrganizedRequest): void {
    this.db
      .prepare("INSERT INTO availability_requests VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(r.requestId, r.conversationId, r.from, r.to, r.durationMinutes, r.note, JSON.stringify(r.participants), r.createdAt);
  }

  getOrganizedRequest(requestId: string): OrganizedRequest | null {
    const r = this.db.prepare("SELECT * FROM availability_requests WHERE request_id = ?").get(requestId) as Row | undefined;
    if (!r) return null;
    return {
      requestId: r.request_id as string,
      conversationId: r.conversation_id as string,
      from: r.from_at as string,
      to: r.to_at as string,
      durationMinutes: Number(r.duration_minutes),
      note: str(r.note),
      participants: json<string[]>(r.participants, []),
      createdAt: r.created_at as string
    };
  }

  listOrganizedRequests(): OrganizedRequest[] {
    const ids = this.db.prepare("SELECT request_id FROM availability_requests ORDER BY created_at DESC LIMIT 50").all() as Row[];
    return ids.map((r) => this.getOrganizedRequest(r.request_id as string)!);
  }

  saveReceivedAvailability(requestId: string, a: ReceivedAvailability): void {
    this.db
      .prepare("INSERT OR REPLACE INTO availability_responses VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(requestId, a.contact, a.status, JSON.stringify(a.free), a.automatic ? 1 : 0, a.coveredFrom, a.coveredTo, a.receivedAt);
  }

  receivedAvailability(requestId: string): ReceivedAvailability[] {
    return (this.db.prepare("SELECT * FROM availability_responses WHERE request_id = ?").all(requestId) as Row[]).map((r) => ({
      contact: r.contact as string,
      status: r.status as ReceivedAvailability["status"],
      free: json<TimeSlot[]>(r.free, []),
      automatic: Number(r.automatic) === 1,
      coveredFrom: str(r.covered_from),
      coveredTo: str(r.covered_to),
      receivedAt: r.received_at as string
    }));
  }

  // ---- groups ----

  saveGroup(g: Group): void {
    this.db
      .prepare("INSERT OR REPLACE INTO contact_groups (name, group_id, members, created_at) VALUES (?, ?, ?, ?)")
      .run(g.name, g.groupId, JSON.stringify(g.members), g.createdAt);
  }

  getGroup(name: string): Group | null {
    const r = this.db.prepare("SELECT * FROM contact_groups WHERE name = ?").get(name) as Row | undefined;
    return r ? { name: r.name as string, groupId: r.group_id as string, members: json<string[]>(r.members, []), createdAt: r.created_at as string } : null;
  }

  listGroups(): Group[] {
    return (this.db.prepare("SELECT * FROM contact_groups ORDER BY name").all() as Row[]).map((r) => ({
      name: r.name as string,
      groupId: r.group_id as string,
      members: json<string[]>(r.members, []),
      createdAt: r.created_at as string
    }));
  }

  deleteGroup(name: string): boolean {
    return Number(this.db.prepare("DELETE FROM contact_groups WHERE name = ?").run(name).changes) > 0;
  }
}
