import { handle, json, requireUser, checkOrigin, body, str } from "@/server/http";
import { startUpload } from "@/server/resumable";
export const dynamic = "force-dynamic";

// Begin a resumable upload: creates the media item and returns an upload id for the pieces.
export const POST = handle(async (req: Request) => {
  checkOrigin(req);
  const { user } = await requireUser();
  const b = await body(req);
  return json(await startUpload(user.id, str(b.name, 200) || "upload", str(b.type, 100), typeof b.size === "number" ? b.size : 0));
});
