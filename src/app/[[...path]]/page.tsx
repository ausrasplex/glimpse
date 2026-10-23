import ClientApp from "@/client/main.jsx";
import { currentSession } from "@/server/session";
import { buildBootstrap, publicBootstrap } from "@/server/bootstrap";

export const dynamic = "force-dynamic";

// Every screen is served by the same page; the app picks the screen from the URL.
export default async function Page() {
  const s = await currentSession();
  const initial = s ? await buildBootstrap(s.user) : await publicBootstrap();
  return <ClientApp initial={JSON.parse(JSON.stringify(initial))} />;
}
