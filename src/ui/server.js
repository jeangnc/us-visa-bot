import http from 'http';
import fs from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';
import { facilityName, FACILITY_NAMES } from '../lib/facilities.js';
import { notify } from '../lib/notify.js';
import { readAllLines, rotateIfNeeded } from '../lib/logfiles.js';
import { currentAppointment, APPT_FILE as APPT } from '../lib/appointment.js';
import { autostartEnabled, setAutostart as writeAutostart } from '../lib/autostart.js';
import { DASHBOARD_PORT as PORT, DASHBOARD_URL as URL_, openUrl } from '../lib/platform.js';
import { STOP_FILE } from '../lib/utils.js';
import { findRequest } from '../lib/requestlog.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(ROOT, '.env') });
const LOG = path.join(ROOT, 'bot.log');
const PID = path.join(ROOT, 'bot.pid');
const BUDGET = path.join(ROOT, '.request-budget.json');
const PAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.html');
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ENV = path.join(ROOT, '.env');
// Start-at-login (Windows, macOS, Linux), see src/lib/autostart.js
function setAutostart(on) {
  try {
    writeAutostart(on, { keepRunning: true });
    return { ok: true, autostart: autostartEnabled() };
  } catch (err) {
    return { error: err.message.slice(0, 200) };
  }
}

