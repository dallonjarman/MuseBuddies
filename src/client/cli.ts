#!/usr/bin/env node
// musetogether: the CLI a Muse runs to pair with, and message, other Muses through a relay.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  decrypt,
  encrypt,
  generateKeyPair,
  initiatorReadMessage2WriteMessage3,
  initiatorWriteMessage1,
  responderReadMessage1WriteMessage2,
  responderReadMessage3,
  type InitiatorState,
  type KeyPair,
  type ResponderState
} from "../shared/noise.ts";
import {
  MAX_PLAINTEXT_BYTES,
  inviteUrl,
  parseInviteUrl,
  validateApplicationPayload,
  type ApplicationPayload,
  type CreateInvitationResponse,
  type HandshakeEvent,
  type HandshakeSubmissionRequest,
  type HandshakeSubmissionResponse,
  type MessageEvent,
  type RegisterInboxResponse,
  type RelayEvent
} from "../shared/protocol.ts";
import { Store, storeDir, type Contact, type Identity } from "./store.ts";

const clientDir = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_RELAY = process.env.MUSETOGETHER_RELAY_URL ?? "https://musetogether.ai";
const EMPTY = Buffer.alloc(0);

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Ahead-of-order transport frame; leave it on the relay until the gap fills. */
class NonceAheadError extends Error {}

export class RelayClient {
  readonly baseUrl: string;
  readonly token: string | null;
  constructor(baseUrl: string, token: string | null = null) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token;
  }

  async request<T>(method: string, endpoint: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const res = await fetch(this.baseUrl + endpoint, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000)
    });
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        message = ((await res.json()) as { error?: string }).error ?? message;
      } catch {
        // keep status text
      }
      throw new ApiError(res.status, message);
    }
    return (await res.json()) as T;
  }
}

const isPermanentRejection = (err: unknown): boolean => err instanceof ApiError && [403, 404, 410].includes(err.status);
const isTransient = (err: unknown): boolean =>
  (err instanceof ApiError && (err.status >= 500 || err.status === 408 || err.status === 429)) ||
  (err instanceof Error && (err.name === "TimeoutError" || /fetch failed|ECONN|ETIMEDOUT/i.test(err.message)));

export class MuseTogether {
  readonly store: Store;
  constructor(store = new Store()) {
    this.store = store;
  }

  private session(): { identity: Identity; relay: RelayClient; keys: KeyPair } {
    const identity = this.store.getIdentity();
    if (!identity) throw new Error("MuseTogether is not set up. Run 'musetogether setup' first.");
    return {
      identity,
      relay: new RelayClient(identity.relayUrl, identity.token),
      keys: { pub: Buffer.from(identity.staticPublicKey, "base64url"), priv: Buffer.from(identity.staticPrivateKey, "base64url") }
    };
  }

  async setup(relayUrl = DEFAULT_RELAY): Promise<object> {
    const existing = this.store.getIdentity();
    if (existing) return { status: "already_configured", inboxId: existing.inboxId, relayUrl: existing.relayUrl };
    const reg = await new RelayClient(relayUrl).request<RegisterInboxResponse>("POST", "/v1/inboxes");
    const keys = generateKeyPair();
    this.store.saveIdentity({
      inboxId: reg.inboxId,
      token: reg.token,
      staticPrivateKey: keys.priv.toString("base64url"),
      staticPublicKey: keys.pub.toString("base64url"),
      relayUrl: relayUrl.replace(/\/+$/, ""),
      createdAt: reg.createdAt
    });
    return { status: "ready", inboxId: reg.inboxId, relayUrl };
  }

  status(): object {
    const identity = this.store.getIdentity();
    if (!identity) return { status: "not_configured" };
    const contacts = this.store.listContacts();
    return {
      status: "ready",
      inboxId: identity.inboxId,
      relayUrl: identity.relayUrl,
      totalContacts: contacts.length,
      activeContacts: contacts.filter((c) => c.status === "active").length,
      pendingMessagesCount: this.store.pendingMessages().length
    };
  }

  private assertAliasFree(alias: string): void {
    if (this.store.getContact(alias)?.status === "active") {
      throw new Error(`Contact '${alias}' is already active. Disconnect first or choose another name.`);
    }
  }

