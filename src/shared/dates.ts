// Day keys are "YYYY-MM-DD" strings in a person's own timezone.
export const pad = (n: number) => (n < 10 ? "0" : "") + n;

export function dayKeyInTz(d: Date, tz: string): string {
  try {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
    const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
    return `${g("year")}-${g("month")}-${g("day")}`;
  } catch { return d.toISOString().slice(0, 10); }
}
export function timeInTz(d: Date, tz: string): { hhmm: string; weekday: number } {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" });
  const p = f.formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(g("weekday"));
  return { hhmm: `${g("hour")}:${g("minute")}`, weekday: wd };
}
export function addDays(k: string, n: number): string {
  const [y, m, d] = k.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
export const isDayKey = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

// Count consecutive days ending today (or yesterday, if today is still empty).
export function streakFrom(days: Set<string>, today: string): number {
  let k = days.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (days.has(k)) { n++; k = addDays(k, -1); }
  return n;
}

/**
 * The day something was filmed, from a video's creation time or a photo's EXIF date.
 * A time written with its offset (iPhone videos, EXIF with OffsetTimeOriginal) or with no zone at all (plain EXIF)
 * is local to where it was filmed, so its date is kept as written. A UTC time ("…Z") becomes the owner's local day.
 * Null when unreadable, before 2000, or more than a day in the future (a wrong camera clock).
 */
export function takenDayFrom(value: string | null | undefined, tz: string, now = new Date()): { day: string; at: Date } | null {
  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec((value || "").trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s = "00", zone] = m;
  const local = `${y}-${mo}-${d}`, time = `${h}:${mi}:${s}`;
  let at: Date, day: string;
  if (zone && zone.toUpperCase() === "Z") { at = new Date(`${local}T${time}Z`); day = dayKeyInTz(at, tz); }
  else if (zone) { at = new Date(`${local}T${time}${zone.replace(/^([+-]\d{2}):?(\d{2})$/, "$1:$2")}`); day = local; }
  else { at = new Date(`${local}T${time}Z`); day = local; }
  if (isNaN(at.getTime()) || Number(y) < 2000 || at.getTime() > now.getTime() + 86400e3) return null;
  return { day, at };
}