function runningPid() {
  try {
    const pid = Number(fs.readFileSync(PID, 'utf8').trim());
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

function tailLines(n) {
  try {
    const lines = fs.readFileSync(LOG, 'utf8').trimEnd().split('\n');
    return lines.slice(-n);
  } catch {
    return [];
  }
}

const TS_RE = /^\[([^\]]+)\] (.*)$/;
const ts = line => { const m = line.match(TS_RE); return m ? { at: m[1], msg: m[2] } : null; };

function parseCities(msg) {
  const cities = [];
  for (const [, name, id, v] of msg.matchAll(/([A-Za-z ]+)\((\d+)\)=(\S+)/g)) {
    if (!/^(—|\d{4}-\d{2}-\d{2})/.test(v)) continue; // e.g. old "COOL~15m" entries: city wasn't checked
    const [date, count] = v.startsWith('—') ? [null, 0] : v.split('×');
    cities.push({ name: name.trim(), id, date, count: Number(count) || 0 });
  }
  return cities;
}

// Turns raw log lines into human-readable events
function toEvent(at, msg) {
  let m;
  // Session events (icon: signin / signout / stop) get their own look in the table
  if (msg.startsWith('Logging in')) return { at, kind: 'session', icon: 'signin', text: 'Signed in to the visa site' };
  if (msg === 'stop requested — signing out') return { at, kind: 'session', icon: 'stop', text: 'Stop requested — signing out of the visa site' };
  if (msg.startsWith('sign-out confirmed')) return { at, kind: 'session', icon: 'signout', text: 'Signed out of the visa site · verified' };
  if ((m = msg.match(/^sign-out (?:NOT confirmed|failed): (.*)$/))) return { at, kind: 'bad', icon: 'signout', text: `Sign-out NOT confirmed — ${m[1]}. Sign out manually on the site to be sure.` };
  if (msg === 'bot stopped') return { at, kind: 'session', icon: 'stop', text: 'Bot stopped' };
  if ((m = msg.match(/^booking FAILED for (\S+) (\S+) (.+?)\(\d+\): (.*)$/))) return { at, kind: 'bad', text: `Booking ${m[1]} ${m[2]} in ${m[3]} failed (${m[4]}) — your appointment wasn't changed` };
  if ((m = msg.match(/^booking NOT confirmed for (\S+) (\S+) (.+?)\(\d+\): the account page shows (.*?) — /))) return { at, kind: 'bad', text: `Booking ${m[1]} ${m[2]} in ${m[3]} NOT confirmed — your account page shows ${m[4]}. Check usvisa-info.com` };
  if ((m = msg.match(/^booked time at (\S+) (\S+) (.+)$/))) return { at, kind: 'good', icon: 'booked', text: `Booked ${m[1]} at ${m[2]} — ${m[3].replace(/\(\d+\)/, '')}` };
  if ((m = msg.match(/^MATCH: (\S+) at (.+)$/))) return { at, kind: 'good', icon: 'found', text: `Found ${m[1]} in ${m[2].replace(/\(\d+\)/, '').replace(/ — booking now$/, '')}` };
  if ((m = msg.match(/^\[DRY RUN\] Would book appointment at (\S+) (\S+)/))) return { at, kind: 'warn', text: `Dry run: would have booked ${m[1]} ${m[2]}` };
  if ((m = msg.match(/^EARLIER THAN APPOINTMENT: (.+?)\(\d+\) (\S+) — (\d+)d before/))) return { at, kind: 'early', text: `${m[1]} had ${m[2]} — ${m[3]} days earlier than your appointment (outside your window)` };
  // older bot versions flagged any single city that dropped to 0; that's usually just booked out
  if ((m = msg.match(/^SOFT BAN pattern: (.+?) had dates, now returning 0$/))) return { at, kind: 'info', text: `${m[1]} returned 0 dates` };
  if (/^SOFT BAN pattern/.test(msg)) return { at, kind: 'bad', text: 'Every city returned 0 dates — possible soft ban' };
  if ((m = msg.match(/^no dates left: (.+?) \(/))) return { at, kind: 'info', text: `${m[1]}: no dates left (the last one was taken)` };
  if ((m = msg.match(/^city has dates again: (.+)$/))) return { at, kind: 'good', text: `${m[1]} returning dates again` };
  if (msg.startsWith('connection lost while the computer was asleep')) return { at, kind: 'info', text: 'Computer was asleep — reconnecting' };
  if ((m = msg.match(/^Blocked\/hangup: .*Backing off (\d+)m/))) return { at, kind: 'bad', text: `Site dropped the connection — pausing ${m[1] / 60}h` };
  if ((m = msg.match(/^Session\/authentication error: (.*?)\.? Re-login in (\d+)m/))) {
    const why = /session expired/i.test(m[1]) ? 'Session expired' : 'Sign-in problem';
    return { at, kind: 'warn', text: `${why} — signing in again in ${m[2]} min` };
  }
  if ((m = msg.match(/^settings updated: (.*)$/))) return { at, kind: 'info', text: `Settings applied — ${m[1].replace(/\b(\d+)\b/g, id => facilityName(process.env.COUNTRY_CODE, id).startsWith('#') ? id : facilityName(process.env.COUNTRY_CODE, id))}` };
  if (/failures in a row/.test(msg)) return { at, kind: 'bad', text: 'Stopped after repeated failures — check the site manually' };
  if ((m = msg.match(/^daily budget used \((\d+)\/(\d+)\)/))) return { at, kind: 'warn', text: `Daily limit reached (${m[1]}/${m[2]}) — waiting for checks to free up` };
  return null;
}

// A request, a pause between cities, the rest between checks, or the order of cities
function activity(p) {
  let m;
  if ((m = p.msg.match(/^request: (\S+) (.+?) → (?:(\d+) in (\d+)ms(?: · (.*))?|(?:(\d+) )?failed after (\d+)ms \((.*)\))$/)))
    return { at: p.at, kind: 'req', method: m[1], what: m[2], status: Number(m[3] ?? m[6]) || null, ms: Number(m[4] ?? m[7]), got: m[5] || null, error: m[8] || null };
  if ((m = p.msg.match(/^pause ([\d.]+)s before (.+)$/))) return { at: p.at, kind: 'pause', secs: Number(m[1]), what: m[2] };
  if ((m = p.msg.match(/^sleeping ([\d.]+)s/))) return { at: p.at, kind: 'rest', secs: Number(m[1]) };
  if ((m = p.msg.match(/^(next )?check order: (.+)$/))) return { at: p.at, kind: m[1] ? 'next-order' : 'order', cities: m[2].split(', ').map(c => c.replace(/\(\d+\)$/, '')) };
  return null;
}

// Everything the bot did for one check: from the previous check's summary line to this one's
function checkActivity(at) {
  const lines = readAllLines({ days: 14 }).map(ts).filter(Boolean);
  const end = lines.findIndex(p => p.at === at && p.msg.startsWith('earliest per city:'));
  if (end < 0) return { missing: true };
  let start = end - 1;
  while (start >= 0 && !lines[start].msg.startsWith('earliest per city:') && !/^Initializing with current date/.test(lines[start].msg)) start--;
  // Only what the check itself did: signing in/out has its own rows in the table
  const items = lines.slice(start + 1, end).map(activity)
    .filter(a => a && a.kind !== 'next-order' && a.kind !== 'rest' && !(a.kind === 'req' && /^(sign-in|sign-out|account check)/.test(a.what)));
  return { items };
}

function status() {
  dotenv.config({ path: ENV, override: true }); // pick up hand edits to .env too
  const lines = tailLines(4000);
  const pid = runningPid();

  // Everything since the most recent start
  // A re-login after a backoff logs a fresh "Initializing" too; treat it as the same run
  let startIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('Initializing with current date')) continue;
    startIdx = i;
    if (!/Re-login in|Backing off/.test(lines[i - 1] || '')) break;
  }
  const run = startIdx >= 0 ? lines.slice(startIdx) : [];
  const parsed = run.map(ts).filter(Boolean);

  const startedAt = parsed[0]?.at || null;
  const current = parsed[0]?.msg.match(/current date (\d{4}-\d{2}-\d{2})/)?.[1] || null;
  const min = parsed.find(p => p.msg.startsWith('Minimum date:'))?.msg.match(/(\d{4}-\d{2}-\d{2})/)?.[1] || null;
  const dryRun = parsed.some(p => p.msg.includes('[DRY RUN MODE]'));

  const checks = parsed.filter(p => p.msg.startsWith('earliest per city:'))
    .map(p => ({ at: p.at, cities: parseCities(p.msg) }));

  // What the bot is doing right now, judged from its latest line
  let phase = pid ? 'checking' : 'stopped', until = null, since = null;
  const lastLine = parsed[parsed.length - 1];
  if (pid && lastLine) {
    const t = Date.parse(lastLine.at);
    since = lastLine.at;
    let m;
    if ((m = lastLine.msg.match(/^sleeping ([\d.]+)s/))) { phase = 'waiting'; until = new Date(t + m[1] * 1000).toISOString(); }
    else if ((m = lastLine.msg.match(/Backing off (\d+)m/))) { phase = 'paused'; until = new Date(t + m[1] * 60000).toISOString(); }
    else if ((m = lastLine.msg.match(/Re-login in (\d+)m/))) { phase = 'relogin'; until = new Date(t + m[1] * 60000).toISOString(); }
    else if ((m = lastLine.msg.match(/sleeping ([\d.]+)h until slots/))) { phase = 'budget'; until = new Date(t + m[1] * 3600000).toISOString(); }
    else if (lastLine.msg.startsWith('Logging in') || lastLine.msg.startsWith('Initializing')) phase = 'signing-in';
  }

  let budgetUsed = 0;
  try {
    const cutoff = Date.now() - 24 * 3600 * 1000;
    budgetUsed = JSON.parse(fs.readFileSync(BUDGET, 'utf8')).filter(t => t >= cutoff).length;
  } catch {}

  const all = lines.map(ts).filter(Boolean);
  const allEvents = all.map(p => toEvent(p.at, p.msg)).filter(Boolean);
  const checkLog = [];
  for (let i = 0; i < all.length; i++) {
    const p = all[i];
    if (!p.msg.startsWith('earliest per city:')) continue;
    const sleepLine = all[i + 1]?.msg.startsWith('no good dates') ? all[i + 2] : all[i + 1];
    const m = sleepLine?.msg.match(/^sleeping ([\d.]+)s/);
    checkLog.push({ at: p.at, cities: parseCities(p.msg), next: m ? new Date(Date.parse(sleepLine.at) + m[1] * 1000).toISOString() : null });
  }

  // Every request the bot sent, plus the random pauses between cities
  const requests = all.map(activity).filter(Boolean);
  // Drop rests from before request logging existed, so the list starts clean
  const firstReq = requests.findIndex(r => r.kind === 'req');

  return {
    requests: firstReq < 0 ? [] : requests.slice(firstReq).slice(-400),
    pid, phase, until, since, dryRun, current, min, startedAt,
    window: { from: process.env.BOOK_FROM || null, to: process.env.BOOK_TO || null, mode: process.env.BOOK_MODE || 'book' },
    checksThisRun: checks.length,
    latest: checks[checks.length - 1] || null,
    previous: checks[checks.length - 2] || null,
    history: checks.slice(-40),
    events: allEvents.slice(-150),
    checkLog: checkLog.slice(-300),
    budgetUsed,
    budgetCap: Number(process.env.DAILY_REQUEST_CAP) || 500,
    allCities: Object.entries(FACILITY_NAMES[process.env.COUNTRY_CODE] || {}).map(([id, name]) => ({ id, name })),
    watching: String(process.env.FACILITY_ID || '').split(',').map(s => s.trim()).filter(Boolean)
      .map(id => ({ id, name: facilityName(process.env.COUNTRY_CODE, id) })),
    bookings: allEvents.filter(e => e.text.startsWith('Booked ')).slice(-3).reverse(),
    log: lines.slice(-300),
    appointment: currentAppointment(),
  };
}

