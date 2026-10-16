// Wire types for the MuseTogether v1 relay API. See docs/PROTOCOL.md.

export const MAX_PLAINTEXT_BYTES = 32 * 1024;
export const MAX_CIPHERTEXT_BYTES = 48 * 1024;
export const MAX_REQUEST_BODY_BYTES = 64 * 1024;
export const INVITATION_TTL_MS = 24 * 60 * 60 * 1000;

export interface RegisterInboxResponse {
  inboxId: string;
  token: string;
  createdAt: string;
}

export type InvitationStatus = "pending" | "accepted" | "expired" | "cancelled";

export interface CreateInvitationResponse {
  invitationId: string;
  inviterInboxId: string;
  expiresAt: string;
}

export interface InvitationInfoResponse {
  invitationId: string;
  inviterInboxId: string;
  status: InvitationStatus;
  expiresAt: string;
}

export type HandshakeMessageNumber = 1 | 2 | 3;

export interface HandshakeSubmissionRequest {
  senderInboxId: string;
  messageNumber: HandshakeMessageNumber;
  payload: string;
}

export interface HandshakeSubmissionResponse {
  status: "received" | "connection_ready";
  connectionId?: string;
}

export interface PostMessageRequest {
  messageId: string;
  nonce: number;
  ciphertext: string;
}

export interface HandshakeEvent {
  eventId: string;
  type: "handshake";
  connectionId: string;
  invitationId: string;
  messageNumber: HandshakeMessageNumber;
  payload: string;
  createdAt: string;
}

export interface MessageEvent {
  eventId: string;
  type: "message";
  connectionId: string;
  senderInboxId: string;
  messageId: string;
  nonce: number;
  ciphertext: string;
  createdAt: string;
}

export interface DisconnectEvent {
  eventId: string;
  type: "disconnect";
  connectionId: string;
  createdAt: string;
}

export type RelayEvent = HandshakeEvent | MessageEvent | DisconnectEvent;

export type Priority = "normal" | "urgent";

/**
 * Extensions this implementation understands, advertised inside encrypted frames so
 * peers only send extension frames (receipts) to Muses that can process them.
 * Every extension field is optional and ignored by clients that predate it.
 */
export const FEATURES = ["priority", "receipts", "update-key", "group", "event", "nonce-skip", "availability"] as const;
export type Feature = (typeof FEATURES)[number];

export interface GroupInfo {
  /** Stable random id chosen by the sender for this group. */
  id: string;
  /** The sender's label for the group, e.g. "Dinner crew". */
  name: string;
  /** Number of people in the group, including the sender. */
  size: number;
}

export type PlanEventStatus = "tentative" | "confirmed" | "cancelled";

/** A calendar entry attached to a message. Reusing `uid` updates the same entry. */
export interface PlanEvent {
  uid: string;
  title: string;
  start: string;
  end?: string;
  location?: string;
  notes?: string;
  status: PlanEventStatus;
}

export interface TimeSlot {
  start: string;
  end: string;
}

/** Organizer -> participant: "when is your owner free?" */
export interface AvailabilityRequest {
  requestId: string;
  /** Window to search, ISO 8601. */
  from: string;
  to: string;
  durationMinutes: number;
  note?: string;
}

/**
 * Participant -> organizer. Carries only free slots (never busy blocks or event details),
 * rounded inward to 15 minutes.
 */
export interface AvailabilityResponse {
  requestId: string;
  status: "answered" | "declined";
  free: TimeSlot[];
  /** The window actually covered, which may be narrower than requested. */
  coveredFrom?: string;
  coveredTo?: string;
  /** True when answered under a standing permission, without asking the owner. */
  automatic: boolean;
}

/** What a participant lets one contact's Muse do without asking. Sent so organizers know what to expect. */
export interface SharingGrants {
  availability: { daysAhead: number; hours: string | null; timezone: string } | null;
}

/** Plaintext carried inside every encrypted application frame. */
export interface ApplicationPayload {
  version: 1;
  messageId: string;
  conversationId: string;
  inReplyTo: string | null;
  sentAt: string;
  body: string;
  /** Absent means normal. Only sent when "urgent". */
  priority?: Priority;
  /** Sender's supported extensions. */
  features?: string[];
  /** A newer message with the same key from the same sender replaces this one while unread. */
  updateKey?: string;
  group?: GroupInfo;
  event?: PlanEvent;
  availabilityRequest?: AvailabilityRequest;
  availabilityResponse?: AvailabilityResponse;
}

/** Extension frame telling a contact what this Muse will share with it automatically. */
export interface GrantsFrame {
  type: "grants";
  grants: SharingGrants;
}

