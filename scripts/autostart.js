#!/usr/bin/env node
// Start the dashboard automatically when you log in (Windows, macOS, Linux).
//   node scripts/autostart.js on    install + start now
//   node scripts/autostart.js off   remove
import { setAutostart } from '../src/lib/autostart.js';
import { DASHBOARD_URL } from '../src/lib/platform.js';

const mode = process.argv[2];
try {
  if (mode === 'on') {
    setAutostart(true);
    console.log(`Dashboard will now start at login → ${DASHBOARD_URL}`);
  } else if (mode === 'off') {
    setAutostart(false);
    console.log('Removed: the dashboard no longer starts at login.');
  } else {
    console.log('Usage: node scripts/autostart.js on|off');
    process.exit(1);
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
