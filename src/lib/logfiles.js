import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const LOG = path.join(ROOT, 'bot.log');
export const ARCHIVE_DIR = path.join(ROOT, 'logs');

const ROTATE_BYTES = 2 * 1024 * 1024; // archive bot.log once it passes 2 MB
const KEEP_LINES = 1500;              // recent lines left in bot.log after rotating

function archives() {
  try {
    return fs.readdirSync(ARCHIVE_DIR).filter(f => /^bot-[\d-]+\.log$/.test(f)).sort();
  } catch {
    return [];
  }
}

// Archived lines (oldest first) followed by the current bot.log
export function readAllLines({ days = 30 } = {}) {
  const cutoff = Date.now() - days * 86400000;
  const out = [];
  for (const f of archives()) {
    const full = path.join(ARCHIVE_DIR, f);
    if (fs.statSync(full).mtimeMs < cutoff) continue;
    out.push(...fs.readFileSync(full, 'utf8').split('\n'));
  }
  if (fs.existsSync(LOG)) out.push(...fs.readFileSync(LOG, 'utf8').split('\n'));
  // A rotation copies the tail into both files; drop the repeated lines
  const seen = new Set();
  return out.filter(l => l && !(seen.has(l) || !seen.add(l)));
}

// Copy bot.log into logs/, then cut bot.log down to its recent tail. The bot
// writes with O_APPEND, so it keeps appending to the trimmed file.
export function rotateIfNeeded() {
  if (!fs.existsSync(LOG) || fs.statSync(LOG).size < ROTATE_BYTES) return null;
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  const text = fs.readFileSync(LOG, 'utf8');
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const dest = path.join(ARCHIVE_DIR, `bot-${stamp}.log`);
  fs.writeFileSync(dest, text);
  const tail = text.trimEnd().split('\n').slice(-KEEP_LINES).join('\n') + '\n';
  fs.writeFileSync(LOG, tail);
  return dest;
}
