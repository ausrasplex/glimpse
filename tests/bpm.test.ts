import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateBpm } from "../src/shared/bpm";

function clicks(bpm: number, seconds: number, rate = 11025) {
  const pcm = new Int16Array(seconds * rate);
  const every = Math.round(rate * 60 / bpm);
  for (let i = 0; i < pcm.length; i += every) for (let k = 0; k < 400 && i + k < pcm.length; k++) pcm[i + k] = Math.round(20000 * Math.sin(k / 3) * Math.exp(-k / 120));
  return pcm;
}
test("finds the tempo of a click track", () => {
  for (const bpm of [84, 96, 120, 140]) {
    const got = estimateBpm(clicks(bpm, 30), 11025)!;
    const ok = [bpm, bpm * 2, bpm / 2].some((b) => Math.abs(got - b) <= 2);
    assert.ok(ok, `expected ~${bpm}, got ${got}`);
  }
});
test("too short to tell", () => { assert.equal(estimateBpm(new Int16Array(1000), 11025), null); });
