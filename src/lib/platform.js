import { spawn } from 'child_process';
import http from 'http';

export const DASHBOARD_PORT = Number(process.env.UI_PORT) || 4321;
export const DASHBOARD_URL = `http://localhost:${DASHBOARD_PORT}`;

// Opens a URL in the default browser on Windows, macOS or Linux
export function openUrl(url) {
  const [cmd, args] = process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }).on('error', () => {}).unref();
}

// Calls the local dashboard API; resolves to the parsed reply, or null if it isn't running
export function dashboardRequest(method, apiPath, body) {
  return new Promise(resolve => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: '127.0.0.1', port: DASHBOARD_PORT, path: apiPath, method, timeout: 40000,
      headers: { Host: `localhost:${DASHBOARD_PORT}`, ...(data && { 'Content-Type': 'application/json' }) } }, res => {
      let text = '';
      res.on('data', c => { text += c; });
      res.on('end', () => { try { resolve(JSON.parse(text)); } catch { resolve({}); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    if (data) req.write(data);
    req.end();
  });
}
