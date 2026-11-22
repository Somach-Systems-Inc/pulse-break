// Pure functions: turn a check-in's readings into numbers and a short verdict.
// No I/O here, so the rules can be tested without a camera or the SDK.

// How far above your own usual counts as "running warm". Chosen as round,
// easy-to-explain steps, not clinical cut-offs.
export const PULSE_UP_BPM = 10;
export const BREATH_UP_PER_MIN = 4;
// Earlier check-ins needed before the app compares against them.
export const BASELINE_MIN = 2;
// How many recent check-ins make up "your usual".
export const BASELINE_WINDOW = 7;

export function median(values) {
  const xs = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

// readings: { pulses: [{value, stable, confidence, t}], breaths: [{value, t}] }
// Only pulse readings the SDK marks stable count toward the result.
export function summarize(readings) {
  const steady = readings.pulses.filter((p) => p.stable);
  const pulse = median(steady.map((p) => p.value));
  const breath = median(readings.breaths.map((b) => b.value));
  return {
    pulse: round1(pulse),
    pulseN: steady.length,
    breath: round1(breath),
    breathN: readings.breaths.length,
  };
}

// The baseline is the median of your most recent earlier check-ins that had a reading.
export function baseline(history) {
  const usable = history.filter((h) => h.pulse != null || h.breath != null).slice(-BASELINE_WINDOW);
  return {
    n: usable.length,
    pulse: round1(median(usable.map((h) => h.pulse))),
    breath: round1(median(usable.map((h) => h.breath))),
  };
}

const signed = (v, unit) => `${v >= 0 ? '+' : ''}${round1(v)} ${unit}`;

// Returns { kind, text, dPulse, dBreath, base }.
// kind: 'no-reading' | 'baseline' | 'warm' | 'steady'
export function verdict(summary, history) {
  const base = baseline(history);
  if (summary.pulse == null && summary.breath == null) {
    return { kind: 'no-reading', base, text: 'No steady reading this time. Face the camera in even light, sit still, and try again.' };
  }
  if (base.n < BASELINE_MIN) {
    return {
      kind: 'baseline',
      base,
      text: `Saved. Building your usual: ${base.n + 1} of ${BASELINE_MIN + 1} check-ins.`,
    };
  }
  const dPulse = summary.pulse != null && base.pulse != null ? summary.pulse - base.pulse : null;
  const dBreath = summary.breath != null && base.breath != null ? summary.breath - base.breath : null;
  const parts = [];
  if (dPulse != null) parts.push(`pulse ${signed(dPulse, 'bpm')}`);
  if (dBreath != null) parts.push(`breathing ${signed(dBreath, '/min')}`);
  const vs = parts.length ? ` (${parts.join(', ')} vs your usual)` : '';
  const warm = (dPulse != null && dPulse >= PULSE_UP_BPM) || (dBreath != null && dBreath >= BREATH_UP_PER_MIN);
  if (warm) {
    return {
      kind: 'warm',
      base,
      dPulse,
      dBreath,
      text: `Running warmer than usual${vs}. Good moment for a 5-minute break: stand up, look far away, breathe slowly.`,
    };
  }
  // Clearly below your usual on at least one signal, and not above it on the other.
  const calmer =
    ((dPulse != null && dPulse <= -PULSE_UP_BPM / 2) || (dBreath != null && dBreath <= -BREATH_UP_PER_MIN / 2)) &&
    !(dPulse != null && dPulse >= PULSE_UP_BPM / 2) &&
    !(dBreath != null && dBreath >= BREATH_UP_PER_MIN / 2);
  const lead = calmer ? 'Calmer than your usual' : 'Close to your usual';
  return { kind: 'steady', base, dPulse, dBreath, text: `${lead}${vs}. Keep going.` };
}
