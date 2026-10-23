import { test } from "node:test";
import assert from "node:assert/strict";
import { missedDays, rangeFor } from "../src/client/sel.js";
import { todayKey, addDays, parseKey } from "../src/client/util.js";

const t = todayKey();
const db = (createdDay: string, dates: string[]) => ({
  projects: [{ id: "p1", createdAt: parseKey(createdDay).getTime() }],
  entries: dates.map((date, i) => ({ id: "e" + i, projectId: "p1", date }))
});

test("past week covers today and the six days before it", () => {
  assert.deepEqual(rangeFor("week"), { from: addDays(t, -6), to: t });
});
test("days before the first clip count as missed once the project exists", () => {
  const r = rangeFor("week");
  const d = db(addDays(t, -30), [addDays(t, -2), addDays(t, -1)]);
  assert.deepEqual(missedDays(d, "p1", r.from, r.to), [-6, -5, -4, -3].map((n) => addDays(t, n)));
});
test("days before the project was created are not missed", () => {
  const d = db(addDays(t, -3), [addDays(t, -1)]);
  assert.deepEqual(missedDays(d, "p1", addDays(t, -10), t), [addDays(t, -3), addDays(t, -2)]);
});
test("a clip filed before the project was created moves its start earlier", () => {
  const d = db(addDays(t, -1), [addDays(t, -4)]);
  assert.deepEqual(missedDays(d, "p1", addDays(t, -10), t), [addDays(t, -3), addDays(t, -2), addDays(t, -1)]);
});
test("today is never missed", () => {
  const d = db(addDays(t, -2), []);
  assert.deepEqual(missedDays(d, "p1", addDays(t, -2), t), [addDays(t, -2), addDays(t, -1)]);
});
