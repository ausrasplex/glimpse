// Thin wrappers around ffmpeg / ffprobe.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { redis } from "../server/queue";

export function run(cmd: string, args: string[], opts: { timeoutMs?: number; input?: string; onOut?: (text: string) => void } = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    p.stdout.on("data", (d) => { stdout += d; if (stdout.length > 50e6) stdout = stdout.slice(-50e6); if (opts.onOut) opts.onOut(String(d)); });
    p.stderr.on("data", (d) => { stderr += d; if (stderr.length > 200e3) stderr = stderr.slice(-200e3); });
    const t = opts.timeoutMs ? setTimeout(() => p.kill("SIGKILL"), opts.timeoutMs) : null;
    p.on("error", reject);
    p.on("close", (code) => {
      if (t) clearTimeout(t);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited with ${code}: ${stderr.split("\n").filter(Boolean).slice(-4).join(" | ")}`));
    });
    if (opts.input !== undefined) p.stdin.end(opts.input); else p.stdin.end();
  });
}

export function runBuffer(cmd: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = []; let err = "";
    p.stdout.on("data", (d: Buffer) => chunks.push(d));
    p.stderr.on("data", (d) => { err += d; if (err.length > 1e5) err = err.slice(-1e5); });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`${cmd} exited with ${code}: ${err.slice(-400)}`))));
  });
}

export const ffmpeg = (args: string[], timeoutMs = 30 * 60e3) => run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { timeoutMs });

export type Probe = {
  duration: number; width: number; height: number; rotation: number; vcodec: string | null; hasAudio: boolean;
  creation: string | null; isImage: boolean;
};

export async function probe(file: string): Promise<Probe> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file], { timeoutMs: 60e3 });
  const j = JSON.parse(stdout) as { streams?: Record<string, unknown>[]; format?: Record<string, unknown> };
  const streams = j.streams || [];
  const v = streams.find((s) => s.codec_type === "video" && !(s.disposition as Record<string, number> | undefined)?.attached_pic) || streams.find((s) => s.codec_type === "video");
  const a = streams.find((s) => s.codec_type === "audio");
  let rotation = 0;
  if (v) {
    const tags = (v.tags || {}) as Record<string, string>;
    if (tags.rotate) rotation = Number(tags.rotate) || 0;
    for (const sd of (v.side_data_list || []) as Record<string, unknown>[]) if (typeof sd.rotation === "number") rotation = sd.rotation as number;
  }
  rotation = ((Math.round(rotation / 90) * 90) % 360 + 360) % 360;
  const fmt = j.format || {};
  const ftags = (fmt.tags || {}) as Record<string, string>;
  const vtags = ((v && v.tags) || {}) as Record<string, string>;
  const dur = Number(fmt.duration || (v && v.duration) || 0);
  const formatName = String(fmt.format_name || "");
  const isImage = /image2|png_pipe|jpeg_pipe|webp_pipe|heif|mjpeg/.test(formatName) || (!!v && dur <= 0.05 && !a);
  let w = Number(v?.width || 0), h = Number(v?.height || 0);
  if (rotation === 90 || rotation === 270) [w, h] = [h, w];
  return {
    duration: isFinite(dur) ? dur : 0, width: w, height: h, rotation, vcodec: v ? String(v.codec_name) : null, hasAudio: !!a,
    creation: ftags["com.apple.quicktime.creationdate"] || ftags.creation_time || vtags.creation_time || null, isImage
  };
}

export const orientOf = (w: number, h: number) => (!w || !h ? "portrait" : Math.abs(w - h) / Math.max(w, h) < 0.08 ? "square" : w > h ? "landscape" : "portrait");

// ffmpeg, reporting how far through a video of \`seconds\` it is (0..1), every couple of seconds.
export function ffmpegProgress(args: string[], seconds: number, onProgress: (done: number) => void, timeoutMs = 30 * 60e3) {
  let last = 0;
  const onOut = (text: string) => {
    const hits = [...text.matchAll(/out_time_us=(\d+)/g)];
    if (!hits.length || !seconds || Date.now() - last < 2000) return;
    last = Date.now();
    onProgress(Math.min(1, Number(hits[hits.length - 1][1]) / 1e6 / seconds));
  };
  return run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-nostats", "-progress", "pipe:1", ...args], { timeoutMs, onOut });
}

// Which encoder a job is on, for the queue in Settings.
export const noteEncoder = (jobId: string, device: string | null) => redis().set("glimpse:encoder:" + jobId, device ? "GPU" : "CPU", "EX", 6 * 3600).catch(() => undefined);

// GPU encoding: the device, if a short test encode works on it. Checked once, when first needed.
export type Gpu = { device: string | null; note: string };
let gpu: Promise<Gpu> | null = null;
export function gpuInfo(): Promise<Gpu> {
  gpu ??= (async () => {
    const device = process.env.GPU_DEVICE || "/dev/dri/renderD128";
    if (!existsSync(device)) return { device: null, note: "No GPU passed to this container" };
    try {
      await ffmpeg(["-vaapi_device", device, "-f", "lavfi", "-i", "testsrc2=s=320x240:r=30:d=0.2", "-vf", "format=nv12,hwupload", "-c:v", "h264_vaapi", "-f", "null", "-"], 30e3);
      return { device, note: "GPU encoding ready on " + device };
    } catch (e) { return { device: null, note: "Found " + device + ", but it couldn't encode: " + (e as Error).message.slice(0, 160) }; }
  })();
  return gpu;
}
/** The GPU to use for this kind of work under the Settings choice, or null for the CPU. */
export async function gpuFor(use: "playback" | "mash", mode: "off" | "playback" | "all"): Promise<string | null> {
  if (mode === "off" || (use === "mash" && mode !== "all")) return null;
  return (await gpuInfo()).device;
}

export async function ffmpegVersion(): Promise<string> {
  try { const { stdout } = await run("ffmpeg", ["-version"], { timeoutMs: 10e3 }); const m = /ffmpeg version (\S+)/.exec(stdout); return "FFmpeg " + (m ? m[1].replace(/-.*/, "") : ""); }
  catch { return "FFmpeg (not found)"; }
}
