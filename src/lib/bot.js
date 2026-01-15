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

  async checkAvailableDate(sessionHeaders, currentBookedDate, minDate) {
    let best = null;

    for (const facilityId of this.config.facilityIds) {
      const dates = await this.client.checkAvailableDate(
        sessionHeaders,
        this.config.scheduleId,
        facilityId
      );

      if (!dates || dates.length === 0) {
        log(`no dates available for facility ${facilityId}`);
        continue;
      }

      const goodDates = dates.filter(date => {
        if (date >= currentBookedDate) {
        log(`facility ${facilityId}: date ${date} is further than already booked (${currentBookedDate})`);
          return false;
        }

        if (minDate && date < minDate) {
          log(`facility ${facilityId}: date ${date} is before minimum date (${minDate})`);
          return false;
        }

        return true;
      });

      if (goodDates.length === 0) {
        log(`facility ${facilityId}: no good dates found after filtering`);
        continue;
      }

      goodDates.sort();
      const earliestDate = goodDates[0];
      log(`facility ${facilityId}: found ${goodDates.length} good dates: ${goodDates.join(', ')}, earliest: ${earliestDate}`);

      if (!best || earliestDate < best.date) {
        best = { date: earliestDate, facilityId };
      }
    }

    return best;
  }

  async bookAppointment(sessionHeaders, { date, facilityId }) {
    const time = await this.client.checkAvailableTime(
      sessionHeaders,
      this.config.scheduleId,
      facilityId,
      date
    );

    if (!time) {
      log(`no available time slots for facility ${facilityId} on date ${date}`);
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
