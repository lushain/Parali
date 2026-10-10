/** Noise-gated RMS, independent of the speech service. Never invent activity. */
export function voiceLevel(samples: Float32Array): number {
  if (!samples.length) return 0;
  let power = 0;
  for (const sample of samples) power += sample * sample;
  const rms = Math.sqrt(power / samples.length);
  return Math.min(1, Math.max(0, (rms - 0.008) * 9));
}