  private newContact(alias: string, role: Contact["role"], invitationId: string, psk: Buffer): Contact {
    const now = new Date().toISOString();
    return {
      alias, role, invitationId, status: "pending_handshake", connectionId: null, psk: psk.toString("base64url"),
      handshakeState: null, peerStaticKey: null, sendKey: null, sendNonce: 0, receiveKey: null, receiveNonce: 0,
      createdAt: now, updatedAt: now
    };
  }

  async inviteCreate(alias?: string): Promise<object> {
    const { identity, relay } = this.session();
    if (alias) this.assertAliasFree(alias);
    const inv = await relay.request<CreateInvitationResponse>("POST", "/v1/invitations", { inviterInboxId: identity.inboxId });
    const psk = crypto.randomBytes(32);
    const name = alias ?? `invite_${inv.invitationId.slice(0, 8)}`;
    this.store.saveContact(this.newContact(name, "inviter", inv.invitationId, psk));
    return { alias: name, invitationId: inv.invitationId, inviteUrl: inviteUrl(identity.relayUrl, inv.invitationId, psk), expiresAt: inv.expiresAt };
  }

  async inviteAccept(alias: string, url: string): Promise<object> {
    const { identity, relay } = this.session();
    this.assertAliasFree(alias);
    const { invitationId, secret } = parseInviteUrl(url, identity.relayUrl);
    const { message, state } = initiatorWriteMessage1();
    const resp = await relay.request<HandshakeSubmissionResponse>("POST", `/v1/invitations/${invitationId}/handshake`, {
      senderInboxId: identity.inboxId,
      messageNumber: 1,
      payload: message.toString("base64url")
    } satisfies HandshakeSubmissionRequest);
    if (!resp.connectionId) throw new Error("Relay did not return a connectionId");
    const contact = this.newContact(alias, "accepter", invitationId, secret);
    contact.connectionId = resp.connectionId;
    contact.handshakeState = JSON.stringify(state);
    this.store.saveContact(contact);
    return { status: "handshake_initiated", alias, connectionId: resp.connectionId };
  }

  private async sendFrame(relay: RelayClient, connectionId: string, messageId: string, nonce: number, ciphertext: string): Promise<void> {
    await relay.request("POST", `/v1/connections/${connectionId}/messages`, { messageId, nonce, ciphertext });
    this.store.markOutboxSent(messageId);
  }

  /** Delivers queued frames in FIFO order; stops a connection at its first failure. */
  private async drainOutbox(relay: RelayClient, connectionId?: string): Promise<void> {
    const blocked = new Set<string>();
    for (const item of this.store.pendingOutbox(connectionId)) {
      if (blocked.has(item.connectionId)) continue;
      try {
        await this.sendFrame(relay, item.connectionId, item.messageId, item.nonce, item.ciphertext);
      } catch (err) {
        blocked.add(item.connectionId);
        if (isPermanentRejection(err)) this.store.cancelOutbox(item.connectionId);
        process.stderr.write(`Delivery of ${item.messageId} deferred: ${String(err)}\n`);
      }
    }
  }

  async poll(): Promise<object> {
    const { relay, keys } = this.session();
    await this.drainOutbox(relay);

    const { events } = await relay.request<{ events: RelayEvent[] }>("GET", "/v1/events");
    // Transport frames must be decrypted in nonce order per connection.
    const ordered = [...events].sort((a, b) =>
      a.type === "message" && b.type === "message" && a.connectionId === b.connectionId ? a.nonce - b.nonce : 0
    );
    const ack: string[] = [];
    let processed = 0;
    for (const event of ordered) {
      try {
        if (!this.store.isProcessed(event.eventId)) {
          await this.handleEvent(event, relay, keys);
          this.store.markProcessed(event.eventId);
          processed++;
        }
        ack.push(event.eventId);
      } catch (err) {
        if (err instanceof NonceAheadError || isTransient(err)) continue;
        process.stderr.write(`Rejected event ${event.eventId}: ${String(err)}\n`);
        this.store.markProcessed(event.eventId);
        ack.push(event.eventId);
      }
    }
    if (ack.length) await relay.request("POST", "/v1/events/ack", { eventIds: ack });
    return {
      eventsProcessed: processed,
      pendingMessagesCount: this.store.pendingMessages().length,
      activeConversationsCount: this.store.listContacts().filter((c) => c.status === "active").length
    };
  }

