import { VisaHttpClient } from './client.js';
import { getBaseUri } from './config.js';
import { log } from './utils.js';

export class Bot {
  constructor(config) {
    this.config = config;
    this.baseUri = getBaseUri(this.config.locale);
    this.client = new VisaHttpClient(this.baseUri, this.config.email, this.config.password);
  }

  async initialize() {
    log('Initializing visa service...');
    return await this.client.login();
  }

  async checkAvailableDate(sessionHeaders, currentBookedDate, minDate) {
    const date = await this.client.checkAvailableDate(
      sessionHeaders, 
      this.config.scheduleId, 
      this.config.facilityId
    );

    if (!date) {
      log("no dates available");
      return null;
    }
    
    if (date >= currentBookedDate) {
      log(`nearest date is further than already booked (${currentBookedDate} vs ${date})`);
      return null;
    }
    
    if (minDate && date < minDate) {
      log(`nearest date is before minimum date (${date} vs ${minDate})`);
      return null;
    }

    return date;
  }

  async bookAppointment(sessionHeaders, date) {
    const time = await this.client.checkAvailableTime(
      sessionHeaders,
      this.config.scheduleId,
      this.config.facilityId,
      date
    );

    if (!time) {
      log(`no available time slots for date ${date}`);
      return false;
    }

    await this.client.book(
      sessionHeaders,
      this.config.scheduleId,
      this.config.facilityId,
      date,
      time
    );
    
    log(`booked time at ${date} ${time}`);
    return true;
  }

}