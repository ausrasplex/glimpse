import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, streakFrom, dayKeyInTz, timeInTz, takenDayFrom } from "../src/shared/dates";

test("addDays crosses months and years", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
});
test("streak counts back from today, or yesterday if today is empty", () => {
  const days = new Set(["2026-10-18", "2026-10-19", "2026-10-20"]);
  assert.equal(streakFrom(days, "2026-10-20"), 3);
  assert.equal(streakFrom(days, "2026-10-21"), 3);
  assert.equal(streakFrom(days, "2026-10-22"), 0);
});
test("day keys follow each person's timezone", () => {
  const d = new Date("2026-10-20T14:30:00Z");
  assert.equal(dayKeyInTz(d, "Australia/Melbourne"), "2026-10-21");
  assert.equal(dayKeyInTz(d, "America/New_York"), "2026-10-20");
  assert.deepEqual(timeInTz(d, "Australia/Melbourne"), { hhmm: "01:30", weekday: 3 });
});

test("filmed day keeps a local time's own date, and moves a UTC time into the owner's timezone", () => {
  const now = new Date("2026-10-24T00:00:00Z");
  assert.equal(takenDayFrom("2026-10-20T18:31:05+1100", "Europe/London", now)?.day, "2026-10-20");
  assert.equal(takenDayFrom("2026-10-20T23:50:00-0700", "Australia/Melbourne", now)?.day, "2026-10-20");
  assert.equal(takenDayFrom("2026-10-20T14:30:00.000000Z", "Australia/Melbourne", now)?.day, "2026-10-21");
  assert.equal(takenDayFrom("2026-10-20T14:30:00Z", "America/New_York", now)?.day, "2026-10-20");
  assert.equal(takenDayFrom("2026:10:19 07:15:00", "UTC", now)?.day, "2026-10-19");
  assert.equal(takenDayFrom("2026:10:19 07:15:00+10:00", "UTC", now)?.day, "2026-10-19");
});
test("filmed day ignores missing, ancient and future dates", () => {
  const now = new Date("2026-10-24T00:00:00Z");
  assert.equal(takenDayFrom(null, "UTC", now), null);
  assert.equal(takenDayFrom("not a date", "UTC", now), null);
  assert.equal(takenDayFrom("1970-01-01T00:00:00Z", "UTC", now), null);
  assert.equal(takenDayFrom("2026-11-30T10:00:00Z", "UTC", now), null);
  assert.ok(takenDayFrom("2026-10-24T20:00:00Z", "UTC", now));
});
