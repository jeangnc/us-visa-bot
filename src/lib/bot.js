import { VisaHttpClient } from './client.js';
import { log, sleep, isSocketHangupError } from './utils.js';
import { facilityName } from './facilities.js';
import { RequestBudget } from './budget.js';

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
  }

  async initialize() {
    log('Initializing visa bot...');
    await this.budget.take(2); // sign-in page + form submit
    return await this.client.login();
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
      if (i > 0) await sleep(FACILITY_GAP_MIN + Math.random() * (FACILITY_GAP_MAX - FACILITY_GAP_MIN));

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

  async bookAppointment(sessionHeaders, candidate) {
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
      return false;
    }
    log(`booking confirmed: the account page shows ${date} ${time}`);
    log(`booked time at ${date} ${time} ${city}(${facilityId})`);
    return true;
  }

}
