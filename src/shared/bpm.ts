// Tempo from an onset-strength envelope and autocorrelation. Good enough to start from;
// people can halve, double or tap the tempo in the app.
export function estimateBpm(pcm: Int16Array, rate: number): number | null {
  const hop = 256, win = 1024;
  const frames = Math.floor((pcm.length - win) / hop);
  if (frames < 200) return null;
  const env = new Float32Array(frames);
  let prev = 0;
  for (let f = 0; f < frames; f++) {
    let e = 0;
    const o = f * hop;
    for (let i = 0; i < win; i++) { const v = pcm[o + i] / 32768; e += v * v; }
    const le = Math.log(1e-9 + e);
    env[f] = Math.max(0, le - prev);
    prev = le;
  }
  // Remove the local mean so steady loud passages don't dominate.
  const mean = env.reduce((a, b) => a + b, 0) / frames;
  for (let f = 0; f < frames; f++) env[f] = Math.max(0, env[f] - mean);
  const fps = rate / hop;
  const minLag = Math.floor(fps * 60 / 200), maxLag = Math.ceil(fps * 60 / 60);
  let best = 0, bestLag = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let f = lag; f < frames; f++) s += env[f] * env[f - lag];
    // Gentle preference for tempos around 100-120 BPM.
    const bpm = 60 * fps / lag;
    const w = Math.exp(-Math.pow(Math.log2(bpm / 110), 2) * 0.5);
    if (s * w > best) { best = s * w; bestLag = lag; }
  }
  if (!bestLag) return null;
  let bpm = 60 * fps / bestLag;
  while (bpm < 70) bpm *= 2;
  while (bpm > 180) bpm /= 2;
  return Math.round(bpm);
}

