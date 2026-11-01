#!/usr/bin/env node
// Live table of the bot's checks in the terminal: one row per round, one
// column per city.   npm run watch   (Ctrl-C to quit; the bot keeps running)
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { facilityName } from '../src/lib/facilities.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOG = process.argv[2] || path.join(ROOT, 'bot.log');
dotenv.config({ path: path.join(ROOT, '.env') });

// Columns: the cities in FACILITY_ID; any other city seen in the log is added
const CITIES = String(process.env.FACILITY_ID || '').split(',').map(s => s.trim()).filter(Boolean)
  .map(id => facilityName(process.env.COUNTRY_CODE, id).replace(/^#/, 'Facility '));
const width = city => Math.max(17, city.length);
const TIME_W = 8, TOTAL_W = 7, NEXT_W = 9;

const C = {
  R: '\x1b[0m', B: '\x1b[1m', D: '\x1b[2m',
  bgA: '\x1b[48;5;234m', bgB: '\x1b[48;5;236m', bgHead: '\x1b[48;5;17m',
  bgGood: '\x1b[48;5;22m', bgBad: '\x1b[48;5;52m', bgWarn: '\x1b[48;5;94m', bgInfo: '\x1b[48;5;24m',
  fgHead: '\x1b[1;93m', fgTime: '\x1b[1;38;5;117m', fgDate: '\x1b[38;5;120m', fgHot: '\x1b[1;38;5;46m',
  fgNone: '\x1b[38;5;240m', fgUp: '\x1b[1;38;5;46m', fgDown: '\x1b[38;5;203m', fgText: '\x1b[1;97m',
};
const SEP = ` ${C.D}│${C.R}`;
const visible = s => s.replace(/\x1b\[[0-9;]*m/g, '').length;
const center = (s, w) => { const n = Math.max(0, w - visible(s)); return ' '.repeat(n >> 1) + s + ' '.repeat(n - (n >> 1)); };
const paint = (bg, fg, text) => bg + fg + text + C.R;
const clock = iso => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const totalCols = () => TIME_W + 2 + CITIES.reduce((a, c) => a + width(c) + 3, 0) + TOTAL_W + 3 + NEXT_W + 3;

function headerRow() {
  const cells = [center('TIME', TIME_W), ...CITIES.map(c => center(c.toUpperCase(), width(c))), center('TOTAL', TOTAL_W), center('NEXT', NEXT_W)]
    .map(t => paint(C.bgHead, C.fgHead, t));
  return C.bgHead + ' ' + cells.join(SEP + C.bgHead) + ' ' + C.R;
}
const divider = () => C.D + ['─'.repeat(TIME_W + 2), ...CITIES.map(c => '─'.repeat(width(c) + 2)), '─'.repeat(TOTAL_W + 2), '─'.repeat(NEXT_W + 2)].join('┼') + C.R;
const banner = (bg, text) => bg + C.fgText + ' ' + center(text, totalCols() - 2) + ' ' + C.R;

function box(lines) {
  const w = totalCols() - 2;
  const rows = ['╔' + '═'.repeat(w) + '╗', '║' + ' '.repeat(w) + '║', ...lines.map(l => '║' + center(l, w) + '║'), '║' + ' '.repeat(w) + '║', '╚' + '═'.repeat(w) + '╝'];
  return '\x07' + rows.map(l => C.bgGood + C.fgText + C.B + l + C.R).join('\n'); // \x07 rings the terminal bell
}

let rowCount = 0;
let pending = null;   // a round waiting for its "sleeping" line to know the next check time
const last = {};      // city -> previous earliest date, for ↑/↓ arrows

function row({ time, cities }, next) {
  rowCount++;
  const bg = rowCount % 2 ? C.bgB : C.bgA;
  let total = 0;
  const cells = [paint(bg, C.fgTime, center(time, TIME_W))];
  for (const c of CITIES) {
    const m = cities[c]?.match(/^(\d{4}-\d{2}-\d{2})×(\d+)$/);
    if (!m) { cells.push(paint(bg, C.fgNone, center(cities[c] ? '— none' : '·', width(c)))); continue; }
    total += Number(m[2]);
    const prev = last[c]; last[c] = m[1];
    const arrow = prev && m[1] < prev ? `${C.fgUp}↑` : prev && m[1] > prev ? `${C.fgDown}↓` : ' ';
    cells.push(paint(bg, C.fgDate, center(`${m[1]} ×${m[2]}${arrow}`, width(c))));
  }
  cells.push(paint(bg, total ? C.fgHot : C.fgNone, center(String(total), TOTAL_W)));
  cells.push(paint(bg, next ? C.fgTime : C.fgNone, center(next || '—', NEXT_W)));
  return bg + ' ' + cells.join(SEP + bg) + ' ' + C.R;
}

function flush(next) {
  if (!pending) return;
  if (rowCount > 0 && rowCount % 25 === 0) console.log(divider() + '\n' + headerRow() + '\n' + divider());
  console.log(row(pending, next));
  pending = null;
}

function processLine(line) {
  const lm = line.match(/^\[(\S+?Z)\] (.*)$/);
  if (!lm) return;
  const [, iso, msg] = lm;
  let m;

  if ((m = msg.match(/^earliest per city: (.+?)(?:\s+\[budget.*)?$/))) {
    flush();
    const cities = {};
    for (const part of m[1].split(/\s{2,}/)) {
      const cm = part.match(/^(.+?)\(\d+\)=(\S+)$/);
      if (!cm) continue;
      const city = cm[1].trim();
      if (!CITIES.includes(city)) { CITIES.push(city); console.log(divider() + '\n' + headerRow() + '\n' + divider()); }
      cities[city] = cm[2];
    }
    pending = { time: clock(iso), cities };
    return;
  }
  if ((m = msg.match(/^sleeping ([\d.]+)s/))) return flush(clock(Date.parse(iso) + m[1] * 1000));

  if ((m = msg.match(/^booked time at (\S+) (\S+) (.+?)\((\d+)\)/))) {
    flush();
    return console.log(box(['★  ★  ★   APPOINTMENT  BOOKED   ★  ★  ★', '', `${m[1]}  at  ${m[2]}`, `${m[3]}  (facility ${m[4]})`, '', 'VERIFY  ON  USVISA-INFO.COM']));
  }
  if ((m = msg.match(/^MATCH: (\S+) at (.+)$/))) { flush(); return console.log(banner(C.bgGood, `★ Found ${m[1]} at ${m[2]} — booking now`)); }

  const show = (bg, text) => { flush(); console.log(banner(bg, text)); };
  if (/^(Blocked\/hangup|hangup on|Session\/authentication error|booking NOT confirmed|booking FAILED|couldn't read the account page)|failures in a row|sign-out NOT confirmed|sign-out failed/.test(msg)) return show(C.bgBad, '⚠ ' + msg);
  if (/^(SOFT BAN pattern|EARLIER THAN APPOINTMENT|daily budget used|REFRESH_DELAY below)/.test(msg)) return show(C.bgWarn, '! ' + msg);
  if (/^(booking confirmed|Logging in|Initializing with|Minimum date|Target date|settings updated|city has dates again|stop requested|sign-out confirmed|bot stopped)/.test(msg)) return show(C.bgInfo, `· ${clock(iso)}  ${msg}`);
}

if (!existsSync(LOG)) console.log(`${C.D}Waiting for ${LOG} — start the bot first.${C.R}`);
console.log(headerRow() + '\n' + divider());
// Replay recent history, then follow new lines as the bot writes them
let pos = 0, partial = '';
if (existsSync(LOG)) {
  const text = readFileSync(LOG, 'utf8');
  pos = Buffer.byteLength(text);
  text.trimEnd().split('\n').slice(-400).forEach(l => processLine(l.replace(/\r$/, '')));
}
flush();

// Follow the file (works the same on Windows, macOS and Linux)
setInterval(() => {
  let size;
  try { size = statSync(LOG).size; } catch { return; }
  if (size < pos) pos = 0; // the log was rotated
  if (size === pos) return;
  const buf = Buffer.alloc(size - pos);
  const fd = openSync(LOG, 'r');
  try { readSync(fd, buf, 0, buf.length, pos); } finally { closeSync(fd); }
  pos = size;
  const lines = (partial + buf.toString('utf8')).split('\n');
  partial = lines.pop();
  lines.forEach(l => processLine(l.replace(/\r$/, '')));
}, 1000);
