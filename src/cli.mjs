#!/usr/bin/env node
// Pulse Break: a 60-second camera check-in between focus blocks.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import { appendHistory, clearHistory, historyPath, homeDir, readHistory } from './history.mjs';
import { summarize, verdict } from './summary.mjs';
import { WIDTH, frame, render, renderSummary, screen, wrap } from './dashboard.mjs';
import { openCast } from './cast.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HELP = `Pulse Break: a 60-second camera check-in between focus blocks.

Usage:
  pulse-break [check] [options]   run a check-in (camera by default)
  pulse-break history             list your saved check-ins
  pulse-break forget              delete your saved check-ins

Options:
  --video <file>     read a recorded video of yourself instead of the camera
  --start <sec>      start this far into the video (default 0)
  --seconds <n>      length of the check-in (default 60)
  --fps <n>          frame rate of the video file (default 30)
  --label <text>     how the source is shown and saved (default: camera or file name)
  --yes              skip the consent question (you already agreed)
  --telemetry        allow the SmartSpectra SDK's telemetry (off by default)
  --cast <file>      also record the dashboard as an asciicast (for demos)

Needs PRESAGE_API_KEY in the environment or in a .env file (see .env.example).`;

function parseArgs(argv) {
  const o = { cmd: 'check', seconds: 60, start: 0, fps: 30, yes: false, telemetry: false };
  const rest = [...argv];
  if (rest[0] && !rest[0].startsWith('-')) o.cmd = rest.shift();
  while (rest.length) {
    const a = rest.shift();
    if (a === '--video') o.video = rest.shift();
    else if (a === '--start') o.start = Number(rest.shift());
    else if (a === '--seconds') o.seconds = Number(rest.shift());
    else if (a === '--fps') o.fps = Number(rest.shift());
    else if (a === '--label') o.label = rest.shift();
    else if (a === '--cast') o.cast = rest.shift();
    else if (a === '--yes' || a === '-y') o.yes = true;
    else if (a === '--telemetry') o.telemetry = true;
    else if (a === '--help' || a === '-h') o.cmd = 'help';
    else throw new Error(`unknown option ${a}`);
  }
  if (!Number.isFinite(o.seconds) || o.seconds < 20) throw new Error('--seconds must be at least 20 (the SDK needs time to settle)');
  if (!Number.isFinite(o.start) || o.start < 0) throw new Error('--start must be 0 or more');
  if (!Number.isFinite(o.fps) || o.fps <= 0) throw new Error('--fps must be a positive number');
  return o;
}

function loadKey() {
  for (const p of [resolve('.env'), join(HERE, '..', '.env')]) {
    if (existsSync(p)) {
      try {
        process.loadEnvFile(p);
      } catch {
        // malformed .env: fall through to the check below
      }
      break;
    }
  }
  return process.env.PRESAGE_API_KEY;
}

async function askConsent(o, out) {
  const lines = o.video
    ? [
        `Pulse Break will read ${basename(o.video)} for ${o.seconds} seconds to estimate pulse and breathing rate.`,
        'Only use a recording of yourself, or of someone who agreed to this.',
      ]
    : [`Pulse Break will use your camera for ${o.seconds} seconds to estimate your pulse and breathing rate.`];
  lines.push(
    '- Video frames are processed in this program and never saved.',
    `- Only the final numbers (pulse, breathing rate, time) are saved, on this computer: ${historyPath()}`,
    "- The SmartSpectra SDK checks your API key with Presage and downloads its models. Its telemetry is off unless you pass --telemetry.",
    '- This is a nudge about your own pattern, not a medical measurement.',
  );
  const wrapped = lines.flatMap((l) => {
    const bullet = l.startsWith('- ');
    return wrap(bullet ? l.slice(2) : l, WIDTH - 2).map((w, i) => (bullet ? (i === 0 ? '- ' : '  ') : '') + w);
  });
  out(wrapped.join('\r\n') + '\r\n\r\n');
  const question = o.video ? 'Analyze this video? [y/N] ' : 'Turn on the camera? [y/N] ';
  if (o.yes) {
    out(`${question}y (--yes)\r\n`);
    return true;
  }
  if (!process.stdin.isTTY) {
    out('No terminal to ask in. Run again with --yes if you agree.\r\n');
    return false;
  }
  out(question);
  const rl = createInterface({ input: process.stdin });
  const a = (await rl.question('')).trim().toLowerCase();
  rl.close();
  out(`${a}\r\n`, undefined, true); // the terminal already echoed the answer; only the recording needs it
  return a === 'y' || a === 'yes';
}

function showHistory() {
  const h = readHistory();
  if (!h.length) {
    console.log(`No check-ins yet. (${historyPath()})`);
    return;
  }
  console.log('When         Pulse  Breath  Source');
  for (const e of h) {
    const when = new Date(e.at).toLocaleString('sv-SE').slice(5, 16); // MM-DD HH:MM, local time
    const p = e.pulse != null ? String(Math.round(e.pulse)).padStart(5) : '    -';
    const b = e.breath != null ? String(Math.round(e.breath)).padStart(6) : '     -';
    const src = String(e.source ?? '');
    console.log(`${when}  ${p}  ${b}  ${src.length > 42 ? src.slice(0, 41) + '…' : src}`);
  }
}

async function check(o) {
  const apiKey = loadKey();
  if (!apiKey) {
    console.log('PRESAGE_API_KEY is not set. Get a free key at https://physiology.presagetech.com/auth/register and put it in .env (see .env.example).');
    return 2;
  }
  if (o.video && !existsSync(o.video)) {
    console.log(`No such video: ${o.video}`);
    return 2;
  }
  const cast = o.cast ? openCast(o.cast, { width: WIDTH + 2, height: 16 }) : null;
  const out = (s, clip, castOnly = false) => {
    if (!castOnly) process.stdout.write(s);
    if (cast) cast.write(s, clip);
  };
  if (!(await askConsent(o, out))) {
    out('Nothing started.\r\n');
    if (cast) cast.close();
    return 1;
  }
  const { runSession } = await import('./session.mjs');
  const sourceLabel = o.label || (o.video ? `${basename(o.video)} (recorded video)` : 'camera (live)');

  out(screen.enter);
  let session;
  let last = 0;
  const draw = (state, force = false) => {
    const now = Date.now();
    if (!force && now - last < 100) return; // at most 10 frames a second
    last = now;
    out(frame(render({ ...state, sourceLabel })), state.elapsed);
  };
  try {
    session = runSession({
      apiKey,
      video: o.video,
      startMs: Math.round(o.start * 1000),
      seconds: o.seconds,
      fps: o.fps,
      telemetry: o.telemetry,
      onChange: (s) => draw(s),
    });
  } catch (e) {
    out(screen.leave);
    if (cast) cast.close();
    console.log(`\nCould not start the SDK: ${e.message}${e.code != null ? ` (code ${e.code})` : ''}`);
    return 3;
  }
  const onInt = () => session.stop();
  process.on('SIGINT', onInt);
  const tick = setInterval(() => draw(session.state), 250);
  const { readings, state } = await session.done;
  clearInterval(tick);
  process.off('SIGINT', onInt);
  draw(state, true);

  if (state.error) {
    out(screen.leave + '\n');
    console.log(`The SDK stopped with an error: ${state.error.message} (code ${state.error.code}). Nothing was saved.`);
    if (cast) cast.close();
    return 3;
  }

  const history = readHistory();
  const summary = summarize(readings);
  const v = verdict(summary, history);
  let savedTo = null;
  if (summary.pulse != null || summary.breath != null) {
    appendHistory({ at: new Date().toISOString(), source: sourceLabel, seconds: Math.round(state.elapsed), ...summary });
    savedTo = historyPath();
  }
  out(frame(renderSummary(summary, v, savedTo)), state.elapsed);
  out(screen.leave + '\r\n');
  if (cast) cast.close();
  if (state.teardownError) console.log(`(The SDK did not shut down cleanly: ${state.teardownError})`);
  return 0;
}

async function main() {
  let o;
  try {
    o = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.log(`${e.message}\n\n${HELP}`);
    return 2;
  }
  if (o.cmd === 'help') {
    console.log(HELP);
    return 0;
  }
  if (o.cmd === 'history') {
    showHistory();
    return 0;
  }
  if (o.cmd === 'forget') {
    clearHistory();
    console.log(`Deleted ${historyPath()}`);
    return 0;
  }
  if (o.cmd !== 'check') {
    console.log(HELP);
    return 2;
  }
  // The SDK's native code logs to stderr, which would scribble over the dashboard.
  // Run the check-in in a child process whose stderr goes to a log file instead.
  if (!process.env.PULSE_BREAK_CHILD) {
    mkdirSync(homeDir(), { recursive: true, mode: 0o700 });
    const logPath = join(homeDir(), 'sdk.log');
    const log = openSync(logPath, 'a', 0o600);
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
      stdio: ['inherit', 'inherit', log],
      env: { ...process.env, PULSE_BREAK_CHILD: '1' },
    });
    process.on('SIGINT', () => {}); // the child handles Ctrl+C and stops the SDK cleanly
    return await new Promise((res) => child.on('exit', (code) => res(code ?? 1)));
  }
  return await check(o);
}

main().then(
  (code) => process.exit(code),
  (e) => {
    process.stdout.write(screen.leave);
    console.log(`Pulse Break failed: ${e.stack || e}`);
    process.exit(1);
  },
);
