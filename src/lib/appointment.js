import fs from 'fs';
import path from 'path';
import { ROOT, readAllLines } from './logfiles.js';

export const APPT_FILE = path.join(ROOT, '.appointment.json'); // manual override from the dashboard
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// The appointment you hold now: a manual entry wins, otherwise the bot's latest booking
export function currentAppointment() {
  try {
    const a = JSON.parse(fs.readFileSync(APPT_FILE, 'utf8'));
    if (DATE_RE.test(a.date)) return { date: a.date, time: a.time || null, city: a.city || null, source: 'manual' };
  } catch {}
  const lines = readAllLines({ days: 3650 });
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/booked time at (\d{4}-\d{2}-\d{2}) (\S+) ([^(]+)/);
    if (m) return { date: m[1], time: m[2], city: m[3].trim(), source: 'bot' };
  }
  return null;
}