function setAppointment({ date, time, city }) {
  if (date === null) { fs.rmSync(APPT, { force: true }); return { ok: true }; }
  if (!DATE_RE.test(date || '')) return { error: 'date must be YYYY-MM-DD' };
  const clean = v => (typeof v === 'string' ? v.slice(0, 40) : null);
  fs.writeFileSync(APPT, JSON.stringify({ date, time: clean(time), city: clean(city) }));
  return { ok: true };
}

// ---------- history across bot.log + archives
function allChecks(days) {
  const out = [];
  for (const line of readAllLines({ days })) {
    const p = ts(line);
    if (p && p.msg.startsWith('earliest per city:')) out.push({ at: p.at, cities: parseCities(p.msg) });
  }
  return out;
}

// An "opening" = a city's earliest date moved earlier than at the previous check,
// i.e. someone cancelled. We also measure how long it stayed before being taken.
function insights() {
  const checks = allChecks(30);
  const appt = currentAppointment();
  const last = {}, openings = [];
  const checksByHour = Array(24).fill(0), checksByDay = Array(7).fill(0);
  checks.forEach((ch, idx) => {
    const t = new Date(ch.at);
    checksByHour[t.getHours()]++; checksByDay[t.getDay()]++;
    for (const c of ch.cities) {
      const prev = last[c.name];
      if (c.date && prev?.date && c.date < prev.date && Date.parse(ch.at) - Date.parse(prev.at) < 30 * 60000) {
        // Find when this city's earliest date was no longer this early
        let gone = null;
        for (let k = idx + 1; k < checks.length; k++) {
          const later = checks[k].cities.find(x => x.name === c.name);
          if (!later) continue;
          if (!later.date || later.date > c.date) { gone = checks[k].at; break; }
        }
        openings.push({
          at: ch.at, city: c.name, date: c.date, prevDate: prev.date,
          daysEarlier: Math.round((Date.parse(prev.date) - Date.parse(c.date)) / 86400000),
          lastedMin: gone ? Math.round((Date.parse(gone) - Date.parse(ch.at)) / 60000) : null,
          beatsAppt: !!(appt && c.date < appt.date),
        });
      }
      if (c.date) last[c.name] = { date: c.date, at: ch.at };
      else delete last[c.name];
    }
  });
  const byHour = Array(24).fill(0), byDay = Array(7).fill(0), byCity = {};
  for (const o of openings) {
    const t = new Date(o.at);
    byHour[t.getHours()]++; byDay[t.getDay()]++;
    byCity[o.city] = (byCity[o.city] || 0) + 1;
  }
  const lasted = openings.map(o => o.lastedMin).filter(v => v !== null).sort((a, b) => a - b);
  const best = {};
  for (const ch of checks) for (const c of ch.cities) if (c.date && (!best[c.name] || c.date < best[c.name].date)) best[c.name] = { date: c.date, at: ch.at };
  return {
    since: checks[0]?.at || null, checks: checks.length,
    openings: openings.slice(-40).reverse(), total: openings.length,
    byHour, byDay, checksByHour, checksByDay, byCity, best,
    medianLastedMin: lasted.length ? lasted[Math.floor(lasted.length / 2)] : null,
    beatsAppt: openings.filter(o => o.beatsAppt).length,
    refreshDelay: String(process.env.REFRESH_DELAY || ''),
    appointment: appt,
  };
}

