// Free/busy arithmetic for availability sharing. Everything here works on UTC instants;
// time zones only matter for the "allowed hours" rule (e.g. 08:00-22:00 local time).
import type { TimeSlot } from "../shared/protocol.ts";

const MINUTE = 60_000;
const GRANULARITY = 15 * MINUTE;

type Range = [number, number];

export function systemTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function checkTimezone(tz: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    throw new Error(`Unknown time zone '${tz}' (use an IANA name like America/Denver)`);
  }
}

export function parseHours(hours: string): { start: number; end: number } {
  const m = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(hours);
  if (!m) throw new Error("Hours must look like 08:00-22:00");
  const start = Number(m[1]) * 60 + Number(m[2]);
  const end = Number(m[3]) * 60 + Number(m[4]);
  if (start >= end || end > 24 * 60) throw new Error("Hours must start before they end, within one day");
  return { start, end };
}

function localParts(tz: string, ms: number): { y: number; m: number; d: number; h: number; mi: number; s: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit"
  }).formatToParts(new Date(ms));
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), mi: get("minute"), s: get("second") };
}

function offsetMs(tz: string, ms: number): number {
  const p = localParts(tz, ms);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

/** UTC instant for a wall-clock time in `tz` (handles DST by re-checking the offset). */
export function zonedToUtc(y: number, m: number, d: number, minutes: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, 0, minutes);
  const first = guess - offsetMs(tz, guess);
  const second = guess - offsetMs(tz, first);
  return second;
}

function normalize(ranges: Range[]): Range[] {
  const sorted = ranges.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

function subtract(base: Range[], remove: Range[]): Range[] {
  let result = normalize(base);
  for (const [rs, re] of normalize(remove)) {
    result = result.flatMap(([s, e]): Range[] => {
      if (re <= s || rs >= e) return [[s, e]];
      const pieces: Range[] = [];
      if (rs > s) pieces.push([s, rs]);
      if (re < e) pieces.push([re, e]);
      return pieces;
    });
  }
  return result;
}

function intersectRanges(a: Range[], b: Range[]): Range[] {
  const out: Range[] = [];
  const x = normalize(a);
  const y = normalize(b);
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    const s = Math.max(x[i][0], y[j][0]);
    const e = Math.min(x[i][1], y[j][1]);
    if (e > s) out.push([s, e]);
    if (x[i][1] < y[j][1]) i++;
    else j++;
  }
  return out;
}

/** The allowed daily hours in `tz`, as UTC ranges covering [from, to]. */
function allowedHours(from: number, to: number, hours: string, tz: string): Range[] {
  const { start, end } = parseHours(hours);
  const first = localParts(tz, from);
  const out: Range[] = [];
  // Walk local calendar days, starting a day early to cover offsets.
  for (let day = Date.UTC(first.y, first.m - 1, first.d - 1); ; day += 86_400_000) {
    const d = new Date(day);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const dd = d.getUTCDate();
    const s = zonedToUtc(y, m, dd, start, tz);
    if (s > to) break;
    out.push([s, zonedToUtc(y, m, dd, end, tz)]);
  }
  return out;
}

const toRanges = (slots: TimeSlot[]): Range[] => slots.map((s) => [Date.parse(s.start), Date.parse(s.end)]);
const toSlots = (ranges: Range[]): TimeSlot[] =>
  ranges.map(([s, e]) => ({ start: new Date(s).toISOString(), end: new Date(e).toISOString() }));

/** Rounds each range inward to 15-minute boundaries and keeps only those long enough. */
function finish(ranges: Range[], durationMinutes: number): Range[] {
  return normalize(ranges)
    .map(([s, e]): Range => [Math.ceil(s / GRANULARITY) * GRANULARITY, Math.floor(e / GRANULARITY) * GRANULARITY])
    .filter(([s, e]) => e - s >= durationMinutes * MINUTE);
}

export interface FreeOptions {
  from: string;
  to: string;
  durationMinutes: number;
  /** Calendar busy blocks (preferred) ... */
  busy?: TimeSlot[];
  /** ... or free blocks, if that's what the calendar tool returns. */
  free?: TimeSlot[];
  hours?: string | null;
  timezone?: string;
  maxSlots?: number;
}

/** Free slots in the window, long enough for the meeting, inside allowed hours. */
export function computeFree(o: FreeOptions): TimeSlot[] {
  const from = Date.parse(o.from);
  const to = Date.parse(o.to);
  let ranges: Range[] = o.free ? intersectRanges(toRanges(o.free), [[from, to]]) : subtract([[from, to]], toRanges(o.busy ?? []));
  if (o.hours) ranges = intersectRanges(ranges, allowedHours(from, to, o.hours, checkTimezone(o.timezone ?? "UTC")));
  return toSlots(finish(ranges, o.durationMinutes).slice(0, o.maxSlots ?? 100));
}

/** Times when everyone is free, at least `durationMinutes` long. */
export function commonFree(lists: TimeSlot[][], durationMinutes: number): TimeSlot[] {
  if (lists.length === 0) return [];
  const [first, ...rest] = lists;
  const shared = rest.reduce<Range[]>((acc, l) => intersectRanges(acc, toRanges(l)), toRanges(first));
  return toSlots(finish(shared, durationMinutes));
}

export function describeSlots(slots: TimeSlot[], tz: string, limit = 8): string {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  const lines = slots.slice(0, limit).map((s) => `${fmt.format(new Date(s.start))}–${time.format(new Date(s.end))}`);
  if (slots.length > limit) lines.push(`…and ${slots.length - limit} more`);
  return lines.join("; ");
}
