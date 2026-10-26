import { and, eq } from "drizzle-orm";
import { schema } from "../db";
import { fail, notify, freestyleCategory } from "../core";
import { str, bool } from "../http";
import type { Action } from "./types";

export const notifRead: Action = async ({ db, user }, a) => {
  await db.update(schema.notifications).set({ read: true, readAt: new Date() }).where(and(eq(schema.notifications.id, str(a.id, 60)), eq(schema.notifications.userId, user.id), eq(schema.notifications.read, false)));
};
export const notifReadAll: Action = async ({ db, user }) => {
  // Only the unread ones, so each keeps the time it was first read (read ones are cleared a day after).
  await db.update(schema.notifications).set({ read: true, readAt: new Date() }).where(and(eq(schema.notifications.userId, user.id), eq(schema.notifications.read, false)));
};

// Someone already on the server was added to a project: they accept or decline here.
export const answerProjectInvite: Action = async ({ db, user }, a) => {
  const projectId = str(a.projectId, 60), accept = bool(a.accept);
  await db.transaction(async (tx) => {
    const m = await tx.query.members.findFirst({ where: and(eq(schema.members.projectId, projectId), eq(schema.members.userId, user.id), eq(schema.members.status, "INVITED")) });
    if (!m) fail(404, "That invite isn't open any more.");
    if (accept) {
      await tx.update(schema.members).set({ status: "ACTIVE", email: null, categoryId: await freestyleCategory(tx, user.id), pinned: false, archived: false, joinedAt: new Date(), lastViewedAt: new Date() }).where(eq(schema.members.id, m!.id));
      const p = await tx.query.projects.findFirst({ where: eq(schema.projects.id, projectId) });
      const others = await tx.select({ userId: schema.members.userId }).from(schema.members).where(and(eq(schema.members.projectId, projectId), eq(schema.members.status, "ACTIVE")));
      for (const o of others) if (o.userId && o.userId !== user.id) await notify(tx, o.userId, { type: "MEMBER_JOINED", title: `${user.name.split(" ")[0]} joined ${p?.name ?? "your project"}`, body: "Say hello with a clip", link: { route: "project", params: { projectId } } });
    } else await tx.delete(schema.members).where(eq(schema.members.id, m!.id));
    const ns = await tx.select().from(schema.notifications).where(and(eq(schema.notifications.userId, user.id), eq(schema.notifications.type, "PROJECT_INVITE")));
    for (const n of ns) if ((n.action as { projectId?: string } | null)?.projectId === projectId) await tx.update(schema.notifications).set({ read: true, readAt: n.readAt ?? new Date(), action: { projectId, answered: accept ? "accepted" : "declined" } }).where(eq(schema.notifications.id, n.id));
  });
};
