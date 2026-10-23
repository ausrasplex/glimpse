import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

const dir = await mkdtemp(join(tmpdir(), "glimpse-store-"));
process.env.STORAGE = "local";
process.env.MEDIA_DIR = dir;
const st = await import("../src/server/storage");

const text = async (r: Readable) => { let s = ""; for await (const c of r) s += c; return s; };

test("parseRange handles the forms browsers send", () => {
  assert.equal(st.parseRange(undefined, 100), null);
  assert.deepEqual(st.parseRange("bytes=0-", 100), { start: 0, end: 99 });
  assert.deepEqual(st.parseRange("bytes=10-19", 100), { start: 10, end: 19 });
  assert.deepEqual(st.parseRange("bytes=90-500", 100), { start: 90, end: 99 });
  assert.deepEqual(st.parseRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.equal(st.parseRange("bytes=0-1,5-6", 100), null); // multi-range: whole file
  assert.throws(() => st.parseRange("bytes=100-", 100), (e: unknown) => e instanceof st.StorageError && e.status === 416);
  assert.throws(() => st.parseRange("bytes=20-10", 100), (e: unknown) => e instanceof st.StorageError && e.status === 416);
});

test("local storage writes, reads ranges, and deletes", async () => {
  await st.ensureStorage();
  const key = st.keys.mediaPlayback("u_1", "m_1");
  await st.putStream(key, Readable.from(["0123456789", "abcdefghij"]));
  const all = await st.getObject(key);
  assert.equal(all.contentLength, 20);
  assert.equal(all.contentType, "video/mp4");
  assert.equal(await text(all.body), "0123456789abcdefghij");
  const part = await st.getObject(key, "bytes=5-12");
  assert.equal(part.contentRange, "bytes 5-12/20");
  assert.equal(part.contentLength, 8);
  assert.equal(await text(part.body), "56789abc");
  // No half-written temp files left behind
  assert.deepEqual((await readdir(join(dir, "media/u_1/m_1"))).sort(), ["playback.mp4"]);
  await st.putStream(st.keys.mediaPoster("u_1", "m_1"), Buffer.from("jpg"));
  await st.deletePrefix(st.keys.mediaPrefix("u_1", "m_1"));
  await assert.rejects(st.getObject(key), (e: unknown) => e instanceof st.StorageError && e.status === 404);
  // Empty folders are tidied up, the media root stays
  assert.deepEqual(await readdir(dir), []);
});

test("deleteKeys removes single files and tidies empty folders", async () => {
  await st.putStream(st.keys.mash("ms_1"), Buffer.from("x"));
  await st.putStream(st.keys.mashPoster("ms_1"), Buffer.from("y"));
  await st.deleteKeys([st.keys.mash("ms_1"), null, undefined]);
  assert.equal(await readFile(join(dir, "mashes/ms_1/poster.jpg"), "utf8"), "y");
  await st.deleteKeys([st.keys.mashPoster("ms_1"), "mashes/missing/never.mp4"]);
  assert.deepEqual(await readdir(dir), []);
});

test("keys can't escape the media folder", async () => {
  for (const bad of ["../outside.txt", "media/../../etc/passwd", "/etc/passwd", "a\0b"]) {
    await assert.rejects(st.getObject(bad), (e: unknown) => e instanceof st.StorageError && e.status === 404, bad);
    await assert.rejects(st.putStream(bad, Buffer.from("x")), Error, bad);
  }
});

test("a failed upload leaves nothing behind", async () => {
  const boom = new Readable({ read() { this.push("partial"); this.destroy(new Error("client went away")); } });
  await assert.rejects(st.putStream("media/u_2/m_2/original.mov", boom));
  assert.deepEqual(await readdir(join(dir, "media/u_2/m_2")).catch(() => []), []);
  await rm(dir, { recursive: true, force: true });
});
