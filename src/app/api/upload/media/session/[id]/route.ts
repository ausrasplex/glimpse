import { handle, json, requireUser, checkOrigin } from "@/server/http";
import { uploadStatus, addPiece } from "@/server/resumable";
import { fail } from "@/server/core";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

// How much of the file the server has, so a client can continue from there.
export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const { user } = await requireUser();
  return json(await uploadStatus(user.id, (await ctx.params).id));
});

// One piece of the file. X-Offset says where it starts; the reply says how much the server now has.
export const PUT = handle(async (req: Request, ctx: Ctx) => {
  checkOrigin(req);
  const { user } = await requireUser();
  const offset = Number(req.headers.get("x-offset"));
  if (!Number.isInteger(offset) || offset < 0) fail(400, "Missing upload offset.");
  const piece = Buffer.from(await req.arrayBuffer());
  return json(await addPiece(user.id, (await ctx.params).id, offset, piece));
});
