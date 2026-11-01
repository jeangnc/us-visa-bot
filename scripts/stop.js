#!/usr/bin/env node
// Stops the dashboard and the bot (the bot signs out of the visa site first).
import fs from 'fs';
import path from 'path';
import { ROOT } from '../src/lib/logfiles.js';
import { dashboardRequest } from '../src/lib/platform.js';
import { STOP_FILE } from '../src/lib/utils.js';

const PID = path.join(ROOT, 'bot.pid');
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

// The dashboard stops the bot itself (waiting for the sign-out), then quits
const reply = await dashboardRequest('POST', '/api/quit', { stopBot: true });
if (reply) {
  console.log(`  ■ Dashboard stopped${reply.botStopped ? '\n  ■ Bot signed out and stopped' : ''}`);
  process.exit(0);
}
console.log('  · Dashboard wasn\'t running');

const pid = Number(fs.existsSync(PID) && fs.readFileSync(PID, 'utf8').trim());
if (pid && alive(pid)) {
  console.log('  … Signing out and stopping the bot');
  fs.writeFileSync(STOP_FILE, '');
  for (let i = 0; i < 60 && alive(pid); i++) await new Promise(r => setTimeout(r, 500));
  if (alive(pid)) process.kill(pid);
  fs.rmSync(PID, { force: true });
  console.log('  ■ Bot stopped');
} else {
  console.log('  · Bot wasn\'t running');
}
