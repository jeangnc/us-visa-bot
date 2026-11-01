// Start the dashboard when you log in: a LaunchAgent on macOS, a Startup-folder
// script on Windows, an autostart entry on Linux. Only the dashboard starts;
// the bot still waits for you to press Start.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync, spawn } from 'child_process';
import { ROOT } from './logfiles.js';

const LABEL = 'com.usvisabot.dashboard';
const SERVER = path.join(ROOT, 'src', 'ui', 'server.js');
const UI_LOG = path.join(ROOT, 'logs', 'ui.log');

export function autostartFile() {
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library/LaunchAgents', `${LABEL}.plist`);
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Visa Bot dashboard.vbs');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'autostart', 'visa-bot-dashboard.desktop');
}

export const autostartEnabled = () => fs.existsSync(autostartFile());

// keepRunning: called from the dashboard itself, so don't stop the process serving it
export function setAutostart(on, { keepRunning = false } = {}) {
  const file = autostartFile();
  if (!on) {
    if (process.platform === 'darwin' && !keepRunning) launchctl('bootout', `gui/${process.getuid()}/${LABEL}`);
    fs.rmSync(file, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.mkdirSync(path.dirname(UI_LOG), { recursive: true });
  if (process.platform === 'darwin') {
    fs.writeFileSync(file, launchAgent());
    const domain = `gui/${process.getuid()}`;
    launchctl('bootout', `${domain}/${LABEL}`);
    if (!launchctl('bootstrap', domain, file)) throw new Error('Could not register the login item with launchctl.');
  } else if (process.platform === 'win32') {
    // A hidden window: wscript runs this at login without a console popping up
    const q = s => s.replace(/"/g, '""');
    fs.writeFileSync(file, [
      'Set sh = CreateObject("WScript.Shell")',
      `sh.CurrentDirectory = "${q(ROOT)}"`,
      `sh.Run """${q(process.execPath)}"" ""${q(SERVER)}""", 0, False`,
      '',
    ].join('\r\n'));
  } else {
    fs.writeFileSync(file, [
      '[Desktop Entry]', 'Type=Application', 'Name=Visa Bot dashboard',
      `Exec="${process.execPath}" "${SERVER}"`, `Path=${ROOT}`, 'X-GNOME-Autostart-enabled=true', '',
    ].join('\n'));
  }
  // launchd starts it right away on macOS; elsewhere start it now unless it's already up
  if (process.platform !== 'darwin' && !keepRunning) {
    const out = fs.openSync(UI_LOG, 'a');
    spawn(process.execPath, [SERVER], { cwd: ROOT, detached: true, stdio: ['ignore', out, out], windowsHide: true }).unref();
  }
}

function launchctl(...args) {
  try { execFileSync('launchctl', args, { stdio: 'ignore' }); return true; } catch { return false; }
}

function launchAgent() {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${esc(process.execPath)}</string>
    <string>${esc(SERVER)}</string>
  </array>
  <key>WorkingDirectory</key><string>${esc(ROOT)}</string>
  <key>RunAtLoad</key><true/>
  <!-- restart after a crash, but not after you quit it on purpose -->
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <!-- don't take a bot started from the dashboard down with it -->
  <key>AbandonProcessGroup</key><true/>
  <key>StandardOutPath</key><string>${esc(UI_LOG)}</string>
  <key>StandardErrorPath</key><string>${esc(UI_LOG)}</string>
</dict>
</plist>
`;
}
