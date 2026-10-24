import { test } from "node:test";
import assert from "node:assert/strict";
import { endingFade } from "../src/worker/render";

test("the mash ends with the fade-out of the track playing at the end", () => {
  const a = { start: 0, duration: 60, fadeOut: 4 }, b = { start: 10, duration: 70, fadeOut: 6 };
  assert.equal(endingFade([a], 2, 18), 4);
  assert.equal(endingFade([a, b], 2, 30), 4);   // still in the first track
  assert.equal(endingFade([a, b], 2, 59), 6);   // the second track starts at 58 (60 minus the 2s crossfade)
  assert.equal(endingFade([{ ...a, fadeOut: 0 }], 2, 18), 0); // "None": a clean cut
  assert.equal(endingFade([], 2, 10), 0);
});
