import fetch from 'node-fetch';
import { log } from './utils.js';

const PRIORITY = { min: 1, low: 2, default: 3, high: 4, max: 5 };

// Publishes via ntfy's JSON API: unlike the Title header, JSON carries any
// character (dashes, emoji), and a non-2xx answer is reported instead of ignored.
export async function notify(topic, title, message, { priority = 'high', tags = [] } = {}) {
  if (!topic) return false;
  try {
    const res = await fetch('https://ntfy.sh/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, title, message, priority: PRIORITY[priority] || 3, tags }),
    });
    if (!res.ok) {
      log(`notify failed: ntfy answered ${res.status} ${(await res.text()).slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    log(`notify failed: ${err.message}`);
    return false;
  }
}
