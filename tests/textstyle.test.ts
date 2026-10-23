import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanStamp, cleanLabel, layoutBox, placeBoxes, withPreset, matched, labelText, STAMP_DEFAULT, LABEL_DEFAULT } from "../src/shared/textstyle";

const measure = (t: string, px: number) => t.length * px * 0.5;

test("older stamps keep their look, and bad values fall back to defaults", () => {
  const old = cleanStamp({ on: true, show: "date", format: "long", pos: "bl", style: "plain", size: "l" });
  assert.equal(old.font, "Inter"); assert.equal(old.bgOpacity, 0); assert.equal(old.size, "l"); assert.equal(old.pos, "bl");
  const bad = cleanStamp({ font: "<script>", color: "red", bgOpacity: 7, radius: "huge" });
  assert.equal(bad.font, STAMP_DEFAULT.font); assert.equal(bad.color, "#FFFFFF"); assert.equal(bad.bgOpacity, 1); assert.equal(bad.radius, STAMP_DEFAULT.radius);
  assert.deepEqual(cleanLabel(undefined), LABEL_DEFAULT);
});
test("presets set the box, matching copies the stamp's look but not its position", () => {
  assert.equal(withPreset(STAMP_DEFAULT, "plain").bgOpacity, 0);
  assert.equal(withPreset({ ...STAMP_DEFAULT, bgOpacity: 0 }, "pill").bgOpacity, 0.45);
  const m = matched({ ...LABEL_DEFAULT, pos: "tl" }, { ...STAMP_DEFAULT, font: "Caveat", color: "#FFE9B0" });
  assert.equal(m.font, "Caveat"); assert.equal(m.color, "#FFE9B0"); assert.equal(m.pos, "tl");
  assert.equal(labelText({ ...LABEL_DEFAULT, show: "titleArtist" }, "Song", "Band"), "Song – Band");
  assert.equal(labelText({ ...LABEL_DEFAULT, show: "note" }, "Song"), "♪ Song");
});
test("boxes fit their text, and two in one corner stack without overlapping", () => {
  const a = layoutBox({ ...STAMP_DEFAULT, pos: "bl" }, ["Tue 20 Oct", "A note"], 1080, measure);
  const b = layoutBox({ ...LABEL_DEFAULT, pos: "bl" }, ["Song"], 1080, measure);
  assert.ok(a.w > measure("Tue 20 Oct", a.lines[0].size)); assert.equal(a.lines.length, 2);
  const [pa, pb] = placeBoxes([a, b], 1080, 1920);
  assert.equal(pa.x, 54); assert.equal(pa.y + pa.h, 1920 - 54);
  assert.ok(pb.y + pb.h <= pa.y, "the song title sits above the date stamp");
  const r = layoutBox({ ...STAMP_DEFAULT, pos: "tr" }, ["Tue 20 Oct"], 1080, measure);
  assert.equal(placeBoxes([r], 1080, 1920)[0].x + r.w, 1080 - 54);
});
