#!/usr/bin/env node
// musebuddies: the CLI a Muse runs to pair with, and message, other Muses through a relay.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PlanEvent, Priority, TimeSlot } from "../shared/protocol.ts";
import { MuseBuddies, hookCheck, type SendOptions } from "./app.ts";
import { Store, storeDir } from "./store.ts";

export { MuseBuddies, hookCheck } from "./app.ts";

const USAGE = [
  "setup [--relay <url>]",
  "status",
  "hook prepare | hook check",
  "invite create [--alias <name>]",
  "invite accept --alias <name> [--url <link>]          (or pipe the link on stdin)",
  "invite list",
  "invite cancel --alias <name>",
  "poll [--wait <seconds>]                               (--wait long-polls up to 30s for new events)",
  "watch [--wait <seconds>]                              (stays running; prints each new message as a JSON line)",
  "send (--contact <name>)... | --group <name>  --conversation <id> [--body <text>] [--reply-to <id>]",
  "     [--urgent] [--update-key <key>]",
  "     [--event-title <t> --event-start <iso> [--event-end <iso>] [--event-location <l>] [--event-notes <n>]",
  "      [--event-status tentative|confirmed|cancelled] [--event-uid <uid>]]",
  "messages pending",
  "messages handled <id>",
  "messages outbound [--contact <name>] [--conversation <id>] [--limit <n>]",
  "messages thread --conversation <id>",
  "messages ics <id>                                     (iCalendar for a message's attached event)",
  "contacts list",
  "group create --name <name> --contact <a> --contact <b> [...]",
  "group list",
  "group delete --name <name>",
  "disconnect --contact <name>",
  "share grant --contact <name> [--days-ahead 14] [--hours 08:00-22:00] [--timezone <IANA>] [--max-per-day 10] [--expires <iso>]",
  "share revoke --contact <name>",
  "share list",
  "availability request (--contact <name>)... | --group <name>  --conversation <id> --from <iso> --to <iso> --duration <minutes> [--note <text>]",
  "availability respond --request <id> (--busy <json|@file> | --free <json|@file>) [--owner-approved [--hours HH:MM-HH:MM] [--timezone <IANA>]]",
  "availability decline --request <id>",
  "availability results --request <id> [--my-busy <json|@file> | --my-free <json|@file>]",
  "availability list",
  "backup export --file <path>                           (passphrase from MUSEBUDDIES_BACKUP_PASSPHRASE or stdin)",
  "backup import --file <path> [--force]"
];

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data.trim();
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function watch(app: MuseBuddies, wait: number): Promise<void> {
  let stopping = false;
  const stop = (): void => {
    stopping = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const emitted = new Set<string>();
  let backoff = 0;
  while (!stopping) {
    try {
      await app.poll({ wait });
      backoff = 0;
      for (const m of app.pending() as { messageId: string }[]) {
        if (emitted.has(m.messageId)) continue;
        emitted.add(m.messageId);
        process.stdout.write(JSON.stringify({ type: "message", ...m }) + "\n");
      }
    } catch (err) {
      backoff = Math.min(backoff ? backoff * 2 : 5, 60);
      process.stderr.write(`watch: ${err instanceof Error ? err.message : String(err)}; retrying in ${backoff}s\n`);
      await sleep(backoff * 1000);
    }
  }
}

export async function main(argv: string[]): Promise<void> {
  const [command, sub] = argv;
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const all = (name: string): string[] => argv.flatMap((a, i) => (a === name && argv[i + 1] !== undefined ? [argv[i + 1]] : []));
  const required = (name: string): string => {
    const v = flag(name);
    if (!v) throw new Error(`Missing required ${name} argument`);
    return v;
  };
  const number = (name: string, fallback: number): number => {
    const v = flag(name);
    if (v === undefined) return fallback;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number`);
    return n;
  };
  const print = (value: unknown): void => void process.stdout.write(JSON.stringify(value, null, 2) + "\n");
  const fail = (err: unknown): void => {
    process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  };

  if (!command || command === "--help" || command === "help") {
    print({ name: "musebuddies", version: "0.2.0", commands: USAGE });
    return;
  }
  if (command === "hook" && sub === "check") {
    try {
      print(hookCheck());
    } catch {
      fail(new Error("unable to read MuseBuddies state. Run setup first."));
    }
    return;
  }
  if (command === "backup" && sub === "import") {
    // Runs before any store is opened, since it replaces the database file.
    try {
      const pass = process.env.MUSEBUDDIES_BACKUP_PASSPHRASE ?? (await readStdin());
      print(MuseBuddies.backupImport(storeDir(), required("--file"), pass, argv.includes("--force")));
    } catch (err) {
      fail(err);
    }
    return;
  }

  const app = new MuseBuddies(new Store());
  try {
    const grouped = ["hook", "invite", "messages", "contacts", "group", "backup", "share", "availability"].includes(command);
    const slots = (name: string): TimeSlot[] | undefined => {
      const v = flag(name);
      if (v === undefined) return undefined;
      const text = v.startsWith("@") ? fs.readFileSync(v.slice(1), "utf8") : v;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error(`${name} must be a JSON array of {"start": ISO, "end": ISO}`);
      }
      if (!Array.isArray(parsed)) throw new Error(`${name} must be a JSON array`);
      return parsed.map((x: { start?: unknown; end?: unknown }) => {
        if (typeof x?.start !== "string" || typeof x?.end !== "string" || Number.isNaN(Date.parse(x.start)) || Number.isNaN(Date.parse(x.end))) {
          throw new Error(`${name}: every entry needs ISO "start" and "end"`);
        }
        return { start: x.start, end: x.end };
      });
    };
    switch (grouped ? `${command} ${sub ?? ""}` : command) {
      case "setup":
        print(await app.setup(flag("--relay")));
        break;
      case "status":
        print(app.status());
        break;
      case "hook prepare":
        print(app.hookPrepare());
        break;
      case "invite create":
        print(await app.inviteCreate(flag("--alias")));
        break;
      case "invite accept": {
        const url = flag("--url") ?? (await readStdin());
        if (!url) throw new Error("Provide the invitation link with --url or on stdin");
        print(await app.inviteAccept(required("--alias"), url));
        break;
      }
      case "invite list":
        print(await app.inviteList());
        break;
      case "invite cancel":
        print(await app.inviteCancel(required("--alias")));
        break;
      case "poll":
        print(await app.poll({ wait: number("--wait", 0) }));
        break;
      case "watch":
        await watch(app, number("--wait", 25) || 25);
        break;
      case "send": {
        const priority = argv.includes("--urgent") ? "urgent" : (flag("--priority") ?? "normal");
        if (priority !== "normal" && priority !== "urgent") throw new Error("--priority must be normal or urgent");
        let event: Partial<PlanEvent> | undefined;
        if (flag("--event-title") || flag("--event-start")) {
          event = {
            title: required("--event-title"),
            start: required("--event-start"),
            ...(flag("--event-end") ? { end: flag("--event-end") } : {}),
            ...(flag("--event-location") ? { location: flag("--event-location") } : {}),
            ...(flag("--event-notes") ? { notes: flag("--event-notes") } : {}),
            ...(flag("--event-status") ? { status: flag("--event-status") as PlanEvent["status"] } : {}),
            ...(flag("--event-uid") ? { uid: flag("--event-uid") } : {})
          };
        }
        const opts: SendOptions = {
          contacts: all("--contact"),
          group: flag("--group"),
          conversationId: required("--conversation"),
          body: flag("--body") ?? (await readStdin()),
          inReplyTo: flag("--reply-to") ?? null,
          priority: priority as Priority,
          updateKey: flag("--update-key"),
          event
        };
        print(await app.send(opts));
        break;
      }
      case "messages pending":
        print(app.pending());
        break;
      case "messages handled":
        if (!argv[2]) throw new Error("Usage: musebuddies messages handled <id>");
        print(await app.messageHandled(argv[2]));
        break;
      case "messages outbound":
        print(app.outbound({ contact: flag("--contact"), conversationId: flag("--conversation"), limit: number("--limit", 50) }));
        break;
      case "messages thread":
        print(app.thread(required("--conversation"), number("--limit", 100)));
        break;
      case "messages ics":
        if (!argv[2]) throw new Error("Usage: musebuddies messages ics <id>");
        process.stdout.write(app.ics(argv[2]));
        break;
      case "contacts list":
        print(app.contacts());
        break;
      case "group create":
        print(app.groupCreate(required("--name"), all("--contact")));
        break;
      case "group list":
        print(app.groupList());
        break;
      case "group delete":
        print(app.groupDelete(required("--name")));
        break;
      case "backup export": {
        const pass = process.env.MUSEBUDDIES_BACKUP_PASSPHRASE ?? (await readStdin());
        print(app.backupExport(required("--file"), pass));
        break;
      }
      case "share grant":
        print(
          await app.shareGrant(required("--contact"), {
            daysAhead: flag("--days-ahead") ? number("--days-ahead", 14) : undefined,
            hours: flag("--hours") ?? null,
            timezone: flag("--timezone"),
            maxPerDay: flag("--max-per-day") ? number("--max-per-day", 10) : undefined,
            expiresAt: flag("--expires") ?? null
          })
        );
        break;
      case "share revoke":
        print(await app.shareRevoke(required("--contact")));
        break;
      case "share list":
        print(app.shareList());
        break;
      case "availability request":
        print(
          await app.availabilityRequest({
            contacts: all("--contact"),
            group: flag("--group"),
            conversationId: required("--conversation"),
            from: required("--from"),
            to: required("--to"),
            durationMinutes: number("--duration", 0),
            note: flag("--note")
          })
        );
        break;
      case "availability respond":
        print(
          await app.availabilityRespond({
            requestId: required("--request"),
            busy: slots("--busy"),
            free: slots("--free"),
            ownerApproved: argv.includes("--owner-approved"),
            hours: flag("--hours"),
            timezone: flag("--timezone")
          })
        );
        break;
      case "availability decline":
        print(await app.availabilityDecline(required("--request")));
        break;
      case "availability results":
        print(app.availabilityResults(required("--request"), slots("--my-busy"), slots("--my-free")));
        break;
      case "availability list":
        print(app.availabilityList());
        break;
      case "disconnect":
        print(await app.disconnect(required("--contact")));
        break;
      default:
        throw new Error(`Unknown command. Usage:\n  musebuddies ${USAGE.join("\n  musebuddies ")}`);
    }
  } catch (err) {
    fail(err);
  } finally {
    app.store.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main(process.argv.slice(2));
}
