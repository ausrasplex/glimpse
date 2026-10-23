import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, streakFrom, dayKeyInTz, timeInTz } from "../src/shared/dates";

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
