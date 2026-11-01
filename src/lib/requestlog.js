// Full details of recent requests (logs/requests.jsonl) for the dashboard's
// Requests tab: the address, status, size, timing and the dates/times returned.
// bot.log keeps a one-line summary of each; this keeps the rest.
import fs from 'fs';
import path from 'path';
import { ARCHIVE_DIR } from './logfiles.js';

export const REQUEST_LOG = path.join(ARCHIVE_DIR, 'requests.jsonl');
const KEEP = 1500;
let lines = null;

export function recordRequest(entry) {
  try {
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
    fs.appendFileSync(REQUEST_LOG, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
    lines = lines === null ? readEntries().length : lines + 1;
    if (lines > KEEP * 1.5) {
      fs.writeFileSync(REQUEST_LOG, readEntries().slice(-KEEP).map(e => JSON.stringify(e)).join('\n') + '\n');
      lines = KEEP;
    }
  } catch {} // details are a nice-to-have; never let them stop the bot
}

function readEntries() {
  try {
    return fs.readFileSync(REQUEST_LOG, 'utf8').split('\n').filter(Boolean).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

// The entry for a request line in bot.log: same label, logged within a few seconds
export function findRequest(label, at) {
  const t = Date.parse(at);
  let best = null;
  for (const e of readEntries()) {
    if (e.label !== label) continue;
    const gap = Math.abs(Date.parse(e.at) - t);
    if (gap < 5000 && (!best || gap < best.gap)) best = { gap, e };
  }
  return best?.e || null;
}
