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

/** Plaintext carried inside every encrypted transport frame (except the "ready" frame). */
export interface ApplicationPayload {
  version: 1;
  messageId: string;
  conversationId: string;
  inReplyTo: string | null;
  sentAt: string;
  body: string;
  /**
   * Optional extension. Absent means "normal". Clients that predate it ignore it,
   * so it is only ever sent when "urgent".
   */
  priority?: Priority;
}

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

export function validateApplicationPayload(raw: unknown): ApplicationPayload {
  const o = raw as Record<string, unknown> | null;
  if (typeof o !== "object" || o === null) throw new Error("Payload is not an object");
  if (o.version !== 1) throw new Error(`Unsupported payload version ${String(o.version)}`);
  for (const field of ["messageId", "conversationId", "sentAt", "body"] as const) {
    if (typeof o[field] !== "string") throw new Error(`Payload field ${field} must be a string`);
  }
  if (o.inReplyTo !== null && typeof o.inReplyTo !== "string") throw new Error("Payload field inReplyTo is invalid");
  if (Buffer.byteLength(o.body as string, "utf8") > MAX_PLAINTEXT_BYTES) throw new Error("Payload body too large");
  if (Number.isNaN(Date.parse(o.sentAt as string))) throw new Error("Payload sentAt is not a timestamp");
  return {
    version: 1,
    messageId: o.messageId as string,
    conversationId: o.conversationId as string,
    inReplyTo: o.inReplyTo as string | null,
    sentAt: o.sentAt as string,
    body: o.body as string,
    // Unknown priority values degrade to normal rather than rejecting the message.
    priority: o.priority === "urgent" ? "urgent" : "normal"
  };
}