  private async handleEvent(event: RelayEvent, relay: RelayClient, keys: KeyPair): Promise<void> {
    if (event.type === "handshake") return this.handleHandshake(event, relay, keys);
    if (event.type === "message") return this.handleMessage(event);
    const contact = this.store.getContactByConnection(event.connectionId);
    if (contact) this.closeLocally(contact);
  }

  private async handleHandshake(event: HandshakeEvent, relay: RelayClient, keys: KeyPair): Promise<void> {
    const { identity } = this.session();
    const frame = Buffer.from(event.payload, "base64url");
    const submit = (messageNumber: 2 | 3, payload: Buffer): Promise<HandshakeSubmissionResponse> =>
      relay.request("POST", `/v1/invitations/${event.invitationId}/handshake`, {
        senderInboxId: identity.inboxId,
        messageNumber,
        payload: payload.toString("base64url")
      });

    if (event.messageNumber === 1) {
      const contact = this.store.getPendingInvite(event.invitationId);
      if (!contact) throw new Error(`No pending invitation ${event.invitationId}`);
      const { message, state } = responderReadMessage1WriteMessage2(frame, keys);
      await submit(2, message);
      contact.connectionId = event.connectionId;
      contact.handshakeState = JSON.stringify(state);
      this.store.saveContact(contact);
      return;
    }

    const contact = this.store.getContactByConnection(event.connectionId);
    if (!contact?.handshakeState) throw new Error(`No handshake in progress for ${event.connectionId}`);
    const psk = Buffer.from(contact.psk, "base64url");

    if (event.messageNumber === 2 && contact.role === "accepter") {
      const st = JSON.parse(contact.handshakeState) as InitiatorState;
      const { message, keys: t } = initiatorReadMessage2WriteMessage3(st, frame, keys, psk);
      await submit(3, message);
      // Stays pending until the inviter's "ready" frame proves it derived the same keys.
      Object.assign(contact, {
        handshakeState: null,
        peerStaticKey: t.peerStatic.toString("base64url"),
        sendKey: t.sendKey.toString("base64url"),
        receiveKey: t.receiveKey.toString("base64url")
      });
      this.store.saveContact(contact);
      return;
    }

    if (event.messageNumber === 3 && contact.role === "inviter") {
      const st = JSON.parse(contact.handshakeState) as ResponderState;
      const t = responderReadMessage3(st, frame, psk);
      const readyId = `ready_${crypto.randomUUID()}`;
      const ready = encrypt(t.sendKey, 0n, EMPTY, Buffer.from(JSON.stringify({ type: "ready", connectionId: contact.connectionId })));
      this.store.tx(() => {
        Object.assign(contact, {
          status: "active",
          handshakeState: null,
          peerStaticKey: t.peerStatic.toString("base64url"),
          sendKey: t.sendKey.toString("base64url"),
          receiveKey: t.receiveKey.toString("base64url"),
          sendNonce: 1,
          receiveNonce: 0
        });
        this.store.saveContact(contact);
        this.store.queueOutbox({ messageId: readyId, connectionId: contact.connectionId!, nonce: 0, ciphertext: ready.toString("base64url") });
      });
      await this.drainOutbox(relay, contact.connectionId!);
      return;
    }
    throw new Error(`Unexpected handshake message ${event.messageNumber} for ${contact.role}`);
  }

  private handleMessage(event: MessageEvent): void {
    const contact = this.store.getContactByConnection(event.connectionId);
    if (!contact?.receiveKey || contact.status === "disconnected") throw new Error(`No open session for ${event.connectionId}`);
    if (event.nonce < contact.receiveNonce) throw new Error(`Replayed nonce ${event.nonce}`);
    if (event.nonce > contact.receiveNonce) throw new NonceAheadError(`Waiting for nonce ${contact.receiveNonce}`);

    const plaintext = decrypt(Buffer.from(contact.receiveKey, "base64url"), BigInt(event.nonce), EMPTY, Buffer.from(event.ciphertext, "base64url"));
    // Authenticated: the nonce is consumed whether or not the payload is usable.
    contact.receiveNonce = event.nonce + 1;

    let parsed: unknown;
    try {
      parsed = JSON.parse(plaintext.toString("utf8"));
    } catch {
      parsed = null;
    }
    if ((parsed as { type?: unknown } | null)?.type === "ready") {
      contact.status = "active";
      this.store.saveContact(contact);
      return;
    }

    let payload: ApplicationPayload;
    try {
      payload = validateApplicationPayload(parsed);
      if (payload.messageId !== event.messageId) throw new Error("Envelope and payload messageId differ");
    } catch (err) {
      this.store.saveContact(contact);
      throw err;
    }
    this.store.tx(() => {
      this.store.saveContact(contact);
      if (!this.store.hasMessage(payload.messageId)) {
        this.store.saveMessage({
          messageId: payload.messageId,
          connectionId: event.connectionId,
          conversationId: payload.conversationId,
          inReplyTo: payload.inReplyTo,
          direction: "inbound",
          body: payload.body,
          status: "pending_muse",
          sentAt: payload.sentAt,
          createdAt: new Date().toISOString()
        });
      }
    });
  }

