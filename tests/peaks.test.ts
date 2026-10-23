import { test } from "node:test";
import assert from "node:assert/strict";
import { peaksFrom, barsFrom } from "../src/shared/peaks";

test("peaks follow the loudness of the audio", () => {
  // Quiet first half, loud second half.
  const s = new Int16Array(1000).map((_, i) => (i < 500 ? 1000 : -20000) * (i % 2 ? 1 : -1));
  const p = peaksFrom(s, 10);
  assert.equal(p.length, 10);
  assert.ok(p.slice(0, 5).every((v) => v === 0.05));
  assert.ok(p.slice(5).every((v) => v === 1));
});
test("silence and empty audio give flat or no bars", () => {
  assert.deepEqual(peaksFrom(new Int16Array(100), 4), [0, 0, 0, 0]);
  assert.deepEqual(peaksFrom([], 4), []);
});
test("bars resample stored peaks to any count", () => {
  const p = [0.1, 0.5, 1, 0.2];
  assert.deepEqual(barsFrom(p, 2), [0.5, 1]);
  assert.equal(barsFrom(p, 8).length, 8);
  assert.deepEqual(barsFrom(null, 4), []);
});
