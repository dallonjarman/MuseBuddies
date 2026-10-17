// Client logic: pairing, encryption, sending/receiving, receipts, groups, backups.
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
  FEATURES,
  MAX_PLAINTEXT_BYTES,
  inviteUrl,
  parseInviteUrl,
  validateApplicationPayload,
  validatePlanEvent,
  validateReceiptFrame,
  type ApplicationPayload,
  type CreateInvitationResponse,
  type FeaturesFrame,
  type AvailabilityRequest,
  type AvailabilityResponse,
  type GrantsFrame,
  type SharingGrants,
  type TimeSlot,
  validateGrants,
  validateAvailabilityRequest,
  type GroupInfo,
  type HandshakeEvent,
  type HandshakeSubmissionRequest,
  type HandshakeSubmissionResponse,
  type InvitationInfoResponse,
  type MessageEvent,
  type PlanEvent,
  type Priority,
  type ReadyFrame,
  type ReceiptFrame,
  type ReceiptState,
  type RegisterInboxResponse,
  type RelayEvent
} from "../shared/protocol.ts";
import { checkTimezone, commonFree, computeFree, describeSlots, parseHours, systemTimezone } from "./availability.ts";
import { checkPassphrase, decryptBackup, encryptBackup, writePrivateFile } from "./backup.ts";
import { toIcs } from "./ics.ts";
import { Store, storeDir, type AvailabilityGrant, type Contact, type Identity, type Message } from "./store.ts";

