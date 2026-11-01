import { VisaHttpClient } from './client.js';
import { log, sleep, isSocketHangupError } from './utils.js';
import { notify } from './notify.js';
import { facilityName } from './facilities.js';
import { RequestBudget } from './budget.js';
import { currentAppointment } from './appointment.js';

const EARLY_REALERT_MS = 6 * 60 * 60 * 1000; // don't repeat the same date for a city within 6h

const FACILITY_GAP_MIN = 5;  // seconds between facility requests in one cycle
const FACILITY_GAP_MAX = 12;

// A new random order of cities on every check, so the requests don't follow
// the same pattern each time
function shuffled(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class Bot {
  constructor(config, options = {}) {
    this.config = config;
    this.dryRun = options.dryRun || false;
    this.client = new VisaHttpClient(this.config.countryCode, this.config.email, this.config.password);
    this.budget = new RequestBudget(this.config.dailyRequestCap);
    this.emptyCities = new Set(); // cities that dropped to [] after having dates
    this.hadDates = new Set();    // cities that returned dates at least once this run
    this.earlyAlerted = {};       // facilityId -> { date, at } of the last earlier-than-appointment alert
  }

  async initialize() {
    log('Initializing visa bot...');
    await this.budget.take(2); // sign-in page + form submit
    this.session = await this.client.login();
    return this.session;
  }

  // Returns { confirmed, detail }
  async logout() {
    if (!this.session) return { confirmed: false, detail: 'no open session' };
    this.budget.record(2); // sign-out + confirmation check
    const result = await this.client.logout(this.session);
    this.session = null;
    return result;
  }

  // Checks every city. A city with a date in the window is booked right away
  // (onMatch), without waiting for the rest; the remaining cities then only
  // count dates earlier than the one just booked. Returns the last booking, or null.
  async checkAvailableDate(sessionHeaders, currentBookedDate, minDate, onMatch) {
    let totalPolled = 0, totalTooLate = 0, totalTooEarly = 0;
    const earliestByFacility = {};
    const windowEnd = currentBookedDate;
    let booked = null, matched = false;

    const facilities = this._cityOrder();
    log(`check order: ${this._cityNames(facilities)}`);
    for (const [i, facilityId] of facilities.entries()) {
      // Space out requests within a cycle instead of firing them back to back
      if (i > 0) {
        const gap = FACILITY_GAP_MIN + Math.random() * (FACILITY_GAP_MAX - FACILITY_GAP_MIN);
        log(`pause ${gap.toFixed(1)}s before ${facilityName(this.config.countryCode, facilityId)}(${facilityId})`);
        await sleep(gap);
      }

      await this.budget.take();
      let dates;
      try {
        dates = await this.client.checkAvailableDate(
          sessionHeaders,
          this.config.scheduleId,
          facilityId
        );
      } catch (err) {
        // Blocks are IP/account-wide: one hangup means stop polling everything
        if (isSocketHangupError(err)) {
          const city = facilityName(this.config.countryCode, facilityId);
          log(`hangup on ${city}(${facilityId}) — aborting cycle`);
        }
        throw err;
      }

      if (!dates || dates.length === 0) {
        earliestByFacility[facilityId] = '—×0';
        continue;
      }
      totalPolled += dates.length;
      earliestByFacility[facilityId] = `${dates.slice().sort()[0]}×${dates.length}`;

      const good = dates.filter(d => {
        if (d >= currentBookedDate) { totalTooLate++; return false; }
        if (minDate && d < minDate) { totalTooEarly++; return false; }
        return true;
      });
      if (good.length) {
        good.sort();
        const candidate = { date: good[0], facilityId };
        matched = true;
        log(`MATCH: ${candidate.date} at ${facilityName(this.config.countryCode, facilityId)}(${facilityId}) — booking now`);
        if (onMatch && await onMatch(candidate)) {
          booked = candidate;
          currentBookedDate = candidate.date; // the rest of this check only looks for earlier dates
        }
      }
    }

    // Pick the next check's order now and log it, so it can be shown in advance
    this.nextOrder = shuffled(this.config.facilityId);
    log(`next check order: ${this._cityNames(this.nextOrder)}`);

    const cc = this.config.countryCode;
    const summary = Object.entries(earliestByFacility)
      .map(([f, d]) => `${facilityName(cc, f)}(${f})=${d}`)
      .join('  ');
    log(`earliest per city: ${summary}  [budget ${this.budget.used()}/${this.budget.cap}]`);
    await this._alertEmptyChanges(earliestByFacility);
    await this._alertBeatsAppointment(earliestByFacility, windowEnd, minDate);

    if (!matched) log(`no good dates — ${totalPolled} polled, ${totalTooLate} too late, ${totalTooEarly} too early`);
    return booked;
  }

  // The order picked at the end of the last check, unless the cities changed since
  _cityOrder() {
    const ids = this.config.facilityId, planned = this.nextOrder;
    const same = planned?.length === ids.length && planned.every(f => ids.includes(f));
    return same ? planned : shuffled(ids);
  }

  _cityNames(ids) {
    return ids.map(f => `${facilityName(this.config.countryCode, f)}(${f})`).join(', ');
  }

  // A city that had dates and now returns none is usually just booked out.
  // The soft-ban pattern is every city returning [] at once, after some had
  // dates - that's what alerts. "city back" is only sent after a ban alert.
  async _alertEmptyChanges(earliestByFacility) {
    const cc = this.config.countryCode;
    const entries = Object.entries(earliestByFacility);
    const allEmpty = entries.length > 0 && entries.every(([, d]) => d === '—×0');
    const dropped = [], recovered = [];
    for (const [f, d] of entries) {
      if (d !== '—×0') {
        if (this.emptyCities.has(f)) { this.emptyCities.delete(f); recovered.push(facilityName(cc, f)); }
        this.hadDates.add(f);
      } else if (this.hadDates.has(f) && !this.emptyCities.has(f)) {
        this.emptyCities.add(f);
        dropped.push(facilityName(cc, f));
      }
    }
    if (allEmpty && dropped.length && !this.banSuspected) {
      this.banSuspected = true;
      log(`SOFT BAN pattern: every city returned 0 dates (${[...this.hadDates].map(f => facilityName(cc, f)).join(', ')} had dates)`);
      await notify(this.config.ntfyTopic, 'US Visa Bot: soft ban starting', 'Every city now returns 0 dates, after some had dates — likely a soft ban. Consider pausing for a few hours.', { priority: 'high', tags: ['warning'] });
    } else if (dropped.length && !allEmpty) {
      log(`no dates left: ${dropped.join(', ')} (other cities still have dates — taken, not a ban)`);
    }
    if (recovered.length) {
      log(`city has dates again: ${recovered.join(', ')}`);
      if (this.banSuspected) {
        this.banSuspected = false;
        await notify(this.config.ntfyTopic, 'US Visa Bot: dates are back', `${recovered.join(', ')} returning dates again.`, { priority: 'low', tags: ['white_check_mark'] });
      }
    }
  }


  // A date earlier than the appointment you hold, but outside the booking window:
  // the bot won't book it, so tell the user in case they want to widen the window.
  async _alertBeatsAppointment(earliestByFacility, windowEnd, windowStart) {
    const appt = currentAppointment();
    if (!appt) return;
    const cc = this.config.countryCode;
    const now = Date.now();
    for (const [f, v] of Object.entries(earliestByFacility)) {
      const date = v.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
      if (!date || date >= appt.date) continue;
      const inWindow = date < windowEnd && (!windowStart || date >= windowStart);
      if (inWindow) continue;
      const last = this.earlyAlerted[f];
      if (last && last.date === date && now - last.at < EARLY_REALERT_MS) continue;
      this.earlyAlerted[f] = { date, at: now };
      const days = Math.round((Date.parse(appt.date) - Date.parse(date)) / 86400000);
      const city = facilityName(cc, f);
      log(`EARLIER THAN APPOINTMENT: ${city}(${f}) ${date} — ${days}d before your ${appt.date}, outside your window`);
      await notify(this.config.ntfyTopic, `Earlier date: ${city} ${date}`,
        `${days} days earlier than your appointment (${appt.date}), but outside your booking window — widen the window if you want it.`,
        { priority: 'high', tags: ['calendar', 'eyes'] });
    }
  }

  async bookAppointment(sessionHeaders, candidate) {
    this.booking = true; // a stop request waits for this to finish
    try {
      return await this._book(sessionHeaders, candidate);
    } finally {
      this.booking = false;
    }
  }

  async _book(sessionHeaders, candidate) {
    const { date, facilityId } = candidate;
    this.budget.record(); // never wait on the cap with a slot in hand
    const time = await this.client.checkAvailableTime(
      sessionHeaders,
      this.config.scheduleId,
      facilityId,
      date
    );

    if (!time) {
      log(`no available time slots for date ${date} at facility ${facilityId}`);
      return false;
    }

    if (this.dryRun) {
      log(`[DRY RUN] Would book appointment at ${date} ${time} facility ${facilityId} (not actually booking)`);
      return true;
    }

    this.budget.record(2);
    const res = await this.client.book(
      sessionHeaders,
      this.config.scheduleId,
      facilityId,
      date,
      time
    );

    const city = facilityName(this.config.countryCode, facilityId);
    if (!res.ok) {
      log(`booking FAILED for ${date} ${time} ${city}(${facilityId}): the site answered ${res.status}`);
      await notify(this.config.ntfyTopic, 'US Visa Bot: booking failed', `Tried ${date} ${time} in ${city}; the site answered ${res.status}. Your appointment wasn't changed — still watching.`, { priority: 'high', tags: ['warning'] });
      return false;
    }

    // The site can answer 200 without moving the appointment (e.g. the slot was
    // just taken), so it only counts once the account page shows the new date
    this.budget.record(2);
    let shown = null;
    try {
      shown = await this.client.consularAppointments(sessionHeaders);
    } catch (err) {
      log(`couldn't read the account page to confirm the booking: ${err.message}`);
    }
    if (!shown?.some(a => a.date === date)) {
      const seen = shown?.length ? shown.map(a => `${a.date} ${a.time}`).join(', ') : 'nothing it could read';
      log(`booking NOT confirmed for ${date} ${time} ${city}(${facilityId}): the account page shows ${seen} — check usvisa-info.com`);
      await notify(this.config.ntfyTopic, 'US Visa Bot: CHECK your appointment', `Tried to book ${date} ${time} in ${city}, but your account page shows ${seen}. Check usvisa-info.com.`, { priority: 'max', tags: ['warning', 'calendar'] });
      return false;
    }
    log(`booking confirmed: the account page shows ${date} ${time}`);
    log(`booked time at ${date} ${time} ${city}(${facilityId})`);
    await notify(
      this.config.ntfyTopic,
      'US Visa Bot BOOKED',
      `${date} ${time}\n${city} (facility ${facilityId})\nConfirmed on your account page`,
      { priority: 'max', tags: ['tada', 'calendar'] }
    );
    return true;
  }

}
