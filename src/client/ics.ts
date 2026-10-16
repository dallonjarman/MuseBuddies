// Renders a PlanEvent as an iCalendar (RFC 5545) document that calendar apps can import.
import type { PlanEvent } from "../shared/protocol.ts";

const stamp = (iso: string): string => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

const escape = (text: string): string =>
  text.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Folds lines longer than 75 octets, as RFC 5545 requires. */
function fold(line: string): string {
  const out: string[] = [];
  let current = "";
  for (const ch of line) {
    if (Buffer.byteLength(current + ch, "utf8") > (out.length === 0 ? 75 : 74)) {
      out.push(current);
      current = "";
    }
    current += ch;
  }
  out.push(current);
  return out.join("\r\n ");
}

export function toIcs(event: PlanEvent, sentAt: string): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//MuseTogether//EN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escape(event.uid)}@musetogether`,
    `DTSTAMP:${stamp(sentAt)}`,
    // Later updates to the same uid carry a higher sequence, so calendars replace the entry.
    `SEQUENCE:${Math.floor(Date.parse(sentAt) / 1000)}`,
    `DTSTART:${stamp(event.start)}`,
    event.end ? `DTEND:${stamp(event.end)}` : "DURATION:PT1H",
    `SUMMARY:${escape(event.title)}`,
    ...(event.location ? [`LOCATION:${escape(event.location)}`] : []),
    ...(event.notes ? [`DESCRIPTION:${escape(event.notes)}`] : []),
    `STATUS:${event.status.toUpperCase()}`,
    "END:VEVENT",
    "END:VCALENDAR"
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
