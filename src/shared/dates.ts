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
