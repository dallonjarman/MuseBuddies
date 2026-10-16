import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, test } from "node:test";
import { MuseTogether, hookCheck } from "../src/client/cli.ts";
import { Store } from "../src/client/store.ts";
import { createServer } from "../src/server/main.ts";
import { Relay } from "../src/server/relay.ts";

let baseUrl = "";
let server: ReturnType<typeof createServer>;
const relay = new Relay(":memory:");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "musetogether-test-"));
const muse = (name: string): MuseTogether => new MuseTogether(new Store(path.join(tmp, name)));
const PASS = "correct horse battery staple";

before(async () => {
  server = createServer({ relay, publicUrl: "http://placeholder", registrationsPerHour: 1000 });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
  relay.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function ready(...names: string[]): Promise<MuseTogether[]> {
  const muses = names.map(muse);
  for (const m of muses) await m.setup(baseUrl);
  return muses;
}

async function pair(a: MuseTogether, aliasForB: string, b: MuseTogether, aliasForA: string): Promise<void> {
  const { inviteUrl } = (await a.inviteCreate(aliasForB)) as { inviteUrl: string };
  await b.inviteAccept(aliasForA, inviteUrl);
  await a.poll(); // msg1 -> msg2
  await b.poll(); // msg2 -> msg3
  await a.poll(); // msg3 -> active, ready frame
  await b.poll(); // ready -> active, features frame
  await a.poll(); // features
}

type Out = { messageId: string; delivery: string; deliveredAt: string | null; handledAt: string | null; receiptsSupported: boolean };

test("two Muses pair, exchange messages both ways, and disconnect", async () => {
  const [alice, bob] = await ready("alice", "bob");
  const { inviteUrl } = (await alice.inviteCreate("Bob")) as { inviteUrl: string };
  assert.match(inviteUrl, /\/invite\/[A-Za-z0-9_-]{8,}#[A-Za-z0-9_-]{22,}$/);
  await bob.inviteAccept("Alice", inviteUrl);
  await alice.poll();
  await bob.poll();
  assert.equal(bob.store.getContact("Alice")?.status, "pending_handshake");
  await alice.poll();
  assert.equal(alice.store.getContact("Bob")?.status, "active");
  await bob.poll();
  assert.equal(bob.store.getContact("Alice")?.status, "active");
  assert.equal(alice.store.getContact("Bob")?.peerStaticKey, bob.store.getIdentity()?.staticPublicKey);

  await bob.send({ contacts: ["Alice"], conversationId: "dinner", body: "Thursday after 7 works." });
  await bob.send({ contacts: ["Alice"], conversationId: "dinner", body: "Veggie options please!" });
  await alice.poll();
  const inbox = alice.store.pendingMessages();
  assert.deepEqual(inbox.map((m) => m.body), ["Thursday after 7 works.", "Veggie options please!"]);
  assert.equal(inbox[0].contact, "Bob");

  const reply = (await alice.send({ contacts: ["Bob"], conversationId: "dinner", body: "Olive at 7?", inReplyTo: inbox[1].messageId })) as { status: string };
  assert.equal(reply.status, "sent");
  await bob.poll();
  const got = bob.store.pendingMessages().find((m) => m.body === "Olive at 7?")!;
  assert.equal(got.inReplyTo, inbox[1].messageId);

  // The relay only ever saw ciphertext.
  assert.ok(!JSON.stringify(relay.db.prepare("SELECT * FROM events").all()).includes("Olive"));

  await alice.disconnect("Bob");
  await bob.poll();
  assert.equal(bob.store.getContact("Alice")?.status, "disconnected");
  await assert.rejects(bob.send({ contacts: ["Alice"], conversationId: "dinner", body: "hello?" }), /disconnected/);
});

test("invitations are single-use and cannot be accepted by the inviter", async () => {
  const [a, b, c] = await ready("a1", "b1", "c1");
  const { inviteUrl } = (await a.inviteCreate("friend")) as { inviteUrl: string };
  await assert.rejects(a.inviteAccept("me", inviteUrl), /own invitation/);
  await b.inviteAccept("a", inviteUrl);
  await assert.rejects(c.inviteAccept("a", inviteUrl), /already been used/);
});

test("a wrong invitation secret fails the handshake without activating", async () => {
  const [a, b] = await ready("a2", "b2");
  const { inviteUrl } = (await a.inviteCreate("friend")) as { inviteUrl: string };
  await b.inviteAccept("a", inviteUrl.replace(/#.*/, "#" + Buffer.alloc(32, 7).toString("base64url")));
  for (let i = 0; i < 2; i++) {
    await a.poll();
    await b.poll();
  }
  assert.equal(a.store.getContact("friend")?.status, "pending_handshake");
  assert.notEqual(b.store.getContact("a")?.status, "active");
});

test("relay rejects unauthenticated and non-participant requests", async () => {
  assert.equal((await fetch(`${baseUrl}/v1/events`)).status, 401);
  const stranger = relay.registerInbox();
  const res = await fetch(`${baseUrl}/v1/connections/conn_nope/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${stranger.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messageId: "m", nonce: 0, ciphertext: "AAAA" })
  });
  assert.equal(res.status, 404);
});

test("urgent updates are listed first and flagged for the hook", async () => {
  const [traveler, friend] = await ready("traveler", "friend");
  await pair(traveler, "Alex", friend, "Sam");
  await traveler.send({ contacts: ["Alex"], conversationId: "flight-UA123", body: "Delayed 45 min, landing 8:25pm." });
  await traveler.send({ contacts: ["Alex"], conversationId: "flight-UA123", body: "Missed the flight. Rebooked on UA455, 11:15pm.", priority: "urgent" });
  await friend.poll();
  const pending = friend.store.pendingMessages();
  assert.deepEqual(pending.map((m) => m.priority), ["urgent", "normal"]);

  process.env.MUSETOGETHER_DIR = path.join(tmp, "friend");
  try {
    assert.deepEqual(hookCheck(), { pendingMessagesCount: 2, urgentMessagesCount: 1, pendingOutboxCount: 0 });
  } finally {
    delete process.env.MUSETOGETHER_DIR;
  }
});

test("receipts report delivered and handled back to the sender", async () => {
  const [me, them] = await ready("r-me", "r-them");
  await pair(me, "Them", them, "Me");
  // The accepter learns the inviter's features from the "ready" frame...
  assert.equal(them.store.getContact("Me")?.peerFeatures.includes("receipts"), true);
  const sent = (await them.send({ contacts: ["Me"], conversationId: "c", body: "hi" })) as { messageId: string };
  const [before] = them.outbound({ conversationId: "c" }) as Out[];
  assert.equal(before.delivery, "sent_to_relay");

  await me.poll(); // ...and the inviter learned the accepter's from its features frame; it sends "delivered"
  assert.equal(me.store.getContact("Them")?.peerFeatures.includes("receipts"), true);
  await them.poll();
  let [o] = them.outbound({ conversationId: "c" }) as Out[];
  assert.equal(o.delivery, "delivered");
  assert.ok(o.deliveredAt);
  assert.equal(o.receiptsSupported, true);

  await me.messageHandled(sent.messageId);
  await them.poll();
  [o] = them.outbound({ conversationId: "c" }) as Out[];
  assert.equal(o.delivery, "handled");
  assert.ok(o.handledAt);
});

test("update keys replace earlier unread updates, and handling covers them", async () => {
  const [me, them] = await ready("u-me", "u-them");
  await pair(me, "Them", them, "Me");
  for (const body of ["Delayed 30m", "Delayed 1h", "Delayed 2h, arriving 9:40pm"]) {
    await them.send({ contacts: ["Me"], conversationId: "flight", body, updateKey: "flight-status" });
  }
  await them.send({ contacts: ["Me"], conversationId: "flight", body: "Gate moved to B12" });
  await me.poll();
  const pending = me.store.pendingMessages();
  assert.deepEqual(pending.map((m) => m.body), ["Delayed 2h, arriving 9:40pm", "Gate moved to B12"]);

  const handled = (await me.messageHandled(pending[0].messageId)) as { alsoHandled: string[] };
  assert.equal(handled.alsoHandled.length, 2);
  await them.poll();
  const states = (them.outbound({ conversationId: "flight" }) as Out[]).map((o) => o.delivery);
  assert.deepEqual(states, ["handled", "handled", "handled", "delivered"]);
});

test("group sends fan out with a shared conversation and threads collect replies", async () => {
  const [host, alex, sam] = await ready("g-host", "g-alex", "g-sam");
  await pair(host, "Alex", alex, "Host");
  await pair(host, "Sam", sam, "Host");
  host.groupCreate("Dinner crew", ["Alex", "Sam"]);

  const res = (await host.send({ group: "Dinner crew", conversationId: "dinner-thu", body: "Thursday 7pm?" })) as {
    results: { contact: string; status: string }[];
  };
  assert.deepEqual(res.results.map((r) => [r.contact, r.status]), [["Alex", "sent"], ["Sam", "sent"]]);

  await alex.poll();
  await sam.poll();
  const [toAlex] = alex.store.pendingMessages();
  assert.deepEqual(toAlex.group && { name: toAlex.group.name, size: toAlex.group.size }, { name: "Dinner crew", size: 3 });
  await alex.send({ contacts: ["Host"], conversationId: "dinner-thu", body: "Works for me", inReplyTo: toAlex.messageId });
  await sam.send({ contacts: ["Host"], conversationId: "dinner-thu", body: "Only after 7:30" });
  await host.poll();

  const thread = host.thread("dinner-thu") as { participants: string[]; messages: { contact: string; direction: string; body: string }[] };
  assert.deepEqual(thread.participants.sort(), ["Alex", "Sam"]);
  assert.equal(thread.messages.length, 4);
  assert.deepEqual(thread.messages.filter((m) => m.direction === "inbound").map((m) => m.body).sort(), ["Only after 7:30", "Works for me"]);

  // One unreachable member doesn't block the others.
  await host.disconnect("Sam");
  const partial = (await host.send({ group: "Dinner crew", conversationId: "dinner-thu", body: "Booked Olive" })) as {
    results: { contact: string; status: string }[];
  };
  assert.deepEqual(partial.results.map((r) => r.status), ["sent", "failed"]);
});

test("attached events render as iCalendar and keep their uid across updates", async () => {
  const [me, them] = await ready("e-me", "e-them");
  await pair(me, "Them", them, "Me");
  const first = (await me.send({
    contacts: ["Them"],
    conversationId: "dinner",
    body: "Booked Olive for Thursday at 7.",
    event: { title: "Dinner at Olive", start: "2026-10-22T19:00:00-07:00", end: "2026-10-22T21:00:00-07:00", location: "Olive, 12 Main St" }
  })) as { eventUid: string };
  await me.send({
    contacts: ["Them"],
    conversationId: "dinner",
    body: "Moved to 7:30.",
    event: { uid: first.eventUid, title: "Dinner at Olive", start: "2026-10-22T19:30:00-07:00", location: "Olive, 12 Main St" }
  });
  await them.poll();
  const [a, b] = them.store.pendingMessages();
  assert.equal(a.event?.uid, b.event?.uid);
  const ics = them.ics(b.messageId);
  assert.match(ics, /DTSTART:20261023T023000Z/);
  assert.match(ics, /LOCATION:Olive\\, 12 Main St/);
  assert.match(ics, new RegExp(`UID:${first.eventUid}@musetogether`));
  await assert.rejects(me.send({ contacts: ["Them"], conversationId: "x", body: "bad", event: { title: "x", start: "not a date" } }), /ISO 8601/);
});

test("invitations can be listed and cancelled", async () => {
  const [a, b] = await ready("i-a", "i-b");
  const { inviteUrl } = (await a.inviteCreate("Wrong person")) as { inviteUrl: string };
  const list = (await a.inviteList()) as { alias: string; state: string }[];
  assert.deepEqual(list.map((i) => [i.alias, i.state]), [["Wrong person", "waiting_for_friend"]]);
  await a.inviteCancel("Wrong person");
  assert.deepEqual(await a.inviteList(), []);
  await assert.rejects(b.inviteAccept("a", inviteUrl), /cancelled/);
});

test("long-poll returns as soon as an event arrives", async () => {
  const [me, them] = await ready("l-me", "l-them");
  await pair(me, "Them", them, "Me");
  const started = Date.now();
  const polling = me.poll({ wait: 10 });
  setTimeout(() => void them.send({ contacts: ["Me"], conversationId: "c", body: "now" }), 300);
  await polling;
  assert.ok(Date.now() - started < 5000, "long-poll should return promptly");
  assert.equal(me.store.pendingMessages()[0]?.body, "now");
});

test("backups restore identity and contacts without reusing nonces", async () => {
  const [me, them] = await ready("b-me", "b-them");
  await pair(me, "Them", them, "Me");
  assert.ok(me.store.getContact("Them")!.peerFeatures.includes("nonce-skip"));
  await me.send({ contacts: ["Them"], conversationId: "c", body: "before backup" });
  const file = path.join(tmp, "me.backup");
  me.backupExport(file, PASS);
  await me.send({ contacts: ["Them"], conversationId: "c", body: "after backup" });
  await them.poll();

  const restoredDir = path.join(tmp, "b-me-restored");
  assert.throws(() => MuseTogether.backupImport(restoredDir, file, "wrong passphrase!!"), /Wrong passphrase/);
  const result = MuseTogether.backupImport(restoredDir, file, PASS) as { contacts: { alias: string; status: string }[] };
  assert.deepEqual(result.contacts, [{ alias: "Them", status: "active" }]);
  me.store.close();

  const restored = new MuseTogether(new Store(restoredDir));
  await restored.send({ contacts: ["Them"], conversationId: "c", body: "from restored device" });
  await them.poll();
  assert.deepEqual(them.store.pendingMessages().map((m) => m.body), ["before backup", "after backup", "from restored device"]);
  const restoredSends = restored.store.getContact("Them")!.sendNonce;
  assert.ok(restoredSends > 1_000_000, "restored device skips past nonces the old device may have used");
  await them.send({ contacts: ["Me"], conversationId: "c", body: "reply to restored" });
  await restored.poll();
  assert.ok(restored.store.pendingMessages().some((m) => m.body === "reply to restored"));
});

test("restores mark connections needs_repair when the peer can't accept skipped nonces", async () => {
  const [me, them] = await ready("n-me", "n-them");
  await pair(me, "Them", them, "Me");
  // Simulate a peer whose features were never learned (e.g. one running the original client).
  me.store.saveContact({ ...me.store.getContact("Them")!, peerFeatures: [] });
  const file = path.join(tmp, "n-me.backup");
  me.backupExport(file, PASS);
  const dir = path.join(tmp, "n-me-restored");
  const result = MuseTogether.backupImport(dir, file, PASS) as { contacts: { status: string }[] };
  assert.equal(result.contacts[0].status, "needs_repair");
  const restored = new MuseTogether(new Store(dir));
  await assert.rejects(restored.send({ contacts: ["Them"], conversationId: "c", body: "x" }), /needs_repair/);
  // Receiving still works.
  await them.send({ contacts: ["Me"], conversationId: "c", body: "still hear you" });
  await restored.poll();
  assert.equal(restored.store.pendingMessages()[0].body, "still hear you");
  assert.match(JSON.stringify(restored.status()), /needs_repair|Them/);
  // An existing setup is not overwritten without --force.
  assert.throws(() => MuseTogether.backupImport(dir, file, PASS), /--force/);
});

test("stores created before later columns are migrated", () => {
  const dir = path.join(tmp, "legacy");
  fs.mkdirSync(dir);
  const legacy = new DatabaseSync(path.join(dir, "state.db"));
  legacy.exec(`CREATE TABLE messages (
    message_id TEXT PRIMARY KEY, connection_id TEXT NOT NULL, conversation_id TEXT NOT NULL, in_reply_to TEXT,
    direction TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL, sent_at TEXT NOT NULL, created_at TEXT NOT NULL)`);
  legacy.exec("INSERT INTO messages VALUES ('m1', 'c1', 'conv', NULL, 'inbound', 'hi', 'pending_muse', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')");
  legacy.close();
  const store = new Store(dir);
  const [m] = store.pendingMessages();
  assert.equal(m.priority, "normal");
  assert.equal(m.updateKey, null);
  store.close();
});

test("the command-line interface drives a full exchange", async () => {
  const cli = path.resolve("src/client/cli.ts");
  const run = async (who: string, ...args: string[]): Promise<any> => {
    const { stdout } = await promisify(execFile)(process.execPath, ["--no-warnings", cli, ...args], {
      env: { ...process.env, MUSETOGETHER_DIR: path.join(tmp, who) }
    });
    return JSON.parse(stdout);
  };
  await run("cli-a", "setup", "--relay", baseUrl);
  await run("cli-b", "setup", "--relay", baseUrl);
  const { inviteUrl } = await run("cli-a", "invite", "create", "--alias", "B");
  await run("cli-b", "invite", "accept", "--alias", "A", "--url", inviteUrl);
  for (let i = 0; i < 3; i++) {
    await run("cli-a", "poll");
    await run("cli-b", "poll", "--wait", "0");
  }
  assert.equal((await run("cli-b", "contacts", "list"))[0].status, "active");
  const sent = await run("cli-b", "send", "--contact", "A", "--conversation", "trip", "--urgent", "--update-key", "eta", "--body", "Landing 9:40pm",
    "--event-title", "Pickup", "--event-start", "2026-10-20T21:40:00Z");
  assert.equal(sent.status, "sent");
  await run("cli-a", "poll");
  const [m] = await run("cli-a", "messages", "pending");
  assert.deepEqual([m.body, m.priority, m.updateKey, m.event.title], ["Landing 9:40pm", "urgent", "eta", "Pickup"]);
  await run("cli-a", "messages", "handled", m.messageId);
  await run("cli-b", "poll");
  assert.equal((await run("cli-b", "messages", "outbound", "--conversation", "trip"))[0].delivery, "handled");
  assert.equal((await run("cli-b", "status")).status, "ready");
});

// ---- availability sharing ----

const DAY = 86_400_000;
const midnightUtc = (daysFromNow: number): string => new Date(Math.floor(Date.now() / DAY) * DAY + daysFromNow * DAY).toISOString();
const at = (daysFromNow: number, hh: number, mm = 0): string => new Date(Date.parse(midnightUtc(daysFromNow)) + (hh * 60 + mm) * 60_000).toISOString();

type Pending = { messageId: string; availabilityRequest?: { requestId: string; autoAnswer: { allowed: boolean; reason?: string; coveredFrom?: string; coveredTo?: string } } };

test("availability: auto-answer with permission, owner approval without, organizer gets common times", async () => {
  const [host, alex, sam] = await ready("av-host", "av-alex", "av-sam");
  await pair(host, "Alex", alex, "Host");
  await pair(host, "Sam", sam, "Host");
  host.groupCreate("Dinner crew", ["Alex", "Sam"]);

  // Alex's owner lets the host's Muse see availability, evenings only, UTC for a deterministic test.
  await alex.shareGrant("Host", { daysAhead: 14, hours: "17:00-23:00", timezone: "UTC" });
  await host.poll(); // grants frame
  assert.deepEqual((host.contacts() as { alias: string; sharesWithMe: unknown }[]).find((c) => c.alias === "Alex")?.sharesWithMe, {
    availability: { daysAhead: 14, hours: "17:00-23:00", timezone: "UTC" }
  });

  const { requestId } = (await host.availabilityRequest({
    group: "Dinner crew", conversationId: "dinner", from: midnightUtc(2), to: midnightUtc(4), durationMinutes: 90, note: "Dinner"
  })) as { requestId: string };

  // Alex's Muse may answer by itself.
  await alex.poll();
  const [toAlex] = alex.pending() as Pending[];
  assert.equal(toAlex.availabilityRequest?.autoAnswer.allowed, true);
  const busy = [
    { start: at(2, 18), end: at(2, 21) }, // "Dentist" — the title never leaves this device
    { start: at(3, 17), end: at(3, 18) }
  ];
  const alexAnswer = (await alex.availabilityRespond({ requestId, busy })) as { automatic: boolean; free: { start: string; end: string }[] };
  assert.equal(alexAnswer.automatic, true);
  // Evenings 17-23 minus busy: day 2 leaves 17-18 (too short) and 21-23; day 3 leaves 18-23.
  assert.deepEqual(alexAnswer.free, [{ start: at(2, 21), end: at(2, 23) }, { start: at(3, 18), end: at(3, 23) }]);
  assert.deepEqual(alex.pending(), [], "answered automatically; owner not bothered");

  // Sam's Muse has no permission: it must ask Sam.
  await sam.poll();
  const [toSam] = sam.pending() as Pending[];
  assert.equal(toSam.availabilityRequest?.autoAnswer.allowed, false);
  await assert.rejects(sam.availabilityRespond({ requestId, busy: [] }), /owner-approved/);

  // Partial results: one answer in, no owner notification yet.
  await host.poll();
  assert.equal(host.store.pendingMessages().filter((m) => m.availabilityResponse).length, 0);
  assert.deepEqual((host.availabilityResults(requestId) as { waitingFor: string[] }).waitingFor, ["Sam"]);

  // Sam agrees; Sam's Muse answers with the owner's approval.
  await sam.availabilityRespond({ requestId, ownerApproved: true, free: [{ start: at(2, 20), end: at(3, 23, 59) }] });
  await host.poll();
  const done = host.pending() as { availabilityResults?: { complete: boolean; commonFree: unknown[] } }[];
  assert.equal(done.length, 1, "owner hears once, when everyone has answered");
  const results = host.availabilityResults(requestId, [{ start: at(3, 21), end: at(3, 22) }]) as {
    complete: boolean;
    commonFree: { start: string; end: string }[];
    participants: { contact: string; automatic: boolean }[];
  };
  assert.equal(results.complete, true);
  // Alex ∩ Sam (day 2 20:00 → day 3 23:59) minus the host's 21-22 on day 3; 22-23 is too short for 90 min.
  assert.deepEqual(results.commonFree, [{ start: at(2, 21), end: at(2, 23) }, { start: at(3, 18), end: at(3, 21) }]);
  assert.deepEqual(results.participants.map((p) => [p.contact, p.automatic]), [["Alex", true], ["Sam", false]]);

  // Only free slots crossed the wire.
  const received = host.store.listMessages({ conversationId: "dinner", direction: "inbound" });
  assert.ok(received.every((m) => !JSON.stringify(m).includes(at(2, 18))));
});

test("availability: revoked, expired, connection-bound and rate-limited permissions stop auto-answers", async () => {
  const [host, alex] = await ready("avr-host", "avr-alex");
  await pair(host, "Alex", alex, "Host");
  const ask = async (): Promise<Pending> => {
    const hour = 3_600_000;
    const from = new Date(Date.now() + hour).toISOString();
    await host.availabilityRequest({ contacts: ["Alex"], conversationId: "c", from, to: new Date(Date.now() + 3 * DAY).toISOString(), durationMinutes: 60 });
    await alex.poll();
    const all = alex.pending() as Pending[];
    return all[all.length - 1];
  };

  await alex.shareGrant("Host", { maxPerDay: 1, timezone: "UTC" });
  const first = await ask();
  assert.equal(first.availabilityRequest?.autoAnswer.allowed, true);
  await alex.availabilityRespond({ requestId: first.availabilityRequest!.requestId, busy: [] });
  await assert.rejects(alex.availabilityRespond({ requestId: first.availabilityRequest!.requestId, busy: [] }), /Already answered/);
  const second = await ask();
  assert.match(second.availabilityRequest!.autoAnswer.reason!, /daily limit/);

  await alex.shareGrant("Host", { maxPerDay: 5, expiresAt: new Date(Date.now() - 1000).toISOString() });
  assert.match((await ask()).availabilityRequest!.autoAnswer.reason!, /no standing permission/);

  await alex.shareGrant("Host", { daysAhead: 1, timezone: "UTC" });
  const clipped = await ask();
  assert.ok(Date.parse(clipped.availabilityRequest!.autoAnswer.coveredTo!) <= Date.now() + DAY + 1000, "window clipped to days-ahead");

  await alex.shareRevoke("Host");
  await host.poll();
  assert.equal((host.contacts() as { alias: string; sharesWithMe: { availability: unknown } }[])[0].sharesWithMe.availability, null);
  assert.match((await ask()).availabilityRequest!.autoAnswer.reason!, /no standing permission/);

  // A grant is tied to the connection: a new pairing under the same name doesn't inherit it.
  await alex.shareGrant("Host", { timezone: "UTC" });
  alex.store.saveContact({ ...alex.store.getContact("Host")!, connectionId: "conn_other" });
  assert.equal((alex.shareList() as { iShare: { active: boolean }[] }).iShare[0].active, false);
});

test("pages link versioned assets and the compose file downloads", async () => {
  const html = await (await fetch(`${baseUrl}/`)).text();
  assert.doesNotMatch(html, /\{\{[A-Z_]+\}\}/);
  assert.match(html, /src="app\.js\?v=[0-9a-f]{10}"/);
  const compose = await fetch(`${baseUrl}/docker-compose.yml`);
  assert.equal(compose.status, 200);
  assert.match(compose.headers.get("content-disposition") ?? "", /^attachment/);
  await compose.arrayBuffer();
});
