import fetch from "node-fetch";
import cheerio from 'cheerio';
import { log } from './utils.js';
import { getBaseUri } from './config.js';

export class VisaHttpClient {
  constructor(countryCode, email, password) {
    this.baseUri = getBaseUri(countryCode);
    this.email = email;
    this.password = password;
  }

  async login() {
    log('Logging in');

    const anonymousHeaders = await fetch(`${this.baseUri}/users/sign_in`, {
      headers: {
        "User-Agent": "",
        "Accept": "*/*",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
      },
    }).then(response => this.extractHeaders(response));

    return fetch(`${this.baseUri}/users/sign_in`, {
      headers: Object.assign({}, anonymousHeaders, {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      }),
      method: "POST",
      body: new URLSearchParams({
        'utf8': '✓',
        'user[email]': this.email,
        'user[password]': this.password,
        'policy_confirmed': '1',
        'commit': 'Sign In'
      }),
    }).then(res => (
      Object.assign({}, anonymousHeaders, {
        'Cookie': this.extractRelevantCookies(res)
      })
    ));
  }

  async checkAvailableDate(headers, scheduleId, facilityId) {
    return fetch(`${this.baseUri}/schedule/${scheduleId}/appointment/days/${facilityId}.json?appointments[expedite]=false`, {
      headers: Object.assign({}, headers, {
        "Accept": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      }),
      cache: "no-store"
    })
      .then(r => r.json())
      .then(r => this.handleErrors(r))
      .then(d => d.map(item => item.date));
  }

  async checkAvailableTime(headers, scheduleId, facilityId, date) {
    return fetch(`${this.baseUri}/schedule/${scheduleId}/appointment/times/${facilityId}.json?date=${date}&appointments[expedite]=false`, {
      headers: Object.assign({}, headers, {
        "Accept": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      }),
      cache: "no-store",
    })
      .then(r => r.json())
      .then(r => this.handleErrors(r))
      .then(d => d['business_times'][0] || d['available_times'][0]);
  }

  async book(headers, scheduleId, facilityId, date, time) {
    const url = `${this.baseUri}/schedule/${scheduleId}/appointment`;

    const newHeaders = await fetch(url, { headers })
      .then(response => this.extractHeaders(response));

    return fetch(url, {
      method: "POST",
      redirect: "follow",
      headers: Object.assign({}, newHeaders, {
        'Content-Type': 'application/x-www-form-urlencoded',
      }),
      body: new URLSearchParams({
        'utf8': '✓',
        'authenticity_token': newHeaders['X-CSRF-Token'],
        'confirmed_limit_message': '1',
        'use_consulate_appointment_capacity': 'true',
        'appointments[consulate_appointment][facility_id]': facilityId,
        'appointments[consulate_appointment][date]': date,
        'appointments[consulate_appointment][time]': time,
        'appointments[asc_appointment][facility_id]': '',
        'appointments[asc_appointment][date]': '',
        'appointments[asc_appointment][time]': ''
      }),
    });
  }

  async extractHeaders(res) {
    const cookies = this.extractRelevantCookies(res);

    const html = await res.text();
    const $ = cheerio.load(html);
    const csrfToken = $('meta[name="csrf-token"]').attr('content');

    return {
      "Cookie": cookies,
      "X-CSRF-Token": csrfToken,
      "Referer": this.baseUri,
      "Referrer-Policy": "strict-origin-when-cross-origin",
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
      'Cache-Control': 'no-store',
      'Connection': 'keep-alive'
    };
  }

  extractRelevantCookies(res) {
    const parsedCookies = this.parseCookies(res.headers.get('set-cookie'));
    return `_yatri_session=${parsedCookies['_yatri_session']}`;
  }

  parseCookies(cookies) {
    const parsedCookies = {};

    cookies.split(';').map(c => c.trim()).forEach(c => {
      const [name, value] = c.split('=', 2);
      parsedCookies[name] = value;
    });

    return parsedCookies;
  }

  handleErrors(response) {
    const errorMessage = response['error'];

    if (errorMessage) {
      throw new Error(errorMessage);
    }

    return response;
  }
}
