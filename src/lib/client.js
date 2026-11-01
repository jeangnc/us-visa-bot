import fetch from "node-fetch";
import cheerio from 'cheerio';
import { log } from './utils.js';
import { getBaseUri } from './config.js';
import { facilityName } from './facilities.js';

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
    this.countryCode = countryCode;
    this.email = email;
    this.password = password;
  }

  // Public API methods
  async login() {
    log('Logging in');

    const anonymousHeaders = await this._timed('GET sign-in page', this._anonymousRequest(`${this.baseUri}/users/sign_in`))
      .then(response => this._extractHeaders(response));

    const loginData = {
      'utf8': '✓',
      'user[email]': this.email,
      'user[password]': this.password,
      'policy_confirmed': '1',
      'commit': 'Sign In'
    };

    return this._timed('POST sign-in', this._submitForm(`${this.baseUri}/users/sign_in`, anonymousHeaders, loginData))
      .then(res => ({
        ...anonymousHeaders,
        'Cookie': this._extractRelevantCookies(res)
      }));
  }

  async checkAvailableDate(headers, scheduleId, facilityId) {
    const url = `${this.baseUri}/schedule/${scheduleId}/appointment/days/${facilityId}.json?appointments[expedite]=false`;
    
    return this._jsonRequest(url, headers, `GET dates ${this._city(facilityId)}`, data => {
      if (!Array.isArray(data)) return null;
      const dates = data.map(item => item.date).sort();
      return dates.length ? `${dates.length} dates, earliest ${dates[0]}` : '0 dates';
    })
      .then(data => data.map(item => item.date));
  }

  async checkAvailableTime(headers, scheduleId, facilityId, date) {
    const url = `${this.baseUri}/schedule/${scheduleId}/appointment/times/${facilityId}.json?date=${date}&appointments[expedite]=false`;
    
    return this._jsonRequest(url, headers, `GET times ${this._city(facilityId)} ${date}`, data => {
      const times = [...(data.business_times || []), ...(data.available_times || [])];
      return times.length ? `${times.length} times, first ${times[0]}` : '0 times';
    })
      .then(data => data['business_times'][0] || data['available_times'][0]);
  }

  async book(headers, scheduleId, facilityId, date, time) {
    const url = `${this.baseUri}/schedule/${scheduleId}/appointment`;

    const bookingHeaders = await this._timed('GET booking page', this._anonymousRequest(url, headers))
      .then(response => this._extractHeaders(response));

    const bookingData = {
      'utf8': '✓',
      'authenticity_token': bookingHeaders['X-CSRF-Token'],
      'confirmed_limit_message': '1',
      'use_consulate_appointment_capacity': 'true',
      'appointments[consulate_appointment][facility_id]': facilityId,
      'appointments[consulate_appointment][date]': date,
      'appointments[consulate_appointment][time]': time,
      'appointments[asc_appointment][facility_id]': '',
      'appointments[asc_appointment][date]': '',
      'appointments[asc_appointment][time]': ''
    };

    return this._timed(`POST book ${this._city(facilityId)} ${date} ${time}`, this._submitFormWithRedirect(url, bookingHeaders, bookingData));
  }

  // Signs the session out, the same as clicking "Sign Out" on the site (a plain GET),
  // then proves it: with the cookie the site handed back, the account page must
  // now redirect to the sign-in page.
  async logout(headers) {
    const out = await this._timed('GET sign-out', fetch(`${this.baseUri}/users/sign_out`, {
      redirect: 'manual',
      headers: { ...headers, 'Accept': 'text/html' }
    }));
    if (out.status >= 400) return { confirmed: false, detail: `sign-out answered ${out.status}` };

    const cookie = out.headers.get('set-cookie') ? this._extractRelevantCookies(out) : headers['Cookie'];
    const check = await this._timed('GET account check', fetch(`${this.baseUri}/account`, {
      redirect: 'manual',
      headers: { ...headers, 'Cookie': cookie, 'Accept': 'text/html' }
    }));
    const location = check.headers.get('location') || '';
    if (check.status >= 300 && check.status < 400 && location.includes('/users/sign_in')) {
      return { confirmed: true, detail: 'account page now redirects to sign-in' };
    }
    const where = location ? ` → ${location.replace(/^https?:\/\/[^/]+/, '').replace(/\d{6,}/g, '…')}` : '';
    return { confirmed: false, detail: `account page still answered ${check.status}${where}` };
  }

  // Consular appointments listed on the account page, e.g. "12 August, 2027, 07:40"
  // -> [{ date: '2027-08-12', time: '07:40' }]
  async consularAppointments(headers) {
    const res = await fetch(`${this.baseUri}/account`, { headers: { ...headers, 'Accept': 'text/html' } });
    const $ = cheerio.load(await res.text());
    if (res.url.includes('/users/sign_in')) throw new Error('session expired');
    const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    const found = [];
    for (const [, d, month, y, time] of $('.consular-appt').text().matchAll(/(\d{1,2}) ([A-Za-z]+),? (\d{4}),? (\d{1,2}:\d{2})/g)) {
      const m = months.indexOf(month.toLowerCase());
      if (m >= 0) found.push({ date: `${y}-${String(m + 1).padStart(2, '0')}-${d.padStart(2, '0')}`, time: time.padStart(5, '0') });
    }
    return found;
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

  // describe(body) adds what came back to the request's log line, e.g. "0 dates"
  async _jsonRequest(url, headers = {}, label = 'GET json', describe = null) {
    const started = Date.now();
    let res, body;
    try {
      res = await fetch(url, {
        headers: {
          ...headers,
          "Accept": "application/json",
          "X-Requested-With": "XMLHttpRequest"
        },
        cache: "no-store"
      });
      body = await res.json();
    } catch (err) {
      log(`request: ${label} → ${res ? `${res.status} ` : ''}failed after ${Date.now() - started}ms (${err.code || err.message})`);
      throw err;
    }
    const what = body?.error ? `error: ${body.error}` : describe?.(body);
    log(`request: ${label} → ${res.status} in ${Date.now() - started}ms${what ? ` · ${what}` : ''}`);
    return this._handleErrors(body);
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

  // Logs one line per request: what was asked, the HTTP status and how long it took
  async _timed(label, request) {
    const started = Date.now();
    try {
      const res = await request;
      log(`request: ${label} → ${res.status} in ${Date.now() - started}ms`);
      return res;
    } catch (err) {
      log(`request: ${label} → failed after ${Date.now() - started}ms (${err.code || err.message})`);
      throw err;
    }
  }

  _city(facilityId) {
    return `${facilityName(this.countryCode, facilityId)}(${facilityId})`;
  }

  // Private utility methods
  async _extractHeaders(res) {
    const cookies = this._extractRelevantCookies(res);
    const html = await res.text();
    const $ = cheerio.load(html);
    const csrfToken = $('meta[name="csrf-token"]').attr('content');

    return {
      ...COMMON_HEADERS,
      "Cookie": cookies,
      "X-CSRF-Token": csrfToken,
      "Referer": this.baseUri,
      "Referrer-Policy": "strict-origin-when-cross-origin"
    };
  }

  _extractRelevantCookies(res) {
    const parsedCookies = this._parseCookies(res.headers.get('set-cookie') || '');
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
