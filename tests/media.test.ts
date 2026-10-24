import { test } from "node:test";
import assert from "node:assert/strict";
import { kindOfFile, sniffKind, ACCEPT, embeddedVideoAt } from "../src/shared/media";

const bytes = (...parts: (string | number[])[]) => {
  const out: number[] = [];
  for (const p of parts) typeof p === "string" ? out.push(...Array.from(p, (c) => c.charCodeAt(0))) : out.push(...p);
  while (out.length < 200) out.push(0);
  return Uint8Array.from(out);
};

test("files are sorted by type, then by extension when the type is missing", () => {
  assert.deepEqual(kindOfFile("a.mp4", "video/mp4"), { kind: "video", type: "video/mp4" });
  assert.deepEqual(kindOfFile("IMG_1.MOV", ""), { kind: "video", type: "video/quicktime" });
  assert.deepEqual(kindOfFile("IMG_2.HEIC", "application/octet-stream"), { kind: "photo", type: "image/heic" });
  assert.deepEqual(kindOfFile("p.jpg", "image/jpeg"), { kind: "photo", type: "image/jpeg" });
  assert.deepEqual(kindOfFile("clip.mp4", "application/mp4"), { kind: "video", type: "video/mp4" });
  assert.equal(kindOfFile("doc.pdf", "application/pdf"), null);
  assert.equal(kindOfFile("doc.pdf", ""), null);
  assert.equal(kindOfFile("logo.svg", "image/svg+xml"), null);
  assert.equal(kindOfFile("fake.mp4", "application/pdf"), null);
});
test("the picker accepts media types and the extensions phones mislabel", () => {
  for (const e of [".mov", ".mts", ".heic", ".webp"]) assert.ok(ACCEPT.split(",").includes(e));
  assert.ok(ACCEPT.startsWith("video/*,image/*"));
  // A non image/video type keeps Android on the file manager rather than the photo picker.
  assert.ok(ACCEPT.split(",").some((t) => t.includes("/") && !/^(image|video)\//.test(t)));
});
test("first bytes reveal what a file really is", () => {
  assert.equal(sniffKind(bytes([0, 0, 0, 0x20], "ftypisom")), "video");
  assert.equal(sniffKind(bytes([0, 0, 0, 0x14], "ftypqt  ")), "video");
  assert.equal(sniffKind(bytes([0, 0, 0, 0x18], "ftypheic")), "photo");
  assert.equal(sniffKind(bytes([0, 0, 0, 8], "wide")), "video");
  assert.equal(sniffKind(bytes([0x1a, 0x45, 0xdf, 0xa3])), "video");
  assert.equal(sniffKind(bytes("RIFF", [0, 0, 0, 0], "AVI LIST")), "video");
  assert.equal(sniffKind(bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 ")), "photo");
  assert.equal(sniffKind(bytes([0xff, 0xd8, 0xff, 0xe0])), "photo");
  assert.equal(sniffKind(bytes([0x89], "PNG")), "photo");
  const ts = new Uint8Array(400); ts[0] = 0x47; ts[188] = 0x47;
  assert.equal(sniffKind(ts), "video");
  assert.equal(sniffKind(bytes("%PDF-1.7")), null);
  assert.equal(sniffKind(bytes("PK", [3, 4])), null);
  assert.equal(sniffKind(new Uint8Array(4)), null);
});
test("the video inside a motion photo is found after the picture", () => {
  const photo = bytes([0xff, 0xd8, 0xff, 0xe1], "Exif");
  const mp4 = bytes([0, 0, 0, 0x1c], "ftypmp42", [0, 0, 0, 0], "isommp42");
  const both = new Uint8Array(photo.length + mp4.length); both.set(photo); both.set(mp4, photo.length);
  assert.equal(embeddedVideoAt(both), photo.length);
  assert.equal(embeddedVideoAt(photo), null);
  // A HEIC's own ftyp at the start isn't a video, nor is a photo brand later on.
  assert.equal(embeddedVideoAt(bytes([0, 0, 0, 0x18], "ftypheic", [0, 0, 0, 0], "mif1heic")), null);
  const heicMotion = new Uint8Array(400); heicMotion.set(bytes([0, 0, 0, 0x18], "ftypheic").subarray(0, 12)); heicMotion.set(mp4.subarray(0, 28), 300);
  assert.equal(embeddedVideoAt(heicMotion), 300);
});
