// Background jobs (BullMQ on Redis). The worker process (src/worker) consumes these.
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { env } from "./env";

const g = globalThis as unknown as { __glimpseRedis?: IORedis; __glimpseQueues?: Record<string, Queue> };
export function redis(): IORedis {
  if (!g.__glimpseRedis) g.__glimpseRedis = new IORedis(env.redisUrl, { maxRetriesPerRequest: null });
  return g.__glimpseRedis;
}

export const Q = { media: "glimpse-media", mash: "glimpse-mash", track: "glimpse-track", system: "glimpse-system" } as const;
export type QName = (typeof Q)[keyof typeof Q];

export function queue(name: QName): Queue {
  g.__glimpseQueues ??= {};
  if (!g.__glimpseQueues[name]) g.__glimpseQueues[name] = new Queue(name, { connection: redis() });
  return g.__glimpseQueues[name];
}

const opts = { removeOnComplete: 200, removeOnFail: 500 };
export const enqueue = {
  processMedia: (mediaId: string) => queue(Q.media).add("process", { mediaId }, { ...opts, jobId: "media-" + mediaId, attempts: 2, backoff: { type: "fixed", delay: 5000 } }),
  importImmich: (mediaId: string, userId: string, assetId: string) => queue(Q.media).add("immich", { mediaId, userId, assetId }, { ...opts, jobId: "immich-" + mediaId, attempts: 2 }),
  renderMash: (mashId: string) => queue(Q.mash).add("render", { mashId }, { ...opts, jobId: "mash-" + mashId + "-" + Date.now() }),
  processTrack: (trackId: string) => queue(Q.track).add("process", { trackId }, { ...opts, jobId: "track-" + trackId }),
  backupNow: () => queue(Q.system).add("backup", {}, { ...opts }),
  deleteObjects: (keys: string[], prefixes: string[] = []) => queue(Q.system).add("delete", { keys, prefixes }, { ...opts, attempts: 3 })
};