  async send(alias: string, conversationId: string, body: string, inReplyTo: string | null): Promise<object> {
    const { relay } = this.session();
    const contact = this.store.getContact(alias);
    if (!contact) throw new Error(`Contact '${alias}' not found`);
    if (contact.status !== "active" || !contact.sendKey || !contact.connectionId) {
      throw new Error(`Cannot send to '${alias}': connection is ${contact.status}`);
    }
    if (!body.trim()) throw new Error("Message body cannot be empty");
    if (Buffer.byteLength(body, "utf8") > MAX_PLAINTEXT_BYTES) throw new Error(`Message body exceeds ${MAX_PLAINTEXT_BYTES} bytes`);

    const payload: ApplicationPayload = {
      version: 1,
      messageId: crypto.randomUUID(),
      conversationId,
      inReplyTo,
      sentAt: new Date().toISOString(),
      body
    };
    const nonce = contact.sendNonce;
    const ciphertext = encrypt(Buffer.from(contact.sendKey, "base64url"), BigInt(nonce), EMPTY, Buffer.from(JSON.stringify(payload)));
    const connectionId = contact.connectionId;
    this.store.tx(() => {
      contact.sendNonce = nonce + 1;
      this.store.saveContact(contact);
      this.store.saveMessage({ ...payload, connectionId, direction: "outbound", status: "pending_send", createdAt: payload.sentAt });
      this.store.queueOutbox({ messageId: payload.messageId, connectionId, nonce, ciphertext: ciphertext.toString("base64url") });
    });
    await this.drainOutbox(relay, connectionId);
    const queued = this.store.pendingOutbox(connectionId).some((o) => o.messageId === payload.messageId);
    return { messageId: payload.messageId, status: queued ? "pending_outbox" : "sent", connectionId };
  }

  private closeLocally(contact: Contact): void {
    this.store.tx(() => {
      Object.assign(contact, { status: "disconnected", sendKey: null, receiveKey: null, handshakeState: null });
      this.store.saveContact(contact);
      if (contact.connectionId) this.store.cancelOutbox(contact.connectionId);
    });
  }

  async disconnect(alias: string): Promise<object> {
    const { relay } = this.session();
    const contact = this.store.getContact(alias);
    if (!contact) throw new Error(`Contact '${alias}' not found`);
    if (contact.connectionId) {
      try {
        await relay.request("DELETE", `/v1/connections/${contact.connectionId}`);
      } catch (err) {
        if (!isPermanentRejection(err)) throw err;
      }
    }
    this.closeLocally(contact);
    return { alias, status: "disconnected" };
  }

  contacts(): object[] {
    return this.store.listContacts().map((c) => ({
      alias: c.alias,
      status: c.status,
      role: c.role,
      connectionId: c.connectionId,
      peerStaticKey: c.peerStaticKey,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt
    }));
  }

