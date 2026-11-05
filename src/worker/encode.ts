// How video gets encoded to H.264: on the CPU (libx264), or on the GPU through VAAPI (AMD and Intel on Linux).

export type Encode = {
  /** Goes before the inputs. */
  before: string[];
  /** Goes on the end of the filter chain. */
  filter: string;
  /** Goes with the output options. */
  video: string[];
};

/** `quality` is x264's CRF, used as the GPU's fixed QP (lower is better on both). */
export function h264(device: string | null, quality: number, fps: number): Encode {
  if (!device) return { before: [], filter: "", video: ["-c:v", "libx264", "-preset", "veryfast", "-crf", String(quality), "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", String(fps)] };
  // Decoding and filters stay on the CPU, so rotation, scaling and text work the same; frames go to the GPU to be encoded.
  return { before: ["-vaapi_device", device], filter: `,fps=${fps},format=nv12,hwupload`, video: ["-c:v", "h264_vaapi", "-rc_mode", "CQP", "-qp", String(quality), "-profile:v", "high"] };
}

/** Runs `job` on the GPU, and again on the CPU if that fails. */
export async function withGpu<T>(device: string | null, job: (device: string | null) => Promise<T>, warn: (m: string) => void = console.error): Promise<T> {
  if (!device) return job(null);
  try { return await job(device); }
  catch (e) {
    warn("[gpu] encoding failed, using the CPU instead: " + (e as Error).message.slice(0, 300));
    return job(null);
  }
}
