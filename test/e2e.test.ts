import assert from "node:assert/strict";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { MuseTogether } from "../src/client/cli.ts";
import { Store } from "../src/client/store.ts";
import { createServer } from "../src/server/main.ts";
import { Relay } from "../src/server/relay.ts";

let baseUrl = "";
let server: ReturnType<typeof createServer>;
const relay = new Relay(":memory:");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "musetogether-test-"));
const muse = (name: string): MuseTogether => new MuseTogether(new Store(path.join(tmp, name)));

before(async () => {
  server = createServer({ relay, publicUrl: "http://placeholder" });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
  relay.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("two Muses pair, exchange messages both ways, and disconnect", async () => {
  const alice = muse("alice");
  const bob = muse("bob");
  await alice.setup(baseUrl);
  await bob.setup(baseUrl);

  const invite = (await alice.inviteCreate("Bob")) as { inviteUrl: string };
  assert.match(invite.inviteUrl, /\/invite\/[A-Za-z0-9_-]{8,}#[A-Za-z0-9_-]{22,}$/);
  await bob.inviteAccept("Alice", invite.inviteUrl);

  await alice.poll(); // msg1 -> sends msg2
  await bob.poll(); // msg2 -> sends msg3
  assert.equal(bob.store.getContact("Alice")?.status, "pending_handshake");
  await alice.poll(); // msg3 -> active, sends ready
  assert.equal(alice.store.getContact("Bob")?.status, "active");
  await bob.poll(); // ready -> active
  assert.equal(bob.store.getContact("Alice")?.status, "active");
  assert.equal(alice.store.getContact("Bob")?.peerStaticKey, bob.store.getIdentity()?.staticPublicKey);

  await bob.send("Alice", "dinner", "Thursday after 7 works.", null);
  await bob.send("Alice", "dinner", "Veggie options please!", null);
  await alice.poll();
  const inbox = alice.store.pendingMessages();
  assert.deepEqual(inbox.map((m) => m.body), ["Thursday after 7 works.", "Veggie options please!"]);
  assert.equal(inbox[0].contact, "Bob");

  const reply = (await alice.send("Bob", "dinner", "Olive at 7?", inbox[1].messageId)) as { status: string };
  assert.equal(reply.status, "sent");
  await bob.poll();
  const [got] = bob.store.pendingMessages();
  assert.equal(got.body, "Olive at 7?");
  assert.equal(got.inReplyTo, inbox[1].messageId);
  assert.equal(bob.store.markHandled(got.messageId), true);

  // The relay only ever saw ciphertext.
  const dump = JSON.stringify(relay.db.prepare("SELECT * FROM events").all());
  assert.ok(!dump.includes("Olive"));

  await alice.disconnect("Bob");
  await bob.poll();
  assert.equal(bob.store.getContact("Alice")?.status, "disconnected");
  await assert.rejects(bob.send("Alice", "dinner", "hello?", null), /disconnected/);
});

test("invitations are single-use and cannot be accepted by the inviter", async () => {
  const a = muse("a1");
  const b = muse("b1");
  const c = muse("c1");
  for (const m of [a, b, c]) await m.setup(baseUrl);
  const { inviteUrl } = (await a.inviteCreate("friend")) as { inviteUrl: string };
  await assert.rejects(a.inviteAccept("me", inviteUrl), /own invitation/);
  await b.inviteAccept("a", inviteUrl);
  await assert.rejects(c.inviteAccept("a", inviteUrl), /already been used/);
});

test("a wrong invitation secret fails the handshake without activating", async () => {
  const a = muse("a2");
  const b = muse("b2");
  for (const m of [a, b]) await m.setup(baseUrl);
  const { inviteUrl } = (await a.inviteCreate("friend")) as { inviteUrl: string };
  const forged = inviteUrl.replace(/#.*/, "#" + Buffer.alloc(32, 7).toString("base64url"));
  await b.inviteAccept("a", forged);
  await a.poll();
  await b.poll();
  await a.poll();
  await b.poll();
  assert.equal(a.store.getContact("friend")?.status, "pending_handshake");
  assert.notEqual(b.store.getContact("a")?.status, "active");
});

test("relay rejects unauthenticated and non-participant requests", async () => {
  const res = await fetch(`${baseUrl}/v1/events`);
  assert.equal(res.status, 401);
  const stranger = relay.registerInbox();
  const r2 = await fetch(`${baseUrl}/v1/connections/conn_nope/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${stranger.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messageId: "m", nonce: 0, ciphertext: "AAAA" })
  });
  assert.equal(r2.status, 404);
});
