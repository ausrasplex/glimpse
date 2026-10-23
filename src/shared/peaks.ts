// Waveform bars: the loudest sample in each of `n` equal slices of a track, scaled so the loudest bar is 1.
// Shared by the worker (from FFmpeg's samples) and the browser (from decoded audio before upload).
export const PEAKS = 200;

export function peaksFrom(samples: ArrayLike<number>, n = PEAKS): number[] {
  const len = samples.length;
  if (!len) return [];
  const out = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i * len) / n), b = Math.max(a + 1, Math.floor(((i + 1) * len) / n));
    let m = 0;
    for (let j = a; j < b && j < len; j++) { const v = Math.abs(samples[j]); if (v > m) m = v; }
    out[i] = m;
  }
  const top = Math.max(...out);
  return out.map((v) => (top > 0 ? Math.round((v / top) * 100) / 100 : 0));
}

/** Resample stored peaks to `n` bars for drawing. */
export function barsFrom(peaks: number[] | null | undefined, n: number): number[] {
  if (!peaks || !peaks.length) return [];
  return Array.from({ length: n }, (_, i) => {
    const a = Math.floor((i * peaks.length) / n), b = Math.max(a + 1, Math.floor(((i + 1) * peaks.length) / n));
    let m = 0;
    for (let j = a; j < b; j++) m = Math.max(m, peaks[j] || 0);
    return m;
  });
}
