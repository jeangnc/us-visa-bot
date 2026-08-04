import { VisaHttpClient } from './client.js';
import { log } from './utils.js';

export class Bot {
  constructor(config, options = {}) {
    this.config = config;
    this.dryRun = options.dryRun || false;
    this.client = new VisaHttpClient(this.config.countryCode, this.config.email, this.config.password);
  }

  async initialize() {
    log('Initializing visa bot...');
    return await this.client.login();
  }

  async checkAvailableDate(sessionHeaders, currentBookedDate, minDate, targetDate) {
    let best = null;

    for (const facilityId of this.config.facilityIds) {
      log(`checking dates for facility ${facilityId}`);
      const dates = await this.client.checkAvailableDate(
        sessionHeaders,
        this.config.scheduleId,
        facilityId
      );

      if (!dates || dates.length === 0) {
        log(`facility ${facilityId}: no dates available`);
        continue;
      }

      const sortedDates = [...dates].sort();
      const nearestAvailable = sortedDates[0];
      log(`facility ${facilityId}: nearest available date ${nearestAvailable}`);

      const goodDates = sortedDates.filter(date =>
        date < currentBookedDate &&
        (!targetDate || date <= targetDate) &&
        (!minDate || date >= minDate)
      );

      if (goodDates.length === 0) {
        log(`facility ${facilityId}: no good dates found after filtering`);
        continue;
      }

      const earliestDate = goodDates[0];
      log(`facility ${facilityId}: earliest acceptable date ${earliestDate}`);

      if (!best || earliestDate < best.date) {
        best = { date: earliestDate, facilityId };
      }
    }

    return best;
  }

  async bookAppointment(sessionHeaders, { date, facilityId }) {
    log(`checking time slots for facility ${facilityId} on ${date}`);
    const time = await this.client.checkAvailableTime(
      sessionHeaders,
      this.config.scheduleId,
      facilityId,
      date
    );

    if (!time) {
      log(`facility ${facilityId}: no available time slots on ${date}`);
      return false;
    }

    if (this.dryRun) {
      log(`[DRY RUN] Would book appointment at facility ${facilityId} ${date} ${time} (not actually booking)`);
      return true;
    }

    await this.client.book(
      sessionHeaders,
      this.config.scheduleId,
      facilityId,
      date,
      time
    );

    log(`booked time at facility ${facilityId} ${date} ${time}`);
    return true;
  }

}
