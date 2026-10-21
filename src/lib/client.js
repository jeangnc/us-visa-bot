import fetch from "node-fetch";
import cheerio from 'cheerio';
import { writeFile } from 'node:fs/promises';
import { log } from './utils.js';
import { getBaseUri } from './config.js';

// Common headers
const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Cache-Control': 'no-store'
};

export class VisaHttpClient {
  constructor(countryCode, email, password) {
    this.baseUri = getBaseUri(countryCode);
    this.email = email;
    this.password = password;
  }

  // Public API methods
  async login() {
    log('Logging in');

    const anonymousHeaders = await this._anonymousRequest(`${this.baseUri}/users/sign_in`)
      .then(response => this._extractHeaders(response));

    const loginData = {
      'utf8': '✓',
      'user[email]': this.email,
      'user[password]': this.password,
      'policy_confirmed': '1',
      'commit': 'Sign In'
    };

    return this._submitForm(`${this.baseUri}/users/sign_in`, anonymousHeaders, loginData)
      .then(res => ({
        ...anonymousHeaders,
        'Cookie': this._extractRelevantCookies(res)
      }));
  }

  // `query` scopes ASC lookups to a consulate slot: &consulate_id=..&consulate_date=..&consulate_time=..
  async checkAvailableDate(headers, scheduleId, facilityId, query = '') {
    const url = `${this.baseUri}/schedule/${scheduleId}/appointment/days/${facilityId}.json?appointments[expedite]=false${query}`;

    return this._jsonRequest(url, headers)
      .then(data => data.map(item => item.date));
  }

  async checkAvailableTime(headers, scheduleId, facilityId, date, query = '') {
    const url = `${this.baseUri}/schedule/${scheduleId}/appointment/times/${facilityId}.json?date=${date}&appointments[expedite]=false${query}`;

    return this._jsonRequest(url, headers)
      .then(data => data['business_times'][0] || data['available_times'][0]);
  }

  // "You have N remaining attempt(s)" from the scheduling limit warning; null when the account has no limit
  async remainingAttempts(headers, scheduleId) {
    const { $ } = await this._anonymousRequest(`${this.baseUri}/schedule/${scheduleId}/appointment`, headers)
      .then(response => this._loadPage(response));
    const match = $('body').text().match(/You have (\d+) remaining attempt/);
    return match ? Number(match[1]) : null;
  }

  // e.g. "Consular Appointment: 4 March, 2027, 07:30 ..." as shown on the group page
  async currentAppointment(headers, scheduleId) {
    const actions = await this._anonymousRequest(`${this.baseUri}/schedule/${scheduleId}/continue_actions`, headers)
      .then(response => this._loadPage(response));
    const groupHref = actions.$('a[href*="/groups/"]').attr('href');
    if (!groupHref) return '';

    const { $ } = await this._anonymousRequest(new URL(groupHref, this.baseUri).href, actions.headers)
      .then(response => this._loadPage(response));
    return $('.consular-appt').first().text().replace(/\s+/g, ' ').trim();
  }

