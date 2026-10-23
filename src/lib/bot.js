import { VisaHttpClient } from './client.js';
import { WEEKDAYS } from './config.js';
import { log } from './utils.js';

// Based on https://github.com/jeangnc/us-visa-bot/issues/51: a hard ceiling so limited
// reschedule attempts are never spent on dates that are only slightly earlier
const toTs = (d) => Date.parse(d + 'T00:00:00Z');
const weekday = (d) => new Date(toTs(d)).getUTCDay();
// null means any day
const isAllowedDay = (d, weekdays) => !weekdays || weekdays.includes(weekday(d));

// The group page shows dates like "4 March, 2027"
const siteDate = (d) => {
  const t = new Date(toTs(d));
  return `${t.getUTCDate()} ${t.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })}, ${t.getUTCFullYear()}`;
};

// Last day of the month before `date`: after booking in November, only October is worth another attempt
export function nextMaxDate(date) {
  const d = new Date(toTs(date));
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0)).toISOString().slice(0, 10);
}

export class Bot {
  constructor(config, options = {}) {
    this.config = config;
    this.dryRun = options.dryRun || false;
    this.client = new VisaHttpClient(this.config.countryCode, this.config.email, this.config.password);
    // Consecutive empty date lists: the site's usual sign of rate limiting
    this.emptyStreak = 0;
  }

  async initialize() {
    log('Initializing visa bot...');
    return await this.client.login();
  }

  async checkAvailableDate(sessionHeaders, currentBookedDate, minDate, maxDate) {
    const dates = await this.client.checkAvailableDate(
      sessionHeaders,
      this.config.scheduleId,
      this.config.facilityId
    );

    if (!dates || dates.length === 0) {
      this.emptyStreak += 1;
      log(`no dates available (${this.emptyStreak} in a row)`);
      return null;
    }

    this.emptyStreak = 0;
    const currentTs = toTs(currentBookedDate);
    const maxTs = maxDate ? toTs(maxDate) : null;
    const minTs = minDate ? toTs(minDate) : null;

    const goodDates = dates.filter(date => {
      const dateTs = toTs(date);

      if (dateTs >= currentTs) {
        log(`date ${date} is further than already booked (${currentBookedDate})`);
        return false;
      }

      if (maxTs && dateTs > maxTs) {
        log(`date ${date} is after max date (${maxDate})`);
        return false;
      }

      if (minTs && dateTs < minTs) {
        log(`date ${date} is before minimum date (${minDate})`);
        return false;
      }

      if (!isAllowedDay(date, this.config.consulateWeekdays)) {
        log(`date ${date} is a ${WEEKDAYS[weekday(date)]}, not an allowed interview weekday`);
        return false;
      }

      return true;
    });

    if (goodDates.length === 0) {
      log("no good dates found after filtering");
      return null;
    }

    // Sort dates and return the earliest one
    goodDates.sort();
    const earliestDate = goodDates[0];

    log(`found ${goodDates.length} good dates: ${goodDates.join(', ')}, using earliest: ${earliestDate}`);
    return earliestDate;
  }

  // Returns false when nothing was submitted; exits when a submitted booking isn't confirmed
  async bookAppointment(sessionHeaders, date, maxDate) {
    const { scheduleId, facilityId, ascFacilityId } = this.config;

    // Safety re-check before booking
    if (maxDate && toTs(date) > toTs(maxDate)) {
      log(`Refusing to book ${date} because it is after max date (${maxDate})`);
      return false;
    }

    if (!isAllowedDay(date, this.config.consulateWeekdays)) {
      log(`Refusing to book ${date} because ${WEEKDAYS[weekday(date)]} is not an allowed interview weekday`);
      return false;
    }

    const time = await this.client.checkAvailableTime(sessionHeaders, scheduleId, facilityId, date);

    if (!time) {
      log(`no available time slots for date ${date}`);
      return false;
    }

    const asc = ascFacilityId ? await this.findAscSlot(sessionHeaders, date, time) : null;

    if (ascFacilityId && !asc) {
      return false;
    }

    const summary = `${date} ${time}${asc ? ` + ASC ${asc.date} ${asc.time}` : ''}`;
    log(`booking ${summary}`);

    const attemptsBefore = this.dryRun ? null : await this.client.remainingAttempts(sessionHeaders, scheduleId);
    const submitted = await this.client.book(sessionHeaders, scheduleId, facilityId, date, time, asc, this.dryRun);

    if (!submitted) {
      return false;
    }

    if (this.dryRun) {
      log(`[DRY RUN] booked ${summary}`);
      return true;
    }

    // Confirm against what the site actually shows; stop whenever the outcome is unclear
    let appointment, attemptsAfter;
    try {
      appointment = await this.client.currentAppointment(sessionHeaders, scheduleId);
      attemptsAfter = await this.client.remainingAttempts(sessionHeaders, scheduleId);
    } catch (err) {
      log(`could not verify booking ${summary} (${err.message}). Check the site manually before restarting.`);
      process.exit(1);
    }

    if (new RegExp(`\\b${siteDate(date)}`).test(appointment)) {
      log(`booked ${summary} (attempts left: ${attemptsAfter ?? 'n/a'})`);
      return true;
    }

    // Only keep looking when nothing changed and the attempt counter proves no attempt was spent
    if (!appointment || attemptsBefore === null || attemptsAfter !== attemptsBefore) {
      log(`booking NOT confirmed for ${summary}: site shows "${appointment}", attempts left ${attemptsBefore} -> ${attemptsAfter}. Check the site manually before restarting.`);
      process.exit(1);
    }

    log(`booking ${summary} was not applied (slot probably taken): site still shows "${appointment}", attempts left ${attemptsAfter}. Keep looking.`);
    return false;
  }

  // The ASC slot must be booked together, otherwise the site drops the existing ASC appointment
  async findAscSlot(sessionHeaders, date, time) {
    const { scheduleId, facilityId, ascFacilityId, ascWeekdays } = this.config;
    const query = `&consulate_id=${facilityId}&consulate_date=${date}&consulate_time=${time}`;
    const ascDates = await this.client.checkAvailableDate(sessionHeaders, scheduleId, ascFacilityId, query);

    if (!ascDates || ascDates.length === 0) {
      log(`no ASC dates available for consulate slot ${date} ${time}`);
      return null;
    }

    const ascDate = ascDates.find(d => isAllowedDay(d, ascWeekdays));

    if (!ascDate) {
      log(`no ASC dates on allowed weekdays (${ascWeekdays.map(d => WEEKDAYS[d]).join(', ')}) for consulate slot ${date} ${time}`);
      return null;
    }

    const ascTime = await this.client.checkAvailableTime(sessionHeaders, scheduleId, ascFacilityId, ascDate, query);

    if (!ascTime) {
      log(`no ASC time slots for ${ascDate}`);
      return null;
    }

    return { facilityId: ascFacilityId, date: ascDate, time: ascTime };
  }
}
