// One check-in: start the SmartSpectra SDK on the camera or a video file, keep the
// latest live readings in `state`, and resolve with every reading when it ends.
import {
  SmartSpectraSDK,
  CameraSelection,
  ProcessingStatus,
  SmartSpectraLogLevel,
  breathingMetrics,
  cardioMetrics,
  decodeMetrics,
} from '@smartspectra/node-sdk';

const TRACE_SECONDS = 12; // how much chest-motion trace the dashboard shows
const PULSE_POINTS = 60; // how many pulse readings the trend line keeps

export function runSession({ apiKey, video, startMs = 0, seconds, fps = 30, telemetry = false, onChange }) {
  const sdk = new SmartSpectraSDK({
    apiKey,
    requestedMetrics: [...breathingMetrics, ...cardioMetrics],
    logLevel: SmartSpectraLogLevel.kError,
    enableTelemetry: telemetry,
  });

  const state = {
    phase: 'starting',
    seconds,
    elapsed: 0,
    firstUs: null,
    lastUs: null,
    hint: '',
    hintCode: null,
    pulse: null,
    pulseValues: [],
    breath: null,
    trace: [],
    traceT: [],
    hrv: null,
    error: null,
  };
  const readings = { pulses: [], breaths: [] };
  const seenPulse = new Set();
  const seenBreath = new Set();
  const changed = () => onChange && onChange(state);

  const touchClock = (us) => {
    if (!Number.isFinite(us)) return;
    if (state.firstUs == null) state.firstUs = us;
    state.lastUs = us;
    state.elapsed = (us - state.firstUs) / 1e6;
  };

  let started = false; // the SDK left its initial idle state at least once
  sdk.on('processingStatus', (s) => {
    if (s === ProcessingStatus.kStarting || s === ProcessingStatus.kRunning) started = true;
    if (s === ProcessingStatus.kRunning) state.phase = 'measuring';
    if (s === ProcessingStatus.kError) state.phase = 'error';
    changed();
  });

  sdk.on('validationStatus', (code, tsUs, hint) => {
    touchClock(Number(tsUs));
    state.hintCode = code;
    state.hint = hint;
    changed();
  });

  sdk.on('error', (code, message) => {
    state.error = { code, message };
    state.phase = 'error';
    changed();
  });

  sdk.on('metrics', (buf, tsUs) => {
    const m = decodeMetrics(buf);
    if (!m || Buffer.isBuffer(m)) return;
    touchClock(Number(tsUs));
    const t = state.elapsed;

    for (const p of m.cardio?.pulseRate ?? []) {
      const key = String(p.timestamp);
      if (seenPulse.has(key)) continue;
      seenPulse.add(key);
      const r = { value: p.value, stable: !!p.stable, confidence: p.confidence, t };
      readings.pulses.push(r);
      state.pulse = r;
      state.pulseValues.push(p.value);
      if (state.pulseValues.length > PULSE_POINTS) state.pulseValues.shift();
    }

    for (const b of m.breathing?.rate ?? []) {
      const key = String(b.timestamp);
      if (seenBreath.has(key)) continue;
      seenBreath.add(key);
      const r = { value: b.value, t };
      readings.breaths.push(r);
      state.breath = r;
    }

    for (const u of m.breathing?.upperTrace ?? []) {
      state.trace.push(u.value);
      state.traceT.push(Number(u.timestamp) / 1e6);
    }
    // Keep only the last TRACE_SECONDS of chest motion.
    const cutoff = (state.traceT.at(-1) ?? 0) - TRACE_SECONDS;
    while (state.traceT.length && state.traceT[0] < cutoff) {
      state.traceT.shift();
      state.trace.shift();
    }

    const h = m.cardio?.hrv?.at(-1);
    if (h && Number.isFinite(h.rmssd) && h.rmssd > 0) state.hrv = h;
    changed();
  });

  if (video) {
    // Play the file at its own frame rate so readings arrive at the pace a live camera gives them.
    sdk.useFile(video, { startOffsetMs: startMs, maxDurationMs: seconds * 1000, interframeDelayMs: Math.round(1000 / fps) });
  } else {
    sdk.useCamera(CameraSelection.default);
  }

  let stopTimer = null;
  const finished = new Promise((resolve) => {
    const poll = setInterval(() => {
      const s = sdk.processingStatus;
      // Camera: stop once the check-in time has been measured.
      if (!video && state.elapsed >= seconds && !stopTimer) {
        stopTimer = sdk.stopAsync().catch(() => {});
      }
      // Idle after it started means the session ended (end of file, or stopped); this also
      // covers a start that went straight back to idle without ever running.
      if ((s === ProcessingStatus.kIdle && started) || s === ProcessingStatus.kError || state.error) {
        clearInterval(poll);
        resolve();
      }
    }, 200);
  });

  const stop = async () => {
    try {
      await sdk.stopAsync();
    } catch {
      // already stopped
    }
  };

  sdk.start();

  return {
    state,
    stop,
    done: finished.then(async () => {
      if (stopTimer) await stopTimer;
      state.phase = state.phase === 'error' ? 'error' : 'done';
      try {
        await sdk.destroy();
      } catch (e) {
        // The readings are already in hand; a failed teardown is reported but does not lose them.
        state.teardownError = e.message;
      }
      return { readings, state };
    }),
  };
}