  // Returns true when the form was submitted (or would be, in dry-run); confirmation is up to the caller
  async book(headers, scheduleId, facilityId, date, time, asc = null, dryRun = false) {
    const url = `${this.baseUri}/schedule/${scheduleId}/appointment`;

    // Same GET forms the browser walks: limit warning ("I understand") -> applicant picker -> reschedule form
    let page = await this._anonymousRequest(`${url}?confirmed_limit_message=1&commit=Continue`, headers)
      .then(response => this._loadPage(response));

    // Group schedules: select every applicant, "Continue" stores the selection in the session
    const applicants = page.$('input[name="applicants[]"]').map((_, el) => page.$(el).val()).get();
    if (applicants.length > 0) {
      log(`group schedule, selecting applicants: ${applicants.join(', ')}`);
      const query = new URLSearchParams([
        ...applicants.map(id => ['applicants[]', id]),
        ['confirmed_limit_message', '1'],
        ['commit', 'Continue']
      ]);
      page = await this._anonymousRequest(`${url}?${query}`, page.headers)
        .then(response => this._loadPage(response));
    }

    if (page.$('#appointments_consulate_appointment_facility_id').length === 0) {
      log('reschedule form not reached, not posting');
      return false;
    }

    // Mirror the form exactly: its own token and the submit button value
    const bookingData = {
      'authenticity_token': page.$('#appointment-form input[name="authenticity_token"]').val() || page.headers['X-CSRF-Token'],
      'confirmed_limit_message': '1',
      'use_consulate_appointment_capacity': 'true',
      'appointments[consulate_appointment][facility_id]': facilityId,
      'appointments[consulate_appointment][date]': date,
      'appointments[consulate_appointment][time]': time,
      'appointments[asc_appointment][facility_id]': asc?.facilityId ?? '',
      'appointments[asc_appointment][date]': asc?.date ?? '',
      'appointments[asc_appointment][time]': asc?.time ?? '',
      'commit': page.$('#appointments_submit').val() || 'Reschedule'
    };

    if (dryRun) {
      const token = bookingData.authenticity_token ? '<ok>' : '<MISSING>';
      log(`[DRY RUN] would POST ${JSON.stringify({ ...bookingData, authenticity_token: token })}`);
      return true;
    }

    const res = await this._submitFormWithRedirect(url, page.headers, bookingData);
    // The site's response is the only record of why a booking was not applied
    await writeFile('last-booking-response.html', await res.text());
    log(`booking response: ${res.status} ${res.url} (saved to last-booking-response.html)`);
    return true;
  }

  // Private request methods
  async _anonymousRequest(url, headers = {}) {
    return fetch(url, {
      headers: {
        "User-Agent": "",
        "Accept": "*/*",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
        ...headers
      }
    });
  }

  async _jsonRequest(url, headers = {}) {
    return fetch(url, {
      headers: {
        ...headers,
        "Accept": "application/json",
        "X-Requested-With": "XMLHttpRequest"
      },
      cache: "no-store"
    })
      .then(r => r.json())
      .then(r => this._handleErrors(r));
  }

  async _submitForm(url, headers = {}, formData = {}) {
    return fetch(url, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
      },
      body: new URLSearchParams(formData)
    });
  }

  async _submitFormWithRedirect(url, headers = {}, formData = {}) {
    return fetch(url, {
      method: "POST",
      redirect: "follow",
      headers: {
        ...headers,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams(formData)
    });
  }

  // Private utility methods
  async _extractHeaders(res) {
    return (await this._loadPage(res)).headers;
  }

  // Reads the body once and returns both the session headers and the parsed page
  async _loadPage(res) {
    const cookies = this._extractRelevantCookies(res);
    const html = await res.text();
    const $ = cheerio.load(html);
    const csrfToken = $('meta[name="csrf-token"]').attr('content');

    return {
      $,
      headers: {
        ...COMMON_HEADERS,
        "Cookie": cookies,
        "X-CSRF-Token": csrfToken,
        "Referer": this.baseUri,
        "Referrer-Policy": "strict-origin-when-cross-origin"
      }
    };
  }

  _extractRelevantCookies(res) {
    const parsedCookies = this._parseCookies(res.headers.get('set-cookie'));
    return `_yatri_session=${parsedCookies['_yatri_session']}`;
  }

  _parseCookies(cookies) {
    const parsedCookies = {};

    cookies.split(';').map(c => c.trim()).forEach(c => {
      const [name, value] = c.split('=', 2);
      parsedCookies[name] = value;
    });

    return parsedCookies;
  }

  _handleErrors(response) {
    const errorMessage = response['error'];

    if (errorMessage) {
      throw new Error(errorMessage);
    }

    return response;
  }
}
