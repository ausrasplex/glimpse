import { test } from "node:test";
import assert from "node:assert/strict";
import { syncedLen, extendWindow, stampLines, stampDate, segmentLen, STAMP_DEFAULT, type MashSettings } from "../src/shared/mash";

const beat = 60 / 96; // 0.625s

test("beat sync keeps the start and lands the end on a beat", () => {
  const c = { len: 1.0, start: 2, end: 3, duration: 10 };
  const l = syncedLen(c, beat, "auto", 1, true);
  assert.ok(Math.abs(l / beat - Math.round(l / beat)) < 1e-9, "a whole number of beats");
  assert.ok(Math.abs(l - c.len) <= Math.min(0.5 * beat, 0.5) + 1e-9, "within the stretch limit");
});

test("stretch is limited to half a beat and 0.5s, and only with spare footage", () => {
  const tight = { len: 1.0, start: 0, end: 1.0, duration: 1.0 }; // no footage either side
  assert.ok(syncedLen(tight, beat, "auto", 1, true) <= 1.0 + 1e-9);
  const roomy = { len: 1.0, start: 3, end: 4, duration: 10 };
  assert.ok(syncedLen(roomy, beat, "auto", 1, false) <= 1.0 + 1e-9, "no stretch when the toggle is off");
});

test("photos always fit the beat exactly", () => {
  const p = { len: 2, start: 0, end: 2, duration: 10, photo: true };
  assert.equal(syncedLen(p, beat, "fixed", 3, true), 3 * beat);
  assert.equal(syncedLen(p, beat, "auto", 1, true), 3 * beat);
});

test("extra footage comes from after the end first, then before the start", () => {
  assert.deepEqual(extendWindow(2, 1, 1.4, 10), { start: 2, len: 1.4 });
  const w = extendWindow(2, 1, 1.4, 3.2); // only 0.2s after
  assert.equal(+w.start.toFixed(3), 1.8);
  assert.equal(+w.len.toFixed(3), 1.4);
  assert.deepEqual(extendWindow(2, 1, 0.5, 10), { start: 2, len: 0.5 });
});

test("date stamp text", () => {
  assert.equal(stampDate("2026-10-20", "short"), "Tue 20 Oct");
  assert.equal(stampDate("2026-10-20", "long"), "20 October 2026");
  assert.equal(stampDate("2026-10-20", "num"), "20/10/26");
  assert.deepEqual(stampLines({ ...STAMP_DEFAULT, show: "day" }, "2026-10-20", "", 4), ["Day 5", "Tue 20 Oct"]);
  assert.deepEqual(stampLines({ ...STAMP_DEFAULT, show: "dateNote" }, "2026-10-20", "Hi", 0), ["Tue 20 Oct", "Hi"]);
  assert.deepEqual(stampLines(STAMP_DEFAULT, "2026-10-20", "Hi", 0), ["Tue 20 Oct", null]);
});

test("clip length rules", () => {
  const base = { shape: "portrait", fill: "blur", clipMode: "cap", cap: 1, stamp: STAMP_DEFAULT, tracks: [], crossfade: 2, whenEnds: "loop", audio: "both", level: 40, sync: "off", beats: 1, stretch: true, musicLabel: true } as MashSettings;
  assert.equal(segmentLen({ len: 2.5, start: 0, end: 2.5, duration: 5 }, base, null), 1);
  assert.equal(segmentLen({ len: 2.5, start: 0, end: 2.5, duration: 5 }, { ...base, clipMode: "trimmed" }, null), 2.5);
});

test("quality presets: video CRF and audio bitrate, with a safe fallback", async () => {
  const { QUALITY, qualityOf } = await import("../src/shared/mash");
  assert.deepEqual([QUALITY.smaller.crf, QUALITY.high.crf, QUALITY.best.crf], [23, 20, 18]);
  assert.deepEqual([QUALITY.smaller.audioKbps, QUALITY.high.audioKbps, QUALITY.best.audioKbps], [192, 256, 320]);
  assert.equal(qualityOf(undefined), "high"); // mashes made before presets existed
  assert.equal(qualityOf("best"), "best");
  assert.equal(qualityOf("ultra"), "high");
});
