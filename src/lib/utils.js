import fs from 'fs';
import { fileURLToPath } from 'url';

// Short naps against the clock: timers freeze while the computer sleeps, so one
// long timer would overrun by hours. This resumes within 15s of waking up.
export async function sleep(seconds) {
  const until = Date.now() + seconds * 1000;
  let left = seconds * 1000;
  do {
    await new Promise((resolve) => setTimeout(resolve, Math.min(left, 15000)));
    left = until - Date.now();
  } while (left > 0);
}

// A long gap between ticks means the computer was asleep
const SLEEP_GAP = 30000, SLEEP_RECENT = 120000;
let lastTick = Date.now(), sleptAt = 0;
setInterval(() => {
  const now = Date.now();
  if (now - lastTick > SLEEP_GAP) sleptAt = now;
  lastTick = now;
}, 5000).unref();

export function computerJustSlept() {
  const now = Date.now();
  return now - lastTick > SLEEP_GAP || now - sleptAt < SLEEP_RECENT;
}

export function log(message) {
  console.log(`[${new Date().toISOString()}]`, message);
}

export function isSocketHangupError(err) {
  return err.code === 'ECONNRESET' || 
         err.code === 'ENOTFOUND' || 
         err.code === 'ETIMEDOUT' ||
         err.message.includes('socket hang up') ||
         err.message.includes('network') ||
         err.message.includes('connection');
}

// A graceful-stop request. Windows has no catchable kill signal, so the
// dashboard and stop script ask the bot to stop by creating this file.
export const STOP_FILE = fileURLToPath(new URL('../../.stop-request', import.meta.url));

export function onStopRequest(handler) {
  fs.rmSync(STOP_FILE, { force: true }); // left over from an earlier run
  setInterval(() => {
    if (!fs.existsSync(STOP_FILE)) return;
    fs.rmSync(STOP_FILE, { force: true });
    handler();
  }, 1000).unref();
}
