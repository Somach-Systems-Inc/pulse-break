#!/usr/bin/env node
// Put a recorded Pulse Break session on the clip's own clock, for a demo video.
//
// The SDK reads a video file a little slower than real time, so the wall-clock
// times in the cast drift from the footage. Every dashboard frame carries the clip
// time it was drawn at; this keeps the frames exactly as recorded and only moves
// them in time:
//   consent screen  0 .. CONSENT s
//   SDK start-up    CONSENT .. MAIN s
//   measurement     MAIN + clip time
//   summary         right after the last measured frame
// Usage: retime_cast.mjs in.cast out.cast [--consent 6] [--main 8] [--hold 9] [--extra extra.txt] [--width 72]
// --extra appends a screen (e.g. the output of `pulse-break history`) after the summary.
import { readFileSync, writeFileSync } from 'node:fs';

const [, , inPath, outPath, ...rest] = process.argv;
if (!inPath || !outPath) {
  console.error('usage: retime_cast.mjs in.cast out.cast [--consent 6] [--main 8] [--extra file] [--hold 9]');
  process.exit(2);
}
const opt = { consent: 6, main: 8, hold: 9, extra: null, width: null };
for (let i = 0; i < rest.length; i += 2) opt[rest[i].replace(/^--/, '')] = rest[i + 1];
const CONSENT = Number(opt.consent);
const MAIN = Number(opt.main);
const HOLD = Number(opt.hold);

const lines = readFileSync(inPath, 'utf8').split('\n').filter(Boolean);
const header = JSON.parse(lines[0]);
// --width widens the terminal (e.g. so the extra screen's long lines do not wrap).
if (opt.width) header.width = Math.max(header.width, Number(opt.width));
const events = lines.slice(1).map((l) => JSON.parse(l));

const enter = events.findIndex((e) => e[2].includes('\x1b[2J'));
const summary = events.findIndex((e) => e[2].includes('CHECK-IN DONE'));
if (enter < 0 || summary < 0) {
  console.error('cast does not look like a Pulse Break check-in (no start screen or no summary)');
  process.exit(3);
}
const clipOf = (e) => (e[3] && Number.isFinite(e[3].clip) ? e[3].clip : null);
const firstMeasured = events.findIndex((e, i) => i > enter && clipOf(e) > 0);
const lastClip = Math.max(...events.slice(0, summary).map((e) => clipOf(e) ?? 0));

const out = [];
let prev = -1;
const put = (t, data) => {
  const tt = Math.max(t, prev + 0.001);
  prev = tt;
  out.push([Number(tt.toFixed(3)), 'o', data]);
};

// Consent: everything before the dashboard. The question is the last piece; give
// the text time to be read, then the answer.
const consent = events.slice(0, enter);
consent.forEach((e, i) => {
  const isLast = i === consent.length - 1;
  put(isLast && consent.length > 1 ? CONSENT * 0.85 : i * 0.05, e[2]);
});
// Start-up frames (models loading), spread evenly before the measurement starts.
const startup = events.slice(enter, firstMeasured);
startup.forEach((e, i) => put(CONSENT + ((MAIN - CONSENT) * i) / Math.max(1, startup.length), e[2]));
// Measurement: clip clock.
for (const e of events.slice(firstMeasured, summary)) put(MAIN + (clipOf(e) ?? 0), e[2]);
// Summary and whatever follows it (cursor restore).
const tSummary = MAIN + lastClip + 0.3;
for (const e of events.slice(summary)) put(tSummary, e[2]);
let end = tSummary + HOLD;
if (opt.extra) {
  // How long this last screen stays up is the renderer's call (agg --last-frame-duration).
  const text = readFileSync(opt.extra, 'utf8').replace(/\r?\n/g, '\r\n');
  put(end, '\x1b[2J\x1b[H' + text);
} else {
  // Without an extra screen, a no-op event keeps the summary up for its hold time.
  put(end, ' ');
}

writeFileSync(outPath, [JSON.stringify(header), ...out.map((e) => JSON.stringify(e))].join('\n') + '\n');
console.log(`retimed ${events.length} events: consent ${consent.length}, start-up ${startup.length}, measured to clip ${lastClip.toFixed(1)} s, total ${end.toFixed(1)} s`);
console.log(`clip starts at ${MAIN} s in the output; summary at ${tSummary.toFixed(1)} s`);
