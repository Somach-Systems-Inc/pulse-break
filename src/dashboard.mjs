import { homedir } from 'node:os';

// Terminal dashboard. render(state) returns the whole screen as a string, so the
// same frame can be drawn live and recorded for a demo.

const ESC = '\x1b[';
const c = {
  reset: `${ESC}0m`,
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  red: `${ESC}31m`,
  green: `${ESC}32m`,
  yellow: `${ESC}33m`,
  cyan: `${ESC}36m`,
  magenta: `${ESC}35m`,
};

export const WIDTH = 66;
const BARS = '▁▂▃▄▅▆▇█';

export function sparkline(values, width) {
  const xs = values.filter((v) => Number.isFinite(v));
  if (xs.length < 2) return ''.padEnd(width, ' ');
  // Downsample (or keep) to at most `width` points, newest on the right.
  const step = Math.max(1, xs.length / width);
  const pts = [];
  for (let i = Math.max(0, xs.length - Math.floor(width * step)); i < xs.length; i += step) pts.push(xs[Math.floor(i)]);
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const span = hi - lo || 1;
  return pts
    .slice(-width)
    .map((v) => BARS[Math.min(BARS.length - 1, Math.floor(((v - lo) / span) * BARS.length))])
    .join('')
    .padEnd(width, ' ');
}

function bar(fraction, width, color = c.cyan) {
  const f = Math.max(0, Math.min(1, fraction));
  const full = Math.round(f * width);
  return `${color}${'█'.repeat(full)}${c.dim}${'░'.repeat(width - full)}${c.reset}`;
}

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function hintLine(state) {
  if (state.phase === 'starting') return `${c.dim}●${c.reset} Starting the SDK and loading its models...`;
  if (state.hintCode == null) return `${c.dim}●${c.reset} Waiting for the first frame...`;
  if (state.hintCode === 0) return `${c.green}●${c.reset} Good. Sit still and breathe normally.`;
  return `${c.yellow}●${c.reset} ${state.hint || 'Adjusting...'}`;
}

function pulseLine(state) {
  const p = state.pulse;
  if (!p) return `${c.dim}reading... (the first value takes about 15 s)${c.reset}`;
  const v = `${c.bold}${Math.round(p.value)}${c.reset} bpm`;
  const tag = p.stable ? `${c.green}steady${c.reset}` : `${c.yellow}settling${c.reset}`;
  const conf = Number.isFinite(p.confidence) ? `${c.dim} conf ${Math.round(p.confidence)}${c.reset}` : '';
  return `${v}  ${tag}${conf}`;
}

function breathLine(state) {
  const b = state.breath;
  if (!b) return `${c.dim}reading... (needs a few breaths)${c.reset}`;
  return `${c.bold}${Math.round(b.value)}${c.reset} breaths/min`;
}

export function render(state) {
  const lines = [];
  const elapsed = Math.max(0, state.elapsed || 0);
  const total = state.seconds;
  const rule = `${c.dim}${'─'.repeat(WIDTH)}${c.reset}`;
  const head = `${c.bold}PULSE BREAK${c.reset}  ${c.dim}between-blocks check-in${c.reset}`;
  const clock = `${mmss(Math.min(elapsed, total))} / ${mmss(total)}`;
  lines.push(`${head}${' '.repeat(Math.max(1, WIDTH - 37 - clock.length))}${clock}`);
  lines.push(rule);
  lines.push(`${c.dim}Camera check${c.reset}   ${hintLine(state)}`);
  lines.push('');
  lines.push(`${c.dim}Pulse${c.reset}          ${pulseLine(state)}`);
  const pv = (state.pulseValues || []).filter(Number.isFinite);
  const range = pv.length > 1 ? `${c.dim} ${Math.round(Math.min(...pv))}-${Math.round(Math.max(...pv))}${c.reset}` : '';
  lines.push(`${c.dim}  trend${c.reset}        ${c.red}${sparkline(pv, 40)}${c.reset}${range}`);
  lines.push(`${c.dim}Breathing${c.reset}      ${breathLine(state)}`);
  lines.push(`${c.dim}  chest${c.reset}        ${c.cyan}${sparkline(state.trace || [], 40)}${c.reset}`);
  if (state.hrv && Number.isFinite(state.hrv.rmssd)) {
    lines.push(`${c.dim}HRV (RMSSD)${c.reset}    ${Math.round(state.hrv.rmssd)} ms`);
  } else {
    lines.push('');
  }
  lines.push('');
  // The bar turns yellow while the SDK asks for an adjustment, so you see at a glance when to fix your position.
  const barColor = state.hintCode != null && state.hintCode !== 0 ? c.yellow : c.cyan;
  lines.push(`${bar(total ? elapsed / total : 0, 48, barColor)}  ${Math.floor(Math.min(elapsed, total))} s measured`);
  lines.push(rule);
  lines.push(`${c.dim}Source: ${state.sourceLabel}${c.reset}`);
  lines.push(`${c.dim}Nothing is recorded. Ctrl+C stops.${c.reset}`);
  return lines;
}

export function renderSummary(summary, v, savedTo) {
  const lines = [];
  const rule = `${c.dim}${'─'.repeat(WIDTH)}${c.reset}`;
  lines.push(`${c.bold}CHECK-IN DONE${c.reset}`);
  lines.push(rule);
  const p = summary.pulse != null ? `${c.bold}${Math.round(summary.pulse)}${c.reset} bpm ${c.dim}(median of ${summary.pulseN} steady readings)${c.reset}` : `${c.dim}no steady reading${c.reset}`;
  const b = summary.breath != null ? `${c.bold}${Math.round(summary.breath)}${c.reset} breaths/min ${c.dim}(median of ${summary.breathN} readings)${c.reset}` : `${c.dim}no reading${c.reset}`;
  lines.push(`${c.dim}Pulse${c.reset}          ${p}`);
  lines.push(`${c.dim}Breathing${c.reset}      ${b}`);
  if (v.base && v.base.n > 0) {
    const bp = v.base.pulse != null ? `pulse ${Math.round(v.base.pulse)}` : '';
    const bb = v.base.breath != null ? `breathing ${Math.round(v.base.breath)}` : '';
    lines.push(`${c.dim}Your usual${c.reset}     ${[bp, bb].filter(Boolean).join(', ')} ${c.dim}(${v.base.n} earlier check-in${v.base.n === 1 ? '' : 's'})${c.reset}`);
  }
  lines.push('');
  const color = v.kind === 'warm' ? c.yellow : v.kind === 'steady' ? c.green : c.cyan;
  for (const w of wrap(v.text, WIDTH - 2)) lines.push(`${color}${w}${c.reset}`);
  lines.push('');
  if (savedTo) lines.push(`${c.dim}Saved numbers only (no video) to ${savedTo.replace(homedir(), '~')}${c.reset}`);
  lines.push(`${c.dim}A nudge about your own pattern, not a health measurement.${c.reset}`);
  return lines;
}

export function wrap(text, width) {
  const out = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if ((line + ' ' + word).trim().length > width) {
      out.push(line.trim());
      line = word;
    } else {
      line += ' ' + word;
    }
  }
  if (line.trim()) out.push(line.trim());
  return out;
}

// Draw a frame in place: home the cursor, write each line, clear what is left.
export function frame(lines) {
  return `${ESC}H` + lines.map((l) => `${l}${ESC}K`).join('\r\n') + `${ESC}J`;
}

export const screen = {
  enter: `${ESC}?25l${ESC}2J${ESC}H`,
  leave: `${ESC}?25h`,
};
