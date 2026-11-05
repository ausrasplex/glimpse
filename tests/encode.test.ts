import { test } from "node:test";
import assert from "node:assert/strict";
import { h264, withGpu } from "../src/worker/encode";

test("the CPU encoder is x264 with no GPU options", () => {
  const e = h264(null, 24, 30);
  assert.deepEqual(e.before, []);
  assert.equal(e.filter, "");
  assert.ok(e.video.includes("libx264"));
  assert.equal(e.video[e.video.indexOf("-crf") + 1], "24");
});

test("the GPU encoder opens the device, uploads frames last, and never sets a CPU pixel format", () => {
  const e = h264("/dev/dri/renderD128", 24, 30);
  assert.deepEqual(e.before, ["-vaapi_device", "/dev/dri/renderD128"]);
  assert.ok(e.filter.endsWith("format=nv12,hwupload"));
  assert.ok(e.video.includes("h264_vaapi"));
  assert.equal(e.video[e.video.indexOf("-qp") + 1], "24");
  assert.ok(!e.video.includes("-pix_fmt"));
});

test("a GPU job that fails runs again on the CPU", async () => {
  const tried: (string | null)[] = [];
  const warnings: string[] = [];
  const r = await withGpu("/dev/dri/renderD128", async (d) => { tried.push(d); if (d) throw new Error("no encoder"); return "done"; }, (m) => warnings.push(m));
  assert.equal(r, "done");
  assert.deepEqual(tried, ["/dev/dri/renderD128", null]);
  assert.equal(warnings.length, 1);
});

test("with no GPU the job just runs once on the CPU", async () => {
  const tried: (string | null)[] = [];
  await withGpu(null, async (d) => { tried.push(d); });
  assert.deepEqual(tried, [null]);
});

test("a job that fails on the CPU too still fails", async () => {
  await assert.rejects(withGpu("/dev/dri/renderD128", async () => { throw new Error("bad file"); }, () => {}), /bad file/);
});