// ---------- .env settings (credentials are never read out or written here)
function getSettings() {
  const cc = process.env.COUNTRY_CODE;
  const on = String(process.env.FACILITY_ID || '').split(',').map(s => s.trim()).filter(Boolean);
  const known = Object.keys(FACILITY_NAMES[cc] || {});
  const ids = [...new Set([...known, ...on])];
  const [rmin, rmax = rmin] = String(process.env.REFRESH_DELAY || '3').split('-').map(Number);
  return {
    cities: ids.map(id => ({ id, name: facilityName(cc, id), on: on.includes(id) })),
    refreshMin: rmin, refreshMax: rmax,
    dailyCap: Number(process.env.DAILY_REQUEST_CAP) || 500,
    ntfyTopic: process.env.NTFY_TOPIC || '',
    countryCode: cc || '',
    autostart: autostartEnabled(),
    restartNeeded: !!runningPid(),
  };
}

function writeEnv(updates) {
  let text = fs.existsSync(ENV) ? fs.readFileSync(ENV, 'utf8') : '';
  for (const [k, v] of Object.entries(updates)) {
    const line = `${k}=${v}`;
    const re = new RegExp(`^${k}=.*$`, 'm');
    text = re.test(text) ? text.replace(re, line) : text.replace(/\n?$/, '\n') + line + '\n';
    process.env[k] = String(v);
  }
  fs.writeFileSync(ENV, text);
}

