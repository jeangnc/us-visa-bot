import fs from 'fs';
import { fileURLToPath } from 'url';

export function sleep(seconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, seconds * 1000);
  });
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