/** First transport frame from the responder (inviter). `features` is an extension. */
export interface ReadyFrame {
  type: "ready";
  connectionId: string;
  features?: string[];
}

/**
 * Extension frame: the accepter's reply to a ready frame that advertised features,
 * so the inviter learns the accepter's features without waiting for a message.
 */
export interface FeaturesFrame {
  type: "features";
  features: string[];
}

export type ReceiptState = "delivered" | "handled";

/** Extension frame acknowledging messages. Only sent to peers advertising "receipts". */
export interface ReceiptFrame {
  type: "receipt";
  version: 1;
  state: ReceiptState;
  messageIds: string[];
  at: string;
}

const MAX_FIELD = 500;
const shortString = (v: unknown, max = MAX_FIELD): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const isTimestamp = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));

export function inviteUrl(baseUrl: string, invitationId: string, secret: Buffer): string {
  return `${baseUrl.replace(/\/+$/, "")}/invite/${invitationId}#${secret.toString("base64url")}`;
}

export function parseInviteUrl(raw: string, expectedOrigin?: string): { invitationId: string; secret: Buffer } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("Invalid invitation URL");
  }
  if (expectedOrigin !== undefined && url.origin !== new URL(expectedOrigin).origin) {
    throw new Error(`Invitation is for ${url.origin}, but this Muse is set up with ${new URL(expectedOrigin).origin}`);
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const i = parts.indexOf("invite");
  const invitationId = i === -1 ? undefined : parts[i + 1];
  if (!invitationId || invitationId.length < 8) throw new Error("Invalid invitation URL: missing /invite/<id>");
  const secret = Buffer.from(url.hash.slice(1), "base64url");
  if (secret.length < 16) throw new Error("Invitation URL is missing its secret (the part after #)");
  return { invitationId, secret };
}

export function validatePlanEvent(raw: unknown): PlanEvent {
  const o = raw as Record<string, unknown> | null;
  if (typeof o !== "object" || o === null) throw new Error("event must be an object");
  if (!shortString(o.uid, 200)) throw new Error("event.uid is required");
  if (!shortString(o.title)) throw new Error("event.title is required");
  if (!isTimestamp(o.start)) throw new Error("event.start must be an ISO 8601 timestamp");
  if (o.end !== undefined && (!isTimestamp(o.end) || Date.parse(o.end) < Date.parse(o.start))) {
    throw new Error("event.end must be an ISO 8601 timestamp after start");
  }
  for (const k of ["location", "notes"] as const) {
    if (o[k] !== undefined && !shortString(o[k], k === "notes" ? 2000 : MAX_FIELD)) throw new Error(`event.${k} is invalid`);
  }
  const status = o.status ?? "confirmed";
  if (status !== "tentative" && status !== "confirmed" && status !== "cancelled") throw new Error("event.status is invalid");
  return {
    uid: o.uid,
    title: o.title,
    start: new Date(o.start).toISOString(),
    ...(o.end !== undefined ? { end: new Date(o.end as string).toISOString() } : {}),
    ...(o.location !== undefined ? { location: o.location as string } : {}),
    ...(o.notes !== undefined ? { notes: o.notes as string } : {}),
    status
  };
}

/** Validates required fields strictly; malformed optional extensions are dropped, not fatal. */
export function validateApplicationPayload(raw: unknown): ApplicationPayload {
  const o = raw as Record<string, unknown> | null;
  if (typeof o !== "object" || o === null) throw new Error("Payload is not an object");
  if (o.version !== 1) throw new Error(`Unsupported payload version ${String(o.version)}`);
  for (const field of ["messageId", "conversationId", "sentAt", "body"] as const) {
    if (typeof o[field] !== "string") throw new Error(`Payload field ${field} must be a string`);
  }
  if (o.inReplyTo !== null && typeof o.inReplyTo !== "string") throw new Error("Payload field inReplyTo is invalid");
  if (Buffer.byteLength(o.body as string, "utf8") > MAX_PLAINTEXT_BYTES) throw new Error("Payload body too large");
  if (!isTimestamp(o.sentAt)) throw new Error("Payload sentAt is not a timestamp");

  const payload: ApplicationPayload = {
    version: 1,
    messageId: o.messageId as string,
    conversationId: o.conversationId as string,
    inReplyTo: o.inReplyTo as string | null,
    sentAt: o.sentAt as string,
    body: o.body as string,
    priority: o.priority === "urgent" ? "urgent" : "normal"
  };
  if (Array.isArray(o.features)) payload.features = o.features.filter((f): f is string => shortString(f, 50)).slice(0, 50);
  if (shortString(o.updateKey, 200)) payload.updateKey = o.updateKey;
  const g = o.group as Record<string, unknown> | undefined;
  if (g && shortString(g.id, 100) && shortString(g.name, 200) && Number.isInteger(g.size) && (g.size as number) >= 2 && (g.size as number) <= 100) {
    payload.group = { id: g.id, name: g.name, size: g.size as number };
  }
  const optional = <T>(value: unknown, validate: (v: unknown) => T): T | undefined => {
    if (value === undefined) return undefined;
    try {
      return validate(value);
    } catch {
      return undefined; // drop a malformed attachment, keep the message
    }
  };
  const event = optional(o.event, validatePlanEvent);
  if (event) payload.event = event;
  const request = optional(o.availabilityRequest, validateAvailabilityRequest);
  if (request) payload.availabilityRequest = request;
  const response = optional(o.availabilityResponse, validateAvailabilityResponse);
  if (response) payload.availabilityResponse = response;
  return payload;
}

