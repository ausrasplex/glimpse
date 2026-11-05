import { handle, json, requireUser } from "@/server/http";
import { pulseOf } from "@/server/bootstrap";
export const dynamic = "force-dynamic";

// Asked every few seconds by open apps. When the answer differs from the data they loaded, they reload, so invites
// and new clips show up without reopening the app.
export const GET = handle(async () => {
  const { user } = await requireUser();
  return json({ pulse: await pulseOf(user.id) });
});