function setSettings(b) {
  const known = getSettings().cities.map(c => c.id);
  const ids = Array.isArray(b.cities) ? b.cities.map(String).filter(id => known.includes(id)) : [];
  if (!ids.length) return { error: 'pick at least one city' };
  const rmin = Math.round(Number(b.refreshMin)), rmax = Math.round(Number(b.refreshMax));
  if (!(rmin >= 60 && rmax >= rmin && rmax <= 3600)) return { error: 'time between checks: 60s minimum, max ≥ min, up to 3600s' };
  const cap = Math.round(Number(b.dailyCap));
  if (!(cap >= 20 && cap <= 3000)) return { error: 'daily cap must be 20–3000' };
  const topic = String(b.ntfyTopic || '').trim();
  if (topic && !/^[A-Za-z0-9_-]{1,64}$/.test(topic)) return { error: 'alert topic: letters, numbers, - and _ only' };
  writeEnv({ FACILITY_ID: ids.join(','), REFRESH_DELAY: `${rmin}-${rmax}`, DAILY_REQUEST_CAP: cap, NTFY_TOPIC: topic });
  return { ok: true, restartNeeded: !!runningPid() };
}

function start({ current, min, dryRun }) {
  if (runningPid()) return { error: 'already running' };
  if (!DATE_RE.test(current || '')) return { error: 'cutoff date must be YYYY-MM-DD' };
  if (min && !DATE_RE.test(min)) return { error: 'minimum date must be YYYY-MM-DD' };
  const args = ['src/index.js', '-c', current];
  if (min) args.push('-m', min);
  if (dryRun) args.push('--dry-run');
  // Remember the window for next time (the dashboard form and the command line both use it)
  writeEnv({ BOOK_FROM: min || '', BOOK_TO: new Date(Date.parse(current) - 86400000).toISOString().slice(0, 10), BOOK_MODE: dryRun ? 'watch' : 'book' });
  const out = fs.openSync(LOG, 'a');
  const child = spawn(process.execPath, args, { cwd: ROOT, detached: true, stdio: ['ignore', out, out], windowsHide: true });
  child.unref();
  fs.writeFileSync(PID, String(child.pid));
  return { ok: true, pid: child.pid };
}

// Ask the bot to stop via the stop-request file (Windows can't send a catchable
// signal); it signs out first, so wait up to 30s before forcing it
async function stop() {
  const pid = runningPid();
  if (!pid) return { error: 'not running' };
  fs.writeFileSync(STOP_FILE, '');
  const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
  for (let i = 0; i < 60 && alive(); i++) await new Promise(r => setTimeout(r, 500));
  if (alive()) process.kill(pid);
  fs.rmSync(PID, { force: true });
  return { ok: true };
}