const MAX_SLOTS = 200;

function validateSlots(raw: unknown): TimeSlot[] {
  if (!Array.isArray(raw) || raw.length > MAX_SLOTS) throw new Error("slots must be an array");
  return raw.map((x) => {
    const o = x as Record<string, unknown>;
    if (!isTimestamp(o?.start) || !isTimestamp(o?.end) || Date.parse(o.end) <= Date.parse(o.start)) throw new Error("Invalid slot");
    return { start: new Date(o.start).toISOString(), end: new Date(o.end).toISOString() };
  });
}

export function validateAvailabilityRequest(raw: unknown): AvailabilityRequest {
  const o = raw as Record<string, unknown> | null;
  if (typeof o !== "object" || o === null) throw new Error("availabilityRequest must be an object");
  if (!shortString(o.requestId, 100)) throw new Error("requestId is required");
  if (!isTimestamp(o.from) || !isTimestamp(o.to) || Date.parse(o.to) <= Date.parse(o.from)) throw new Error("from/to must be ISO timestamps with to after from");
  if (Date.parse(o.to) - Date.parse(o.from) > 62 * 86_400_000) throw new Error("Availability window can be at most 62 days");
  const d = o.durationMinutes;
  if (typeof d !== "number" || !Number.isInteger(d) || d < 15 || d > 24 * 60) throw new Error("durationMinutes must be 15..1440");
  return {
    requestId: o.requestId,
    from: new Date(o.from).toISOString(),
    to: new Date(o.to).toISOString(),
    durationMinutes: d,
    ...(shortString(o.note) ? { note: o.note } : {})
  };
}

export function validateAvailabilityResponse(raw: unknown): AvailabilityResponse {
  const o = raw as Record<string, unknown> | null;
  if (typeof o !== "object" || o === null) throw new Error("availabilityResponse must be an object");
  if (!shortString(o.requestId, 100)) throw new Error("requestId is required");
  if (o.status !== "answered" && o.status !== "declined") throw new Error("Invalid availability status");
  return {
    requestId: o.requestId,
    status: o.status,
    free: o.status === "answered" ? validateSlots(o.free) : [],
    ...(isTimestamp(o.coveredFrom) ? { coveredFrom: o.coveredFrom } : {}),
    ...(isTimestamp(o.coveredTo) ? { coveredTo: o.coveredTo } : {}),
    automatic: o.automatic === true
  };
}

export function validateGrants(raw: unknown): SharingGrants {
  const a = (raw as { availability?: Record<string, unknown> | null } | null)?.availability;
  if (!a) return { availability: null };
  return {
    availability: {
      daysAhead: Number.isInteger(a.daysAhead) ? Math.min(Math.max(a.daysAhead as number, 1), 62) : 14,
      hours: typeof a.hours === "string" && /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(a.hours) ? a.hours : null,
      timezone: shortString(a.timezone, 64) ? a.timezone : "UTC"
    }
  };
}

export function validateReceiptFrame(o: Record<string, unknown>): ReceiptFrame {
  if (o.version !== 1 || (o.state !== "delivered" && o.state !== "handled")) throw new Error("Invalid receipt");
  if (!Array.isArray(o.messageIds) || o.messageIds.length > 500 || !o.messageIds.every((m) => shortString(m, 200))) {
    throw new Error("Invalid receipt messageIds");
  }
  return { type: "receipt", version: 1, state: o.state, messageIds: o.messageIds as string[], at: isTimestamp(o.at) ? o.at : new Date().toISOString() };
}
