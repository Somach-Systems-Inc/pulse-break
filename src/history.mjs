// Local check-in history: one JSON line per check-in, numbers only.
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function homeDir() {
  return process.env.PULSE_BREAK_HOME || join(homedir(), '.pulse-break');
}

export function historyPath() {
  return join(homeDir(), 'history.jsonl');
}

export function readHistory(path = historyPath()) {
  if (!existsSync(path)) return [];
  const out = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // A damaged line is skipped, not fatal: the rest of the history still counts.
    }
  }
  return out;
}

// entry: { at, source, pulse, pulseN, breath, breathN, seconds }
export function appendHistory(entry, path = historyPath()) {
  mkdirSync(homeDir(), { recursive: true, mode: 0o700 });
  appendFileSync(path, JSON.stringify(entry) + '\n', { mode: 0o600 });
}

export function clearHistory(path = historyPath()) {
  if (existsSync(path)) rmSync(path);
}