function readBody(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e4) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}

// Other websites open in the browser must not be able to drive this server
function sameOrigin(req) {
  const origin = req.headers.origin;
  const okOrigin = !origin || origin === `http://localhost:${PORT}` || origin === `http://127.0.0.1:${PORT}`;
  const okHost = [`localhost:${PORT}`, `127.0.0.1:${PORT}`].includes(req.headers.host);
  return okOrigin && okHost;
}

const server = http.createServer(async (req, res) => {
  const json = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (!sameOrigin(req)) return json(403, { error: 'forbidden' });
  // JSON content type forces a CORS preflight for cross-site POSTs, which this server never approves
  if (req.method === 'POST' && !String(req.headers['content-type']).startsWith('application/json')) return json(415, { error: 'expected JSON' });
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(PAGE));
  }
  if (req.method === 'GET' && req.url === '/api/status') return json(200, status());
  if (req.method === 'POST' && req.url === '/api/start') { const r = start(await readBody(req)); return json(r.error ? 400 : 200, r); }
  if (req.method === 'POST' && req.url === '/api/appointment') { const r = setAppointment(await readBody(req)); return json(r.error ? 400 : 200, r); }
  if (req.method === 'GET' && req.url === '/api/insights') return json(200, insights());
  if (req.method === 'GET' && req.url.startsWith('/api/check?')) {
    return json(200, checkActivity(new URL(req.url, 'http://localhost').searchParams.get('at') || ''));
  }
  if (req.method === 'GET' && req.url.startsWith('/api/request?')) {
    const q = new URL(req.url, 'http://localhost').searchParams;
    return json(200, findRequest(q.get('label') || '', q.get('at') || '') || { missing: true });
  }
  if (req.method === 'GET' && req.url === '/api/settings') return json(200, getSettings());
  if (req.method === 'POST' && req.url === '/api/settings') { const r = setSettings(await readBody(req)); return json(r.error ? 400 : 200, r); }
  if (req.method === 'POST' && req.url === '/api/test-notify') {
    if (!process.env.NTFY_TOPIC) return json(400, { error: 'no alert topic set' });
    const ok = await notify(process.env.NTFY_TOPIC, 'US Visa Bot — test 🔔', 'Alerts are working.', { priority: 'default', tags: ['bell'] });
    return ok ? json(200, { ok: true }) : json(502, { error: 'ntfy did not accept the message (check your internet or topic)' });
  }
  if (req.method === 'POST' && req.url === '/api/autostart') {
    const r = await setAutostart(!!(await readBody(req)).on);
    return json(r.error ? 500 : 200, r);
  }
  if (req.method === 'POST' && req.url === '/api/quit') {
    const { stopBot } = await readBody(req);
    const botStopped = stopBot && runningPid() ? !(await stop()).error : false;
    json(200, { ok: true, botStopped });
    // exit 0 = deliberate quit, so a start-at-login item doesn't relaunch it
    setTimeout(() => process.exit(0), 200);
    return;
  }
  if (req.method === 'POST' && req.url === '/api/stop') { const r = await stop(); return json(r.error ? 400 : 200, r); }
  json(404, { error: 'not found' });
});

// Closing the Terminal window that started us sends SIGHUP; keep running
process.on('SIGHUP', () => {});

const rotate = () => { try { const f = rotateIfNeeded(); if (f) console.log(`archived log to ${f}`); } catch (e) { console.error('log rotation failed:', e.message); } };
rotate();
setInterval(rotate, 10 * 60 * 1000);

const openBrowser = () => { if (process.argv.includes('--open')) openUrl(URL_); };

server.on('error', err => {
  // Already running (e.g. started at login): just bring it up in the browser
  if (err.code === 'EADDRINUSE') {
    console.log(`Dashboard already running at ${URL_}`);
    openBrowser();
    process.exit(0);
  }
  throw err;
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Visa bot dashboard: ${URL_}`);
  openBrowser();
});
