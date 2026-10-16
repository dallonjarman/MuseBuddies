// HTTP entry point: serves the v1 relay API, the public website, and the client package.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_REQUEST_BODY_BYTES } from "../shared/protocol.ts";
import { HttpError, Relay } from "./relay.ts";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const publicDir = path.join(rootDir, "public");

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".sh": "text/x-shellscript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".gz": "application/gzip",
  ".txt": "text/plain; charset=utf-8"
};

export interface ServerOptions {
  relay: Relay;
  /** Public origin, e.g. https://musetogether.example. Substituted for {{PUBLIC_URL}} in text assets. */
  publicUrl: string;
  /** Max inbox registrations per IP per hour. */
  registrationsPerHour?: number;
  trustProxy?: boolean;
}

class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }
  allow(key: string): boolean {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.hits.clear();
    return true;
  }
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_REQUEST_BODY_BYTES) throw new HttpError(413, "Request body too large");
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "Body must be a JSON object");
  }
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function serveStatic(res: http.ServerResponse, pathname: string, publicUrl: string): boolean {
  let file = pathname === "/" ? "index.html" : pathname.slice(1);
  if (/^invite\/[^/]+$/.test(file)) file = "invite.html";
  const target = path.resolve(publicDir, file);
  if (!target.startsWith(publicDir + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) return false;
  const ext = path.extname(target);
  let body: Buffer | string = fs.readFileSync(target);
  if ([".html", ".md", ".sh", ".js"].includes(ext)) body = body.toString("utf8").replaceAll("{{PUBLIC_URL}}", publicUrl);
  res.writeHead(200, {
    "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
    "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=300",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(body);
  return true;
}

const MAX_WAIT_SECONDS = 30;

export function createServer(opts: ServerOptions): http.Server {
  const { relay } = opts;
  // Long-poll waiters per inbox, woken when the relay queues an event for it.
  const waiters = new Map<string, Set<() => void>>();
  relay.onEnqueue = (inboxId) => {
    const set = waiters.get(inboxId);
    if (!set) return;
    waiters.delete(inboxId);
    for (const wake of set) wake();
  };
  const waitForEvent = (inboxId: string, seconds: number, req: http.IncomingMessage): Promise<void> =>
    new Promise((resolve) => {
      let set = waiters.get(inboxId);
      if (!set) waiters.set(inboxId, (set = new Set()));
      const done = (): void => {
        clearTimeout(timer);
        set.delete(done);
        if (set.size === 0 && waiters.get(inboxId) === set) waiters.delete(inboxId);
        resolve();
      };
      const timer = setTimeout(done, seconds * 1000);
      set.add(done);
      req.once("close", done);
    });
  const publicUrl = opts.publicUrl.replace(/\/+$/, "");
  const registrations = new RateLimiter(opts.registrationsPerHour ?? 20, 60 * 60 * 1000);

  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://relay.local");
    const method = req.method ?? "GET";
    const p = url.pathname;
    try {
      if (!p.startsWith("/v1/")) {
        if ((method === "GET" || method === "HEAD") && serveStatic(res, p, publicUrl)) return;
        if (p === "/healthz") return sendJson(res, 200, { ok: true });
        throw new HttpError(404, "Not found");
      }

      const auth = (): string => relay.authenticate(req.headers.authorization);
      let m: RegExpExecArray | null;

      if (method === "POST" && p === "/v1/inboxes") {
        const forwarded = opts.trustProxy ? String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() : "";
        const ip = forwarded || req.socket.remoteAddress || "unknown";
        if (!registrations.allow(ip)) throw new HttpError(429, "Too many registrations; try again later");
        return sendJson(res, 201, relay.registerInbox());
      }
      if (method === "POST" && p === "/v1/invitations") {
        const inbox = auth();
        return sendJson(res, 201, relay.createInvitation(inbox, await readJson(req)));
      }
      if (method === "GET" && (m = /^\/v1\/invitations\/([^/]+)$/.exec(p))) {
        return sendJson(res, 200, relay.invitationInfo(decodeURIComponent(m[1])));
      }
      if (method === "DELETE" && (m = /^\/v1\/invitations\/([^/]+)$/.exec(p))) {
        return sendJson(res, 200, relay.cancelInvitation(auth(), decodeURIComponent(m[1])));
      }
      if (method === "POST" && (m = /^\/v1\/invitations\/([^/]+)\/handshake$/.exec(p))) {
        const inbox = auth();
        return sendJson(res, 200, relay.submitHandshake(inbox, decodeURIComponent(m[1]), await readJson(req)));
      }
      if (method === "GET" && p === "/v1/events") {
        const inbox = auth();
        // Optional long-poll: ?wait=N holds the request up to N seconds until an event arrives.
        const wait = Math.min(Math.max(Number(url.searchParams.get("wait") ?? 0) || 0, 0), MAX_WAIT_SECONDS);
        let result = relay.pollEvents(inbox);
        if (result.events.length === 0 && wait > 0) {
          await waitForEvent(inbox, wait, req);
          if (req.destroyed) return;
          result = relay.pollEvents(inbox);
        }
        return sendJson(res, 200, result);
      }
      if (method === "POST" && p === "/v1/events/ack") {
        const inbox = auth();
        return sendJson(res, 200, relay.ackEvents(inbox, await readJson(req)));
      }
      if (method === "POST" && (m = /^\/v1\/connections\/([^/]+)\/messages$/.exec(p))) {
        const inbox = auth();
        return sendJson(res, 202, relay.postMessage(inbox, decodeURIComponent(m[1]), await readJson(req)));
      }
      if (method === "DELETE" && (m = /^\/v1\/connections\/([^/]+)$/.exec(p))) {
        return sendJson(res, 200, relay.disconnect(auth(), decodeURIComponent(m[1])));
      }
      throw new HttpError(404, "Not found");
    } catch (err) {
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
      console.error(err);
      return sendJson(res, 500, { error: "Internal server error" });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 8787);
  const host = process.env.HOST ?? "0.0.0.0";
  const publicUrl = process.env.PUBLIC_URL ?? `http://localhost:${port}`;
  const dbPath = process.env.DATABASE_PATH ?? path.join(rootDir, "data", "relay.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const relay = new Relay(dbPath);
  relay.prune();
  setInterval(() => relay.prune(), 60 * 60 * 1000).unref();
  const server = createServer({ relay, publicUrl, trustProxy: process.env.TRUST_PROXY === "1" });
  server.listen(port, host, () => console.log(`MuseTogether relay listening on ${host}:${port} (public URL ${publicUrl})`));
  const shutdown = (): void => {
    server.close(() => relay.close());
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
