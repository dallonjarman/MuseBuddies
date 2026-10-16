// Local, private client state: identity keys, contacts with session keys, messages, outbox.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export function storeDir(): string {
  return process.env.MUSETOGETHER_DIR ?? path.join(os.homedir(), ".musetogether");
}

export interface Identity {
  inboxId: string;
  token: string;
  staticPrivateKey: string;
  staticPublicKey: string;
  relayUrl: string;
  createdAt: string;
}

export type ContactStatus = "pending_handshake" | "active" | "disconnected";

export interface Contact {
  alias: string;
  role: "inviter" | "accepter";
  status: ContactStatus;
  invitationId: string;
  connectionId: string | null;
  psk: string;
  handshakeState: string | null;
  peerStaticKey: string | null;
  sendKey: string | null;
  sendNonce: number;
  receiveKey: string | null;
  receiveNonce: number;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  messageId: string;
  connectionId: string;
  contact: string | null;
  conversationId: string;
  inReplyTo: string | null;
  direction: "inbound" | "outbound";
  body: string;
  status: "pending_send" | "sent" | "pending_muse" | "handled";
  priority: "normal" | "urgent";
  sentAt: string;
  createdAt: string;
}

export interface OutboxItem {
  messageId: string;
  connectionId: string;
  nonce: number;
  ciphertext: string;
}

type Row = Record<string, unknown>;

const contactFromRow = (r: Row): Contact => ({
  alias: r.alias as string,
  role: r.role as Contact["role"],
  status: r.status as ContactStatus,
  invitationId: r.invitation_id as string,
  connectionId: (r.connection_id as string | null) ?? null,
  psk: r.psk as string,
  handshakeState: (r.handshake_state as string | null) ?? null,
  peerStaticKey: (r.peer_static_key as string | null) ?? null,
  sendKey: (r.send_key as string | null) ?? null,
  sendNonce: Number(r.send_nonce),
  receiveKey: (r.receive_key as string | null) ?? null,
  receiveNonce: Number(r.receive_nonce),
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string
});

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
      PRAGMA busy_timeout = 3000;
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
    `);
    this.migrate();
  }

  private migrate(): void {
    const columns = (this.db.prepare("PRAGMA table_info(messages)").all() as { name: string }[]).map((c) => c.name);
    if (!columns.includes("priority")) {
      this.db.exec("ALTER TABLE messages ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'");
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

  // identity
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

  // contacts
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
           send_key, send_nonce, receive_key, receive_nonce, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(c.alias, c.role, c.status, c.invitationId, c.connectionId, c.psk, c.handshakeState, c.peerStaticKey,
        c.sendKey, c.sendNonce, c.receiveKey, c.receiveNonce, c.createdAt, c.updatedAt);
  }

  // messages
  hasMessage(messageId: string): boolean {
    return this.db.prepare("SELECT 1 FROM messages WHERE message_id = ?").get(messageId) !== undefined;
  }

  saveMessage(m: Omit<Message, "contact">): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO messages
           (message_id, connection_id, conversation_id, in_reply_to, direction, body, status, priority, sent_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(m.messageId, m.connectionId, m.conversationId, m.inReplyTo, m.direction, m.body, m.status, m.priority, m.sentAt, m.createdAt);
  }

  pendingMessages(): Message[] {
    const rows = this.db
      .prepare(
        `SELECT m.*, c.alias FROM messages m LEFT JOIN contacts c ON c.connection_id = m.connection_id
         WHERE m.status = 'pending_muse' ORDER BY m.priority = 'urgent' DESC, m.created_at`
      )
      .all() as Row[];
    return rows.map((r) => ({
      messageId: r.message_id as string,
      connectionId: r.connection_id as string,
      contact: (r.alias as string | null) ?? null,
      conversationId: r.conversation_id as string,
      inReplyTo: (r.in_reply_to as string | null) ?? null,
      direction: r.direction as Message["direction"],
      body: r.body as string,
      status: r.status as Message["status"],
      priority: r.priority === "urgent" ? "urgent" : "normal",
      sentAt: r.sent_at as string,
      createdAt: r.created_at as string
    }));
  }

  markHandled(messageId: string): boolean {
    const r = this.db.prepare("UPDATE messages SET status = 'handled' WHERE message_id = ? AND status = 'pending_muse'").run(messageId);
    return Number(r.changes) > 0;
  }

  // outbox
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

  // events
  isProcessed(eventId: string): boolean {
    return this.db.prepare("SELECT 1 FROM processed_events WHERE event_id = ?").get(eventId) !== undefined;
  }

  markProcessed(eventId: string): void {
    this.db.prepare("INSERT OR IGNORE INTO processed_events VALUES (?, ?)").run(eventId, new Date().toISOString());
  }
}