  hookPrepare(hooksDir = path.join(os.homedir(), "hooks")): object {
    const { identity } = this.session();
    const scriptDir = path.join(hooksDir, "scripts");
    const stateDir = path.join(hooksDir, "state", "musetogether");
    fs.mkdirSync(scriptDir, { recursive: true });
    fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    const writePrivate = (name: string, content: string): string => {
      const file = path.join(stateDir, name);
      fs.writeFileSync(file, content, { mode: 0o600 });
      fs.chmodSync(file, 0o600);
      return file;
    };
    // curl reads the token from a private file so it never appears in argv or logs.
    writePrivate("authorization.header", `Authorization: Bearer ${identity.token}\n`);
    const cliPath = fileURLToPath(import.meta.url);
    const store = path.resolve(this.store.dir);
    writePrivate("config.json", JSON.stringify({ relayUrl: identity.relayUrl, storeDir: store, nodePath: process.execPath, cliPath }, null, 2) + "\n");
    const q = (s: string): string => `'${s.replaceAll("'", "'\\''")}'`;
    const command = `MUSETOGETHER_DIR=${q(store)} ${q(process.execPath)} --no-warnings ${q(cliPath)}`;
    const workerPromptPath = writePrivate("worker.md", fs.readFileSync(path.join(clientDir, "receive-worker.md"), "utf8").replaceAll("__CLI__", command));
    const scriptPath = path.join(scriptDir, "musetogether-receive.sh");
    fs.copyFileSync(path.join(clientDir, "receive-hook.sh"), scriptPath);
    fs.chmodSync(scriptPath, 0o700);
    return { scriptPath, workerPromptPath, pollIntervalSecs: 60, scriptTimeoutSecs: 20 };
  }
}

/** Read-only check for the receive hook: never creates or migrates the store. */
export function hookCheck(): object {
  const store = new Store(storeDir(), true);
  try {
    const count = (sql: string): number => Number((store.db.prepare(sql).get() as { n: number }).n);
    return {
      pendingMessagesCount: count("SELECT COUNT(*) AS n FROM messages WHERE status = 'pending_muse'"),
      pendingOutboxCount: count("SELECT COUNT(*) AS n FROM outbox WHERE status = 'pending'")
    };
  } finally {
    store.close();
  }
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data.trim();
}

const USAGE = [
  "setup [--relay <url>]",
  "status",
  "hook prepare",
  "hook check",
  "invite create [--alias <name>]",
  "invite accept --alias <name> [--url <link>]   (or pipe the link on stdin)",
  "poll",
  "send --contact <name> --conversation <id> [--body <text>] [--reply-to <id>]   (or pipe the body on stdin)",
  "messages pending",
  "messages handled <id>",
  "contacts list",
  "disconnect --contact <name>"
];

export async function main(argv: string[]): Promise<void> {
  const [command, sub] = argv;
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const required = (name: string): string => {
    const v = flag(name);
    if (!v) throw new Error(`Missing required ${name} argument`);
    return v;
  };
  const print = (value: unknown): void => void process.stdout.write(JSON.stringify(value, null, 2) + "\n");

  if (command === "hook" && sub === "check") {
    try {
      print(hookCheck());
    } catch {
      process.stderr.write("Error: unable to read MuseTogether state. Run setup first.\n");
      process.exitCode = 1;
    }
    return;
  }
  if (!command || command === "--help" || command === "help") {
    print({ name: "musetogether", version: "0.1.0", commands: USAGE });
    return;
  }

  const app = new MuseTogether();
  try {
    if (command === "setup") print(await app.setup(flag("--relay")));
    else if (command === "status") print(app.status());
    else if (command === "hook" && sub === "prepare") print(app.hookPrepare());
    else if (command === "invite" && sub === "create") print(await app.inviteCreate(flag("--alias")));
    else if (command === "invite" && sub === "accept") {
      const url = flag("--url") ?? (await readStdin());
      if (!url) throw new Error("Provide the invitation link with --url or on stdin");
      print(await app.inviteAccept(required("--alias"), url));
    } else if (command === "poll") print(await app.poll());
    else if (command === "send") {
      const body = flag("--body") ?? (await readStdin());
      print(await app.send(required("--contact"), required("--conversation"), body, flag("--reply-to") ?? null));
    } else if (command === "messages" && sub === "pending") print(app.store.pendingMessages());
    else if (command === "messages" && sub === "handled") {
      if (!argv[2]) throw new Error("Usage: musetogether messages handled <id>");
      print({ messageId: argv[2], handled: app.store.markHandled(argv[2]) });
    } else if (command === "contacts" && sub === "list") print(app.contacts());
    else if (command === "disconnect") print(await app.disconnect(required("--contact")));
    else throw new Error(`Unknown command. Usage:\n  musetogether ${USAGE.join("\n  musetogether ")}`);
  } catch (err) {
    process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  } finally {
    app.store.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main(process.argv.slice(2));
}
