// Optional: record what the terminal showed as an asciicast v2 file (for demos).
// Each line also carries the clip time the frame was drawn at, so a demo video can
// line the dashboard up with the footage it was computed from.
import { openSync, writeSync, closeSync } from 'node:fs';

export function openCast(path, { width, height }) {
  const fd = openSync(path, 'w', 0o600);
  const t0 = process.hrtime.bigint();
  writeSync(fd, JSON.stringify({ version: 2, width, height, timestamp: Math.floor(Date.now() / 1000), title: 'Pulse Break' }) + '\n');
  return {
    write(data, clipSeconds) {
      const t = Number(process.hrtime.bigint() - t0) / 1e9;
      const ev = [Number(t.toFixed(4)), 'o', data];
      if (clipSeconds != null) ev.push({ clip: Number(clipSeconds.toFixed(3)) });
      writeSync(fd, JSON.stringify(ev) + '\n');
    },
    close() {
      closeSync(fd);
    },
  };
}