const clientDir = path.dirname(fileURLToPath(import.meta.url));
// The installer sets MUSEBUDDIES_RELAY_URL to the relay it was downloaded from.
const DEFAULT_RELAY = process.env.MUSEBUDDIES_RELAY_URL;
const EMPTY = Buffer.alloc(0);
/** After a restore, outgoing nonces jump this far ahead so no (key, nonce) pair is ever reused. */
const RESTORE_NONCE_SKIP = 1_000_000;
const MAX_WAIT_SECONDS = 30;

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export class RelayClient {
  readonly baseUrl: string;
  readonly token: string | null;
  constructor(baseUrl: string, token: string | null = null) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token;
  }

  async request<T>(method: string, endpoint: string, body?: unknown, timeoutMs = 15_000): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const res = await fetch(this.baseUrl + endpoint, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
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

const supports = (c: Contact, feature: string): boolean => c.peerFeatures.includes(feature);

export interface SendOptions {
  contacts?: string[];
  group?: string;
  conversationId: string;
  body: string;
  inReplyTo?: string | null;
  priority?: Priority;
  updateKey?: string;
  event?: Partial<PlanEvent>;
  availabilityRequest?: AvailabilityRequest;
  availabilityResponse?: AvailabilityResponse;
}

export class MuseBuddies {
  readonly store: Store;
  constructor(store = new Store()) {
    this.store = store;
  }

  private session(): { identity: Identity; relay: RelayClient; keys: KeyPair } {
    const identity = this.store.getIdentity();
    if (!identity) throw new Error("MuseBuddies is not set up. Run 'musebuddies setup' first.");
    return {
      identity,
      relay: new RelayClient(identity.relayUrl, identity.token),
      keys: { pub: Buffer.from(identity.staticPublicKey, "base64url"), priv: Buffer.from(identity.staticPrivateKey, "base64url") }
    };
  }

  // ---------------------------------------------------------------- setup

  async setup(relayUrl = DEFAULT_RELAY): Promise<object> {
    const existing = this.store.getIdentity();
    if (existing) return { status: "already_configured", inboxId: existing.inboxId, relayUrl: existing.relayUrl };
    if (!relayUrl) throw new Error("No relay configured. Run 'musebuddies setup --relay <url>' or set MUSEBUDDIES_RELAY_URL.");
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
      needsRepair: contacts.filter((c) => c.status === "needs_repair").map((c) => c.alias),
      pendingMessagesCount: this.store.pendingMessages().length
    };
  }

  // ---------------------------------------------------------------- invitations

  private assertAliasFree(alias: string): void {
    const existing = this.store.getContact(alias);
    if (existing && existing.status !== "disconnected") {
      throw new Error(`Contact '${alias}' already exists (${existing.status}). Disconnect or cancel it first, or choose another name.`);
    }
  }

  private newContact(alias: string, role: Contact["role"], invitationId: string, psk: Buffer): Contact {
    const now = new Date().toISOString();
    return {
      alias, role, invitationId, status: "pending_handshake", connectionId: null, psk: psk.toString("base64url"),
      handshakeState: null, peerStaticKey: null, peerFeatures: [], peerGrants: null, sendKey: null, sendNonce: 0, receiveKey: null, receiveNonce: 0,
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

  /** Invitations this Muse created that haven't become active connections. */
  async inviteList(): Promise<object[]> {
    const { relay } = this.session();
    const pending = this.store.listContacts().filter((c) => c.role === "inviter" && c.status === "pending_handshake");
    return Promise.all(
      pending.map(async (c) => {
        let relayStatus: string;
        let expiresAt: string | null = null;
        try {
          const info = await relay.request<InvitationInfoResponse>("GET", `/v1/invitations/${c.invitationId}`);
          relayStatus = info.status;
          expiresAt = info.expiresAt;
        } catch (err) {
          relayStatus = err instanceof ApiError && err.status === 404 ? "not_found" : "unknown";
        }
        return {
          alias: c.alias,
          invitationId: c.invitationId,
          state: c.connectionId ? "pairing" : relayStatus === "pending" ? "waiting_for_friend" : relayStatus,
          expiresAt,
          createdAt: c.createdAt
        };
      })
    );
  }

  async inviteCancel(alias: string): Promise<object> {
    const { relay } = this.session();
    const c = this.store.getContact(alias);
    if (!c || c.role !== "inviter" || c.status !== "pending_handshake") throw new Error(`No pending invitation named '${alias}'`);
    if (c.connectionId) throw new Error(`'${alias}' already accepted and is pairing; use 'disconnect --contact ${alias}' instead`);
    try {
      await relay.request("DELETE", `/v1/invitations/${c.invitationId}`);
    } catch (err) {
      // 404/410: already gone. 409: accepted in the meantime; the handshake event will be rejected locally.
      if (!(err instanceof ApiError && [404, 409, 410].includes(err.status)) && !isPermanentRejection(err)) throw err;
    }
    this.store.deleteContact(alias);
    return { alias, invitationId: c.invitationId, status: "cancelled" };
  }

  // ---------------------------------------------------------------- outbox

  /** Encrypts a frame with the contact's next send nonce and queues it. Call inside a transaction. */
  private queueFrame(contact: Contact, messageId: string, plaintext: object): void {
    if (!contact.sendKey || !contact.connectionId) throw new Error(`No send key for '${contact.alias}'`);
    const nonce = contact.sendNonce;
    const ciphertext = encrypt(Buffer.from(contact.sendKey, "base64url"), BigInt(nonce), EMPTY, Buffer.from(JSON.stringify(plaintext)));
    contact.sendNonce = nonce + 1;
    this.store.saveContact(contact);
    this.store.queueOutbox({ messageId, connectionId: contact.connectionId, nonce, ciphertext: ciphertext.toString("base64url") });
  }

  /** Delivers queued frames in FIFO order; stops a connection at its first failure. */
  private async drainOutbox(relay: RelayClient, connectionId?: string): Promise<void> {
    const blocked = new Set<string>();
    for (const item of this.store.pendingOutbox(connectionId)) {
      if (blocked.has(item.connectionId)) continue;
      try {
        await relay.request("POST", `/v1/connections/${item.connectionId}/messages`, {
          messageId: item.messageId,
          nonce: item.nonce,
          ciphertext: item.ciphertext
        });
        this.store.markOutboxSent(item.messageId);
      } catch (err) {
        blocked.add(item.connectionId);
        if (isPermanentRejection(err)) this.store.cancelOutbox(item.connectionId);
        process.stderr.write(`Delivery of ${item.messageId} deferred: ${String(err)}\n`);
      }
    }
  }

  private queueReceipt(contact: Contact, state: ReceiptState, messageIds: string[]): void {
    if (messageIds.length === 0 || contact.status === "disconnected" || contact.status === "needs_repair" || !supports(contact, "receipts")) return;
    const frame: ReceiptFrame = { type: "receipt", version: 1, state, messageIds, at: new Date().toISOString() };
    this.queueFrame(contact, `receipt_${crypto.randomUUID()}`, frame);
  }

  // ---------------------------------------------------------------- receiving

  async poll(opts: { wait?: number } = {}): Promise<object> {
    const { relay, keys } = this.session();
    await this.drainOutbox(relay);

    const wait = Math.min(Math.max(Math.floor(opts.wait ?? 0), 0), MAX_WAIT_SECONDS);
    const { events } = await relay.request<{ events: RelayEvent[] }>(
      "GET",
      wait > 0 ? `/v1/events?wait=${wait}` : "/v1/events",
      undefined,
      (wait + 15) * 1000
    );
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
        if (isTransient(err)) continue;
        process.stderr.write(`Rejected event ${event.eventId}: ${String(err)}\n`);
        this.store.markProcessed(event.eventId);
        ack.push(event.eventId);
      }
    }
    if (ack.length) await relay.request("POST", "/v1/events/ack", { eventIds: ack });
    await this.drainOutbox(relay); // receipts queued while processing
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
      this.store.tx(() => {
        Object.assign(contact, {
          status: "active",
          handshakeState: null,
          peerStaticKey: t.peerStatic.toString("base64url"),
          sendKey: t.sendKey.toString("base64url"),
          receiveKey: t.receiveKey.toString("base64url"),
          sendNonce: 0,
          receiveNonce: 0
        });
        const ready: ReadyFrame = { type: "ready", connectionId: contact.connectionId!, features: [...FEATURES] };
        this.queueFrame(contact, `ready_${crypto.randomUUID()}`, ready);
      });
      return;
    }
    throw new Error(`Unexpected handshake message ${event.messageNumber} for ${contact.role}`);
  }

  private handleMessage(event: MessageEvent): void {
    const contact = this.store.getContactByConnection(event.connectionId);
    if (!contact?.receiveKey || contact.status === "disconnected") throw new Error(`No open session for ${event.connectionId}`);
    if (event.nonce < contact.receiveNonce) throw new Error(`Replayed nonce ${event.nonce}`);
    if (event.nonce > contact.receiveNonce) {
      // The relay delivers each sender's frames in order, so a forward jump means the sender
      // skipped nonces deliberately (e.g. after restoring a backup). AEAD still authenticates it.
      process.stderr.write(`Nonce jump on ${contact.alias}: expected ${contact.receiveNonce}, got ${event.nonce}\n`);
    }

    const plaintext = decrypt(Buffer.from(contact.receiveKey, "base64url"), BigInt(event.nonce), EMPTY, Buffer.from(event.ciphertext, "base64url"));
    // Authenticated: the nonce is consumed whether or not the payload is usable.
    contact.receiveNonce = event.nonce + 1;

    let parsed: Record<string, unknown> | null = null;
    try {
      const value = JSON.parse(plaintext.toString("utf8")) as unknown;
      if (typeof value === "object" && value !== null) parsed = value as Record<string, unknown>;
    } catch {
      // handled below
    }

    const features = (v: unknown): string[] | null =>
      Array.isArray(v) ? v.filter((f): f is string => typeof f === "string" && f.length <= 50).slice(0, 50) : null;

    if (parsed?.type === "ready") {
      const wasPending = contact.status === "pending_handshake";
      if (wasPending) contact.status = "active";
      const advertised = features(parsed.features);
      this.store.tx(() => {
        if (advertised) contact.peerFeatures = advertised;
        this.store.saveContact(contact);
        // Only a peer that advertised features understands extension frames.
        if (wasPending && advertised) {
          const frame: FeaturesFrame = { type: "features", features: [...FEATURES] };
          this.queueFrame(contact, `features_${crypto.randomUUID()}`, frame);
        }
      });
      return;
    }

    if (parsed?.type === "grants") {
      contact.peerGrants = validateGrants(parsed.grants);
      this.store.saveContact(contact);
      return;
    }

    if (parsed?.type === "features") {
      contact.peerFeatures = features(parsed.features) ?? contact.peerFeatures;
      this.store.saveContact(contact);
      return;
    }

    if (parsed?.type === "receipt") {
      this.store.saveContact(contact);
      const receipt = validateReceiptFrame(parsed);
      this.store.applyReceipt(event.connectionId, receipt.state, receipt.messageIds, receipt.at);
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
      if (payload.features) contact.peerFeatures = payload.features;
      this.store.saveContact(contact);
      if (this.store.hasMessage(payload.messageId)) return;
      if (payload.updateKey) this.store.supersede(event.connectionId, payload.updateKey, payload.sentAt);
      // Availability answers are bookkeeping until the last one arrives; only then does the owner need to hear.
      let status: "pending_muse" | "handled" = "pending_muse";
      const answer = payload.availabilityResponse;
      const organized = answer ? this.store.getOrganizedRequest(answer.requestId) : null;
      if (answer && organized?.participants.includes(contact.alias)) {
        this.store.saveReceivedAvailability(answer.requestId, {
          contact: contact.alias,
          status: answer.status,
          free: answer.free,
          automatic: answer.automatic,
          coveredFrom: answer.coveredFrom ?? null,
          coveredTo: answer.coveredTo ?? null,
          receivedAt: new Date().toISOString()
        });
        const answered = new Set(this.store.receivedAvailability(answer.requestId).map((r) => r.contact));
        if (!organized.participants.every((p) => answered.has(p))) status = "handled";
      }
      this.store.saveMessage({
        messageId: payload.messageId,
        connectionId: event.connectionId,
        conversationId: payload.conversationId,
        inReplyTo: payload.inReplyTo,
        direction: "inbound",
        body: payload.body,
        status,
        priority: payload.priority ?? "normal",
        updateKey: payload.updateKey ?? null,
        group: payload.group ?? null,
        event: payload.event ?? null,
        availabilityRequest: payload.availabilityRequest ?? null,
        availabilityResponse: payload.availabilityResponse ?? null,
        sentAt: payload.sentAt,
        createdAt: new Date().toISOString()
      });
      this.queueReceipt(contact, "delivered", [payload.messageId]);
    });
  }

  // ---------------------------------------------------------------- sending

  async send(opts: SendOptions): Promise<object> {
    const { relay } = this.session();
    if (!opts.body.trim()) throw new Error("Message body cannot be empty");
    if (Buffer.byteLength(opts.body, "utf8") > MAX_PLAINTEXT_BYTES) throw new Error(`Message body exceeds ${MAX_PLAINTEXT_BYTES} bytes`);

    let aliases = opts.contacts ?? [];
    let group: GroupInfo | undefined;
    if (opts.group) {
      const g = this.store.getGroup(opts.group);
      if (!g) throw new Error(`Group '${opts.group}' not found`);
      aliases = [...new Set([...aliases, ...g.members])];
      group = { id: g.groupId, name: g.name, size: g.members.length + 1 };
    } else if (aliases.length > 1) {
      group = { id: `adhoc_${crypto.createHash("sha256").update(opts.conversationId).digest("base64url").slice(0, 12)}`, name: opts.conversationId, size: aliases.length + 1 };
    }
    if (aliases.length === 0) throw new Error("Specify --contact (repeatable) or --group");

    const event = opts.event ? validatePlanEvent({ uid: crypto.randomUUID(), status: "confirmed", ...opts.event }) : undefined;

    const results = [];
    for (const alias of aliases) {
      try {
        results.push({ contact: alias, ...(await this.sendOne(relay, alias, opts, group, event)) });
      } catch (err) {
        results.push({ contact: alias, status: "failed", error: err instanceof Error ? err.message : String(err) });
      }
    }
    const extra = { ...(event ? { eventUid: event.uid } : {}), ...(opts.updateKey ? { updateKey: opts.updateKey } : {}) };
    if (aliases.length === 1 && !opts.group) {
      const [only] = results;
      if (only.status === "failed") throw new Error((only as { error: string }).error);
      return { ...only, ...extra };
    }
    return { conversationId: opts.conversationId, group, ...extra, results };
  }

  private async sendOne(relay: RelayClient, alias: string, opts: SendOptions, group?: GroupInfo, event?: PlanEvent): Promise<object> {
    const contact = this.store.getContact(alias);
    if (!contact) throw new Error(`Contact '${alias}' not found`);
    if (contact.status !== "active" || !contact.sendKey || !contact.connectionId) {
      throw new Error(`Cannot send to '${alias}': connection is ${contact.status}`);
    }
    const priority = opts.priority ?? "normal";
    const payload: ApplicationPayload = {
      version: 1,
      messageId: crypto.randomUUID(),
      conversationId: opts.conversationId,
      inReplyTo: opts.inReplyTo ?? null,
      sentAt: new Date().toISOString(),
      body: opts.body,
      features: [...FEATURES],
      ...(priority === "urgent" ? { priority } : {}),
      ...(opts.updateKey ? { updateKey: opts.updateKey } : {}),
      ...(group ? { group } : {}),
      ...(event ? { event } : {}),
      ...(opts.availabilityRequest ? { availabilityRequest: opts.availabilityRequest } : {}),
      ...(opts.availabilityResponse ? { availabilityResponse: opts.availabilityResponse } : {})
    };
    const connectionId = contact.connectionId;
    this.store.tx(() => {
      this.store.saveMessage({
        messageId: payload.messageId,
        connectionId,
        conversationId: payload.conversationId,
        inReplyTo: payload.inReplyTo,
        direction: "outbound",
        body: payload.body,
        status: "pending_send",
        priority,
        updateKey: payload.updateKey ?? null,
        group: group ?? null,
        event: event ?? null,
        availabilityRequest: opts.availabilityRequest ?? null,
        availabilityResponse: opts.availabilityResponse ?? null,
        sentAt: payload.sentAt,
        createdAt: payload.sentAt
      });
      this.queueFrame(contact, payload.messageId, payload);
    });
    await this.drainOutbox(relay, connectionId);
    const queued = this.store.pendingOutbox(connectionId).some((o) => o.messageId === payload.messageId);
    return {
      messageId: payload.messageId,
      status: queued ? "pending_outbox" : "sent",
      priority,
      connectionId,
      receiptsSupported: supports(contact, "receipts")
    };
  }

  // ---------------------------------------------------------------- messages

  async messageHandled(messageId: string): Promise<object> {
    const message = this.store.getMessage(messageId);
    if (!message || message.direction !== "inbound") return { messageId, handled: false };
    const contact = this.store.getContactByConnection(message.connectionId);
    const ids: string[] = [];
    this.store.tx(() => {
      if (this.store.markHandled(messageId)) ids.push(messageId);
      // The owner has now seen the latest state, which covers the updates it replaced.
      if (message.updateKey) {
        for (const m of this.store.listMessages({ conversationId: message.conversationId, direction: "inbound", limit: 500 })) {
          if (m.connectionId === message.connectionId && m.updateKey === message.updateKey && m.status === "superseded" && this.store.markHandled(m.messageId)) {
            ids.push(m.messageId);
          }
        }
      }
      if (contact) this.queueReceipt(contact, "handled", ids);
    });
    if (contact?.connectionId && ids.length) {
      try {
        await this.drainOutbox(this.session().relay, contact.connectionId);
      } catch {
        // the next poll retries
      }
    }
    return { messageId, handled: ids.includes(messageId), alsoHandled: ids.filter((id) => id !== messageId) };
  }

  private present(m: Message): object {
    const contact = m.contact ? this.store.getContact(m.contact) : null;
    const delivery =
      m.direction === "outbound"
        ? {
            delivery: m.handledAt ? "handled" : m.deliveredAt ? "delivered" : m.status === "sent" ? "sent_to_relay" : "queued",
            deliveredAt: m.deliveredAt,
            handledAt: m.handledAt,
            receiptsSupported: contact ? supports(contact, "receipts") : false
          }
        : { handledAt: m.handledAt };
    return {
      messageId: m.messageId,
      direction: m.direction,
      contact: m.contact,
      connectionId: m.connectionId,
      conversationId: m.conversationId,
      inReplyTo: m.inReplyTo,
      status: m.status,
      priority: m.priority,
      ...(m.updateKey ? { updateKey: m.updateKey } : {}),
      ...(m.group ? { group: m.group } : {}),
      ...(m.event ? { event: m.event } : {}),
      ...(m.availabilityRequest && m.direction === "inbound" ? { availabilityRequest: { ...m.availabilityRequest, autoAnswer: this.autoAnswer(m) } } : {}),
      ...(m.availabilityRequest && m.direction === "outbound" ? { availabilityRequest: m.availabilityRequest } : {}),
      ...(m.availabilityResponse
        ? {
            availabilityResponse: m.availabilityResponse,
            ...(m.direction === "inbound" && this.store.getOrganizedRequest(m.availabilityResponse.requestId)
              ? { availabilityResults: this.availabilityResults(m.availabilityResponse.requestId) }
              : {})
          }
        : {}),
      sentAt: m.sentAt,
      body: m.body,
      ...delivery
    };
  }

  pending(): object[] {
    return this.store.pendingMessages().map((m) => this.present(m));
  }

  outbound(filter: { contact?: string; conversationId?: string; limit?: number }): object[] {
    return this.store.listMessages({ ...filter, direction: "outbound" }).map((m) => this.present(m));
  }

  thread(conversationId: string, limit = 100): object {
    const messages = this.store.listMessages({ conversationId, limit });
    return {
      conversationId,
      participants: [...new Set(messages.map((m) => m.contact).filter(Boolean))],
      messages: messages.map((m) => this.present(m))
    };
  }

  ics(messageId: string): string {
    const m = this.store.getMessage(messageId);
    if (!m?.event) throw new Error(`Message ${messageId} has no attached event`);
    return toIcs(m.event, m.sentAt);
  }

  // ---------------------------------------------------------------- availability sharing

  /** The grant for a contact, only if it is still valid for that exact connection. */
  private validGrant(contact: Contact): AvailabilityGrant | null {
    const g = this.store.getGrant(contact.alias);
    if (!g || g.connectionId !== contact.connectionId || contact.status !== "active") return null;
    if (g.expiresAt && Date.parse(g.expiresAt) <= Date.now()) return null;
    return g;
  }

  private sendGrants(contact: Contact, grants: SharingGrants): void {
    if (contact.status !== "active" || !supports(contact, "availability")) return;
    const frame: GrantsFrame = { type: "grants", grants };
    this.store.tx(() => this.queueFrame(contact, `grants_${crypto.randomUUID()}`, frame));
  }

  async shareGrant(alias: string, opts: { daysAhead?: number; hours?: string | null; timezone?: string; maxPerDay?: number; expiresAt?: string | null }): Promise<object> {
    const contact = this.store.getContact(alias);
    if (!contact || contact.status !== "active" || !contact.connectionId) throw new Error(`'${alias}' is not an active contact`);
    const daysAhead = opts.daysAhead ?? 14;
    if (!Number.isInteger(daysAhead) || daysAhead < 1 || daysAhead > 62) throw new Error("--days-ahead must be 1..62");
    const maxPerDay = opts.maxPerDay ?? 10;
    if (!Number.isInteger(maxPerDay) || maxPerDay < 1 || maxPerDay > 100) throw new Error("--max-per-day must be 1..100");
    if (opts.hours) parseHours(opts.hours);
    if (opts.expiresAt && Number.isNaN(Date.parse(opts.expiresAt))) throw new Error("--expires must be an ISO date");
    const grant: AvailabilityGrant = {
      alias,
      connectionId: contact.connectionId,
      daysAhead,
      hours: opts.hours ?? null,
      timezone: checkTimezone(opts.timezone ?? systemTimezone()),
      maxPerDay,
      expiresAt: opts.expiresAt ? new Date(opts.expiresAt).toISOString() : null,
      createdAt: new Date().toISOString()
    };
    this.store.saveGrant(grant);
    this.sendGrants(contact, { availability: { daysAhead: grant.daysAhead, hours: grant.hours, timezone: grant.timezone } });
    await this.drainOutbox(this.session().relay, contact.connectionId).catch(() => undefined);
    return { granted: "availability", ...grant, peerNotified: supports(contact, "availability") };
  }

  async shareRevoke(alias: string): Promise<object> {
    const removed = this.store.deleteGrant(alias);
    const contact = this.store.getContact(alias);
    if (removed && contact?.connectionId) {
      this.sendGrants(contact, { availability: null });
      await this.drainOutbox(this.session().relay, contact.connectionId).catch(() => undefined);
    }
    return { alias, revoked: removed };
  }

  shareList(): object {
    return {
      iShare: this.store.listGrants().map((g) => ({ ...g, active: this.store.getContact(g.alias) ? this.validGrant(this.store.getContact(g.alias)!) !== null : false })),
      sharedWithMe: this.store.listContacts().filter((c) => c.peerGrants?.availability).map((c) => ({ alias: c.alias, ...c.peerGrants }))
    };
  }

  /** Whether the Muse may answer this request without asking its owner, and for which window. */
  private autoAnswer(m: Message): object {
    const req = m.availabilityRequest!;
    const contact = m.contact ? this.store.getContact(m.contact) : null;
    const no = (reason: string): object => ({ allowed: false, reason });
    if (!contact) return no("unknown contact");
    if (m.status === "handled" || (contact.connectionId && this.store.hasAnswered(req.requestId, contact.connectionId))) return no("already answered");
    const grant = this.validGrant(contact);
    if (!grant) return no("no standing permission from your owner for this contact; ask your owner first");
    const since = new Date(Date.now() - 86_400_000).toISOString();
    if (this.store.automaticAnswersSince(contact.connectionId!, since) >= grant.maxPerDay) return no(`daily limit of ${grant.maxPerDay} automatic answers reached; ask your owner`);
    const window = this.coveredWindow(req, grant);
    if (!window) return no("the requested window is in the past or beyond what your owner allows");
    return { allowed: true, coveredFrom: window.from, coveredTo: window.to, hours: grant.hours, timezone: grant.timezone };
  }

  private coveredWindow(req: AvailabilityRequest, grant: AvailabilityGrant | null): { from: string; to: string } | null {
    const from = Math.max(Date.parse(req.from), Date.now());
    const to = Math.min(Date.parse(req.to), grant ? Date.now() + grant.daysAhead * 86_400_000 : Infinity);
    if (to - from < req.durationMinutes * 60_000) return null;
    return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
  }

  async availabilityRequest(opts: { contacts?: string[]; group?: string; conversationId: string; from: string; to: string; durationMinutes: number; note?: string }): Promise<object> {
    const request: AvailabilityRequest = {
      requestId: `avail_${crypto.randomBytes(9).toString("base64url")}`,
      from: opts.from,
      to: opts.to,
      durationMinutes: opts.durationMinutes,
      ...(opts.note ? { note: opts.note } : {})
    };
    const valid = validateAvailabilityRequest(request);
    const participants = opts.group ? [...new Set([...(opts.contacts ?? []), ...(this.store.getGroup(opts.group)?.members ?? [])])] : opts.contacts ?? [];
    if (participants.length === 0) throw new Error("Specify --contact (repeatable) or --group");
    this.store.saveOrganizedRequest({
      requestId: valid.requestId,
      conversationId: opts.conversationId,
      from: valid.from,
      to: valid.to,
      durationMinutes: valid.durationMinutes,
      note: valid.note ?? null,
      participants,
      createdAt: new Date().toISOString()
    });
    const when = new Intl.DateTimeFormat("en-US", { timeZone: systemTimezone(), timeZoneName: "short", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const body =
      `Availability request${valid.note ? ` (${valid.note})` : ""}: when is your owner free for ${valid.durationMinutes} minutes ` +
      `between ${when.format(new Date(valid.from))} and ${when.format(new Date(valid.to))}?`;
    const sent = (await this.send({ contacts: opts.contacts, group: opts.group, conversationId: opts.conversationId, body, availabilityRequest: valid })) as {
      results?: { contact: string; status: string }[];
      status?: string;
    };
    return { requestId: valid.requestId, participants, sent: sent.results ?? [{ contact: participants[0], status: sent.status }] };
  }

  async availabilityRespond(opts: { requestId: string; busy?: TimeSlot[]; free?: TimeSlot[]; ownerApproved?: boolean; hours?: string; timezone?: string }): Promise<object> {
    const m = this.store.findAvailabilityRequestMessage(opts.requestId);
    if (!m?.availabilityRequest || !m.contact) throw new Error(`No availability request ${opts.requestId}`);
    const contact = this.store.getContact(m.contact)!;
    if (contact.status !== "active") throw new Error(`'${contact.alias}' is ${contact.status}`);
    if (this.store.hasAnswered(opts.requestId, contact.connectionId!)) throw new Error("Already answered this request");
    if (!opts.busy && !opts.free) throw new Error("Provide --busy or --free (JSON array of {start, end})");

    const grant = this.validGrant(contact);
    let automatic = false;
    let hours = opts.hours ?? null;
    let timezone = opts.timezone ?? systemTimezone();
    if (!opts.ownerApproved) {
      const auto = this.autoAnswer(m) as { allowed: boolean; reason?: string };
      if (!auto.allowed) throw new Error(`Not allowed to answer automatically: ${auto.reason}. If your owner agreed, pass --owner-approved.`);
      automatic = true;
      hours = grant!.hours;
      timezone = grant!.timezone;
    }
    const window = this.coveredWindow(m.availabilityRequest, automatic ? grant : null);
    const free = window
      ? computeFree({ from: window.from, to: window.to, durationMinutes: m.availabilityRequest.durationMinutes, busy: opts.busy, free: opts.free, hours, timezone })
      : [];
    const response: AvailabilityResponse = {
      requestId: opts.requestId,
      status: "answered",
      free,
      ...(window ? { coveredFrom: window.from, coveredTo: window.to } : {}),
      automatic
    };
    const body = free.length
      ? `Free for ${m.availabilityRequest.durationMinutes} min: ${describeSlots(free, timezone)} (${timezone})`
      : "No free time in that window.";
    await this.send({ contacts: [contact.alias], conversationId: m.conversationId, body, inReplyTo: m.messageId, availabilityResponse: response });
    this.store.recordAnswer(opts.requestId, contact.connectionId!, automatic);
    await this.messageHandled(m.messageId);
    return { requestId: opts.requestId, contact: contact.alias, automatic, free, coveredFrom: window?.from ?? null, coveredTo: window?.to ?? null };
  }

  async availabilityDecline(requestId: string): Promise<object> {
    const m = this.store.findAvailabilityRequestMessage(requestId);
    if (!m?.availabilityRequest || !m.contact) throw new Error(`No availability request ${requestId}`);
    const contact = this.store.getContact(m.contact)!;
    const response: AvailabilityResponse = { requestId, status: "declined", free: [], automatic: false };
    await this.send({ contacts: [contact.alias], conversationId: m.conversationId, body: "My owner would rather not share availability for this.", inReplyTo: m.messageId, availabilityResponse: response });
    this.store.recordAnswer(requestId, contact.connectionId!, false);
    await this.messageHandled(m.messageId);
    return { requestId, contact: contact.alias, status: "declined" };
  }

  /** Organizer view: who answered, and the times that work for everyone who did. */
  availabilityResults(requestId: string, myBusy?: TimeSlot[], myFree?: TimeSlot[]): object {
    const req = this.store.getOrganizedRequest(requestId);
    if (!req) throw new Error(`No availability request ${requestId} organized by this Muse`);
    const received = this.store.receivedAvailability(requestId);
    const byContact = new Map(received.map((r) => [r.contact, r]));
    const answered = received.filter((r) => r.status === "answered");
    const lists = answered.map((r) => r.free);
    const includesOrganizer = Boolean(myBusy || myFree);
    if (includesOrganizer) {
      lists.push(computeFree({ from: req.from, to: req.to, durationMinutes: req.durationMinutes, busy: myBusy, free: myFree }));
    }
    const waitingFor = req.participants.filter((p) => !byContact.has(p));
    return {
      requestId,
      conversationId: req.conversationId,
      window: { from: req.from, to: req.to },
      durationMinutes: req.durationMinutes,
      note: req.note,
      complete: waitingFor.length === 0,
      participants: req.participants.map((p) => {
        const r = byContact.get(p);
        return r
          ? { contact: p, status: r.status, automatic: r.automatic, coveredFrom: r.coveredFrom, coveredTo: r.coveredTo, freeSlots: r.free.length }
          : { contact: p, status: "waiting" };
      }),
      includesOrganizer,
      commonFree: lists.length ? commonFree(lists, req.durationMinutes) : [],
      ...(waitingFor.length ? { waitingFor } : {}),
      ...(received.some((r) => r.status === "declined") ? { declined: received.filter((r) => r.status === "declined").map((r) => r.contact) } : {})
    };
  }

  availabilityList(): object[] {
    return this.store.listOrganizedRequests().map((r) => {
      const received = this.store.receivedAvailability(r.requestId);
      return { ...r, answered: received.length, complete: received.length >= r.participants.length };
    });
  }

  // ---------------------------------------------------------------- groups

  groupCreate(name: string, members: string[]): object {
    if (!name.trim()) throw new Error("Group name is required");
    const unique = [...new Set(members)];
    if (unique.length < 2) throw new Error("A group needs at least two contacts");
    for (const alias of unique) if (!this.store.getContact(alias)) throw new Error(`Contact '${alias}' not found`);
    const existing = this.store.getGroup(name);
    const group = { name, groupId: existing?.groupId ?? `grp_${crypto.randomBytes(9).toString("base64url")}`, members: unique, createdAt: existing?.createdAt ?? new Date().toISOString() };
    this.store.saveGroup(group);
    return group;
  }

  groupList(): object[] {
    return this.store.listGroups().map((g) => ({
      ...g,
      members: g.members.map((alias) => ({ alias, status: this.store.getContact(alias)?.status ?? "missing" }))
    }));
  }

  groupDelete(name: string): object {
    return { name, deleted: this.store.deleteGroup(name) };
  }

  // ---------------------------------------------------------------- contacts

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
      receiptsSupported: supports(c, "receipts"),
      peerFeatures: c.peerFeatures,
      sharesWithMe: c.peerGrants,
      iShareWithThem: this.store.getGrant(c.alias),
      createdAt: c.createdAt,
      updatedAt: c.updatedAt
    }));
  }

  // ---------------------------------------------------------------- backup

  backupExport(file: string, passphrase: string | undefined): object {
    const pass = checkPassphrase(passphrase);
    if (!this.store.getIdentity()) throw new Error("Nothing to back up: run setup first");
    const tmp = path.join(this.store.dir, `backup-${process.pid}-${Date.now()}.db`);
    try {
      this.store.db.exec(`VACUUM INTO '${tmp.replaceAll("'", "''")}'`);
      writePrivateFile(file, encryptBackup(fs.readFileSync(tmp), pass));
    } finally {
      fs.rmSync(tmp, { force: true });
    }
    return { file: path.resolve(file), contacts: this.store.listContacts().length };
  }

  /** Restores a backup into `dir`. Must run before a Store is opened on that directory. */
  static backupImport(dir: string, file: string, passphrase: string | undefined, force = false): object {
    const pass = checkPassphrase(passphrase);
    const { dbBytes, createdAt } = decryptBackup(fs.readFileSync(file, "utf8"), pass);
    const dbPath = path.join(dir, "state.db");
    if (fs.existsSync(dbPath)) {
      const current = new Store(dir);
      const configured = current.getIdentity() !== null;
      current.close();
      if (configured && !force) throw new Error("This Muse is already set up. Re-run with --force to replace it (the current state is kept as a .replaced file).");
      const suffix = `.replaced-${Date.now()}`;
      for (const ext of ["", "-wal", "-shm"]) if (fs.existsSync(dbPath + ext)) fs.renameSync(dbPath + ext, dbPath + suffix + ext);
    }
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    writePrivateFile(dbPath, dbBytes);

    // The backup's send nonces may already have been used since it was taken. Reusing a nonce
    // under the same key would break encryption, so jump ahead where the peer tolerates it and
    // otherwise stop sending on that connection until it is re-paired. Receiving keeps working.
    const store = new Store(dir);
    const contacts = store.tx(() =>
      store.listContacts().map((c) => {
        if (c.status === "active") {
          if (supports(c, "nonce-skip")) c.sendNonce += RESTORE_NONCE_SKIP;
          else c.status = "needs_repair";
          store.saveContact(c);
        }
        return { alias: c.alias, status: c.status };
      })
    );
    const identity = store.getIdentity();
    store.close();
    return { restored: true, backupCreatedAt: createdAt, inboxId: identity?.inboxId, contacts };
  }

  // ---------------------------------------------------------------- hooks

  hookPrepare(hooksDir = path.join(os.homedir(), "hooks")): object {
    const { identity } = this.session();
    const scriptDir = path.join(hooksDir, "scripts");
    const stateDir = path.join(hooksDir, "state", "musebuddies");
    fs.mkdirSync(scriptDir, { recursive: true });
    fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    // curl reads the token from a private file so it never appears in argv or logs.
    writePrivateFile(path.join(stateDir, "authorization.header"), `Authorization: Bearer ${identity.token}\n`);
    const cliPath = path.join(clientDir, "cli.ts");
    const store = path.resolve(this.store.dir);
    writePrivateFile(path.join(stateDir, "config.json"), JSON.stringify({ relayUrl: identity.relayUrl, storeDir: store, nodePath: process.execPath, cliPath }, null, 2) + "\n");
    const q = (s: string): string => `'${s.replaceAll("'", "'\\''")}'`;
    const command = `MUSEBUDDIES_DIR=${q(store)} ${q(process.execPath)} --no-warnings ${q(cliPath)}`;
    const workerPromptPath = path.join(stateDir, "worker.md");
    writePrivateFile(workerPromptPath, fs.readFileSync(path.join(clientDir, "receive-worker.md"), "utf8").replaceAll("__CLI__", command));
    const scriptPath = path.join(scriptDir, "musebuddies-receive.sh");
    fs.copyFileSync(path.join(clientDir, "receive-hook.sh"), scriptPath);
    fs.chmodSync(scriptPath, 0o700);
    return { scriptPath, workerPromptPath, pollIntervalSecs: 60, scriptTimeoutSecs: 20 };
  }
}

/** Read-only check for the receive hook: never creates or migrates the store. */
export function hookCheck(): object {
  const store = new Store(storeDir(), true);
  try {
    const count = (sql: string): number => {
      try {
        return Number((store.db.prepare(sql).get() as { n: number }).n);
      } catch {
        return 0; // store not yet migrated; it gains new columns on the next writable open
      }
    };
    return {
      pendingMessagesCount: count("SELECT COUNT(*) AS n FROM messages WHERE status = 'pending_muse'"),
      urgentMessagesCount: count("SELECT COUNT(*) AS n FROM messages WHERE status = 'pending_muse' AND priority = 'urgent'"),
      pendingOutboxCount: count("SELECT COUNT(*) AS n FROM outbox WHERE status = 'pending'")
    };
  } finally {
    store.close();
  }
}
