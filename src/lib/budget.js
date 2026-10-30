import fs from 'fs';
import { log, sleep } from './utils.js';

const WINDOW_MS = 24 * 60 * 60 * 1000;
const STATE_FILE = new URL('../../.request-budget.json', import.meta.url);

// Rolling 24h request counter, persisted so restarts don't reset it
export class RequestBudget {
  constructor(cap) {
    this.cap = cap;
    this.stamps = this._load();
  }

  used() {
    this._prune();
    return this.stamps.length;
  }

  // Blocks until a request slot is free, then records it
  async take(n = 1) {
    this._prune();
    while (this.stamps.length + n > this.cap) {
      const waitMs = this.stamps[0] + WINDOW_MS - Date.now() + 1000;
      log(`daily budget used (${this.stamps.length}/${this.cap}) — sleeping ${(waitMs / 3600000).toFixed(1)}h until slots free up`);
      await sleep(waitMs / 1000);
      this._prune();
    }
    this.record(n);
  }

  // Counts requests without ever waiting (used for booking)
  record(n = 1) {
    const now = Date.now();
    for (let i = 0; i < n; i++) this.stamps.push(now);
    this._save();
  }

  _prune() {
    const cutoff = Date.now() - WINDOW_MS;
    while (this.stamps.length && this.stamps[0] < cutoff) this.stamps.shift();
  }

  _load() {
    try {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')).filter(Number.isFinite);
    } catch {
      return [];
    }
  }

  _save() {
    try {
      fs.writeFileSync(STATE_FILE, JSON.stringify(this.stamps));
    } catch (err) {
      log(`budget save failed: ${err.message}`);
    }
  }
}
