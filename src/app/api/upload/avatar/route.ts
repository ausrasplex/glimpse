import { eq } from "drizzle-orm";
import { handle, json, requireUser, checkOrigin } from "@/server/http";
import { db, schema } from "@/server/db";
import { keys, putStream, deleteKeys } from "@/server/storage";
import { token } from "@/server/ids";
import { fail } from "@/server/core";
export const dynamic = "force-dynamic";

// The app crops and resizes the photo to a small square JPEG before sending it.
export const POST = handle(async (req: Request) => {
  checkOrigin(req);
  const { user } = await requireUser();
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length > 2 * 1024 * 1024) fail(413, "That photo is too big.");
  if (!(buf[0] === 0xff && buf[1] === 0xd8)) fail(415, "Send a JPEG image.");
  const key = keys.avatar(user.id, token(6));
  await putStream(key, buf, "image/jpeg");
  if (user.avatarKey) await deleteKeys([user.avatarKey]).catch(() => undefined);
  await db.update(schema.users).set({ avatarKey: key }).where(eq(schema.users.id, user.id));
  return json({ ok: true });
});
