import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseline, median, summarize, verdict } from '../src/summary.mjs';
import { sparkline, wrap } from '../src/dashboard.mjs';

test('median handles odd, even, empty and junk', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
  assert.equal(median([NaN, undefined, 5]), 5);
});

test('summarize counts only stable pulse readings', () => {
  const s = summarize({
    pulses: [
      { value: 120, stable: false },
      { value: 70, stable: true },
      { value: 74, stable: true },
    ],
    breaths: [{ value: 12 }, { value: 14 }],
  });
  assert.deepEqual(s, { pulse: 72, pulseN: 2, breath: 13, breathN: 2 });
});

test('no reading at all says so and saves nothing useful', () => {
  const v = verdict({ pulse: null, breath: null }, []);
  assert.equal(v.kind, 'no-reading');
});

test('first check-ins build the baseline', () => {
  assert.equal(verdict({ pulse: 70, breath: 12 }, []).kind, 'baseline');
  assert.match(verdict({ pulse: 70, breath: 12 }, [{ pulse: 70, breath: 12 }]).text, /2 of 3/);
});

test('steady when close to your usual', () => {
  const h = [{ pulse: 70, breath: 12 }, { pulse: 74, breath: 14 }];
  const v = verdict({ pulse: 75, breath: 14 }, h);
  assert.equal(v.kind, 'steady');
  assert.match(v.text, /pulse \+3 bpm/);
});

test('calmer when clearly below your usual and not above it', () => {
  const h = [{ pulse: 84, breath: 16 }, { pulse: 82, breath: 9 }];
  const v = verdict({ pulse: 75, breath: 8 }, h);
  assert.equal(v.kind, 'steady');
  assert.match(v.text, /^Calmer than your usual/);
});

test('warm when pulse is 10+ bpm above your usual', () => {
  const h = [{ pulse: 70, breath: 12 }, { pulse: 74, breath: 14 }];
  assert.equal(verdict({ pulse: 82, breath: 13 }, h).kind, 'warm');
});

test('warm when breathing is 4+/min above your usual, even without a pulse', () => {
  const h = [{ pulse: 70, breath: 12 }, { pulse: 74, breath: 14 }];
  assert.equal(verdict({ pulse: null, breath: 17 }, h).kind, 'warm');
});

test('baseline uses only the last 7 usable check-ins', () => {
  const old = Array.from({ length: 10 }, () => ({ pulse: 100, breath: 30 }));
  const recent = Array.from({ length: 7 }, () => ({ pulse: 70, breath: 12 }));
  const b = baseline([...old, { pulse: null, breath: null }, ...recent]);
  assert.deepEqual(b, { n: 7, pulse: 70, breath: 12 });
});

test('sparkline keeps its width', () => {
  assert.equal([...sparkline([1, 2, 3, 2, 1], 10)].length, 10);
  assert.equal([...sparkline([], 8)].length, 8);
  assert.equal([...sparkline(Array.from({ length: 500 }, (_, i) => Math.sin(i / 9)), 40)].length, 40);
});

test('wrap breaks on words', () => {
  assert.deepEqual(wrap('aa bb cc dd', 5), ['aa bb', 'cc dd']);
});
