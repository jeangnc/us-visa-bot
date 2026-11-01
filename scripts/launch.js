#!/usr/bin/env node
// Opens the dashboard, starting it in the background first if it isn't running.
// The dashboard keeps running after this window closes.
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { ROOT } from '../src/lib/logfiles.js';
import { DASHBOARD_URL, dashboardRequest, openUrl } from '../src/lib/platform.js';

const running = () => dashboardRequest('GET', '/api/status').then(r => r !== null);

if (!(await running())) {
  fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
  const out = fs.openSync(path.join(ROOT, 'logs', 'ui.log'), 'a');
  spawn(process.execPath, [path.join(ROOT, 'src', 'ui', 'server.js')],
    { cwd: ROOT, detached: true, stdio: ['ignore', out, out], windowsHide: true }).unref();
  for (let i = 0; i < 30 && !(await running()); i++) await new Promise(r => setTimeout(r, 300));
}
openUrl(DASHBOARD_URL);
console.log(`\n  ✅ US Visa Bot dashboard is open at ${DASHBOARD_URL}`);
console.log('     You can close this window — the dashboard keeps running.\n');
