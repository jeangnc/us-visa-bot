import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { Response } from 'node-fetch';
import { Bot, nextMaxDate } from '../src/lib/bot.js';
import { VisaHttpClient } from '../src/lib/client.js';
import { parseWeekdays } from '../src/lib/config.js';

const config = { scheduleId: '1', facilityId: '56', ascFacilityId: '60', countryCode: 'br' };
const APPLIED = 'Consular Appointment: 10 November, 2026, 08:30 São Paulo - SP local time';
const UNCHANGED = 'Consular Appointment: 4 March, 2027, 07:30 São Paulo - SP local time';

function makeBot({ dates = [], ascDates = ['2026-10-27'], appointment = APPLIED, attempts = [3, 2], overrides = {} } = {}) {
  const bot = new Bot({ ...config, ...overrides });
  const booked = [];
  const left = [...attempts];
  bot.client = {
    checkAvailableDate: async (h, s, facilityId) => (facilityId === config.ascFacilityId ? ascDates : dates),
    checkAvailableTime: async () => '08:30',
    remainingAttempts: async () => left.shift(),
    currentAppointment: async () => {
      if (appointment instanceof Error) throw appointment;
      return appointment;
    },
    book: async (...args) => { booked.push(args); return true; }
  };
  return { bot, booked };
}

const stubExit = (t) => t.mock.method(process, 'exit', (code) => { throw new Error(`exit ${code}`); });

test('ceiling steps down to the end of the previous month', () => {
  assert.equal(nextMaxDate('2026-11-10'), '2026-10-31');
  assert.equal(nextMaxDate('2026-10-28'), '2026-09-30');
  assert.equal(nextMaxDate('2027-01-15'), '2026-12-31');
});

test('lists dates before current and within the ceiling, earliest first', async () => {
  const { bot } = makeBot({ dates: ['2027-01-05', '2026-11-10', '2026-10-29', '2027-03-10'] });
  assert.deepEqual(await bot.checkAvailableDates({}, '2027-03-04', undefined, '2026-11-30'), ['2026-10-29', '2026-11-10']);
});

test('ignores dates after the ceiling (January when only Oct/Nov count)', async () => {
  const { bot } = makeBot({ dates: ['2026-12-01', '2027-01-05'] });
  assert.deepEqual(await bot.checkAvailableDates({}, '2027-03-04', undefined, '2026-11-30'), []);
});

test('without a max date any earlier date counts', async () => {
  const { bot } = makeBot({ dates: ['2027-03-01'] });
  assert.deepEqual(await bot.checkAvailableDates({}, '2027-03-04', undefined, undefined), ['2027-03-01']);
});

test('without ASC_FACILITY_ID books the consulate only', async () => {
  const { bot, booked } = makeBot({ overrides: { ascFacilityId: undefined } });
  assert.equal(await bot.bookAppointment({}, '2026-11-10'), true);
  assert.equal(booked[0][5], null);
});

test('after booking November, another November date is ignored', async () => {
  const { bot } = makeBot({ dates: ['2026-11-05'] });
  assert.deepEqual(await bot.checkAvailableDates({}, '2026-11-20', undefined, nextMaxDate('2026-11-20')), []);
});

test('refuses to book after the ceiling', async () => {
  const { bot, booked } = makeBot();
  assert.equal(await bot.bookAppointment({}, '2026-12-15', '2026-11-30'), null);
  assert.equal(booked.length, 0);
});

test('never books without an ASC (CASV) slot', async () => {
  const { bot, booked } = makeBot({ ascDates: [] });
  assert.equal(await bot.bookAppointment({}, '2026-11-10', '2026-11-30'), null);
  assert.equal(booked.length, 0);
});

test('books consulate and ASC together and confirms on the group page', async () => {
  const { bot, booked } = makeBot();
  assert.equal(await bot.bookAppointment({}, '2026-11-10', '2026-11-30'), true);
  assert.deepEqual(booked[0].slice(1, 6), ['1', '56', '2026-11-10', '08:30', { facilityId: '60', date: '2026-10-27', time: '08:30' }]);
});

test('does not mistake 14 March for 4 March', async (t) => {
  stubExit(t);
  const { bot } = makeBot({ appointment: 'Consular Appointment: 14 March, 2027, 07:30', attempts: [3, 3] });
  assert.equal(await bot.bookAppointment({}, '2027-03-04'), false);
});

test('keeps looking when the booking was not applied and no attempt was spent', async () => {
  const { bot } = makeBot({ appointment: UNCHANGED, attempts: [3, 3] });
  assert.equal(await bot.bookAppointment({}, '2026-11-10', '2026-11-30'), false);
});

test('stops when the booking was not applied but the attempt counter changed', async (t) => {
  stubExit(t);
  const { bot } = makeBot({ appointment: UNCHANGED, attempts: [3, 2] });
  await assert.rejects(bot.bookAppointment({}, '2026-11-10', '2026-11-30'), /exit 1/);
});

test('stops when the attempt counter cannot be read', async (t) => {
  stubExit(t);
  const { bot } = makeBot({ appointment: UNCHANGED, attempts: [null, null] });
  await assert.rejects(bot.bookAppointment({}, '2026-11-10', '2026-11-30'), /exit 1/);
});

test('stops when the result cannot be verified', async (t) => {
  stubExit(t);
  const { bot } = makeBot({ appointment: new Error('socket hang up') });
  await assert.rejects(bot.bookAppointment({}, '2026-11-10', '2026-11-30'), /exit 1/);
});

test('counts consecutive empty date lists and resets when dates come back', async () => {
  const lists = [[], [], ['2027-03-10']];
  const { bot } = makeBot();
  bot.client.checkAvailableDate = async () => lists.shift();

  await bot.checkAvailableDates({}, '2027-03-04');
  await bot.checkAvailableDates({}, '2027-03-04');
  assert.equal(bot.emptyStreak, 2);

  await bot.checkAvailableDates({}, '2027-03-04');
  assert.equal(bot.emptyStreak, 0);
});

test('parses weekday lists, "all" and unset mean any day', (t) => {
  assert.deepEqual(parseWeekdays('mon,wed', 'X'), [1, 3]);
  assert.deepEqual(parseWeekdays(' Mon , WED ', 'X'), [1, 3]);
  assert.equal(parseWeekdays('all', 'X'), null);
  assert.equal(parseWeekdays(' ALL ', 'X'), null);
  assert.equal(parseWeekdays(undefined, 'X'), null);
  stubExit(t);
  assert.throws(() => parseWeekdays('seg', 'X'), /exit 1/);
});

test('only interview dates on allowed weekdays count', async () => {
  // 2026-10-27 is a Tuesday, 2026-10-28 a Wednesday, 2026-11-02 a Monday
  const { bot } = makeBot({ dates: ['2026-10-27', '2026-10-28', '2026-11-02'], overrides: { consulateWeekdays: [1, 3] } });
  assert.deepEqual(await bot.checkAvailableDates({}, '2027-03-04', undefined, '2026-11-30'), ['2026-10-28', '2026-11-02']);
});

test('without interview weekdays any day counts', async () => {
  const { bot } = makeBot({ dates: ['2026-10-27'], overrides: { consulateWeekdays: null } });
  assert.deepEqual(await bot.checkAvailableDates({}, '2027-03-04', undefined, '2026-11-30'), ['2026-10-27']);
});

test('refuses to book an interview on a weekday that is not allowed', async () => {
  const { bot, booked } = makeBot({ overrides: { consulateWeekdays: [1, 3] } });
  assert.equal(await bot.bookAppointment({}, '2026-10-27', '2026-11-30'), null);
  assert.equal(booked.length, 0);
});

test('picks the first ASC date on an allowed weekday', async () => {
  // 2026-10-24 is a Saturday, 2026-10-26 a Monday
  const { bot, booked } = makeBot({ ascDates: ['2026-10-24', '2026-10-26'], appointment: 'Consular Appointment: 28 October, 2026, 08:30', overrides: { ascWeekdays: [1, 2, 3, 4, 5] } });
  assert.equal(await bot.bookAppointment({}, '2026-10-28', '2026-11-30'), true);
  assert.equal(booked[0][5].date, '2026-10-26');
});

test('never books when no ASC date falls on an allowed weekday', async () => {
  const { bot, booked } = makeBot({ ascDates: ['2026-10-24'], overrides: { ascWeekdays: [1, 2, 3, 4, 5] } });
  assert.equal(await bot.bookAppointment({}, '2026-10-28', '2026-11-30'), null);
  assert.equal(booked.length, 0);
});

// ASC dates depend on the interview slot: none for 2026-10-28, some for later interviews
const ascByInterview = (none) => async (h, s, facilityId, query = '') =>
  (facilityId === config.ascFacilityId ? (none.some(d => query.includes(d)) ? [] : ['2026-10-30']) : []);

test('tries the next interview date when the earliest has no ASC slot', async () => {
  const { bot, booked } = makeBot({ appointment: 'Consular Appointment: 2 November, 2026, 08:30' });
  bot.client.checkAvailableDate = ascByInterview(['2026-10-28']);
  assert.equal(await bot.bookEarliest({}, ['2026-10-28', '2026-11-02'], '2026-11-30'), '2026-11-02');
  assert.equal(booked.length, 1);
  assert.equal(booked[0][3], '2026-11-02');
});

test('never submits twice in one check: stops after a booking that was not applied', async () => {
  const { bot, booked } = makeBot({ appointment: UNCHANGED, attempts: [3, 3] });
  assert.equal(await bot.bookEarliest({}, ['2026-10-28', '2026-11-02'], '2026-11-30'), null);
  assert.equal(booked.length, 1);
});

test('tries at most 3 interview dates per check', async () => {
  const { bot, booked } = makeBot();
  let timeLookups = 0;
  bot.client.checkAvailableDate = ascByInterview(['2026-10-28', '2026-11-02', '2026-11-04', '2026-11-09']);
  bot.client.checkAvailableTime = async () => { timeLookups++; return '08:30'; };
  assert.equal(await bot.bookEarliest({}, ['2026-10-28', '2026-11-02', '2026-11-04', '2026-11-09'], '2026-11-30'), null);
  assert.equal(timeLookups, 3);
  assert.equal(booked.length, 0);
});

const page = (html, session) => new Response(
  `<html><head><meta name="csrf-token" content="tok-${session}"></head><body>${html}</body></html>`,
  { headers: { 'set-cookie': `_yatri_session=${session}; path=/` } }
);
const PICKER = '<input type="checkbox" name="applicants[]" value="111"><input type="checkbox" name="applicants[]" value="222">';
const FORM = `<form id="appointment-form"><input type="hidden" name="authenticity_token" value="form-tok">
  <select id="appointments_consulate_appointment_facility_id"></select>
  <input type="submit" name="commit" id="appointments_submit" value="Reschedule"></form>`;

function makeClient(pages) {
  const client = new VisaHttpClient('br', 'e', 'p');
  const calls = { gets: [], post: null };
  client._anonymousRequest = async (url, headers) => {
    calls.gets.push({ url, cookie: headers.Cookie });
    return page(pages[calls.gets.length - 1], `s${calls.gets.length}`);
  };
  client._submitFormWithRedirect = async (url, headers, data) => {
    calls.post = { headers, data };
    return new Response('<p>instructions</p>');
  };
  return { client, calls };
}

test('group booking walks limit warning -> applicant picker -> form, then posts exactly the form fields', async (t) => {
  const cwd = process.cwd();
  process.chdir(tmpdir()); // book() saves the response page to the working directory
  t.after(() => process.chdir(cwd));
  const { client, calls } = makeClient([PICKER, FORM]);

  const ok = await client.book({ Cookie: '_yatri_session=s0' }, '9', '56', '2026-11-10', '08:30', { facilityId: '60', date: '2026-10-27', time: '07:15' });

  assert.equal(ok, true);
  assert.match(calls.gets[0].url, /\/schedule\/9\/appointment\?confirmed_limit_message=1&commit=Continue$/);
  assert.equal(calls.gets[1].cookie, '_yatri_session=s1');
  assert.match(decodeURIComponent(calls.gets[1].url), /\/schedule\/9\/appointment\?applicants\[\]=111&applicants\[\]=222&confirmed_limit_message=1&commit=Continue$/);
  assert.equal(calls.post.headers.Cookie, '_yatri_session=s2');
  assert.deepEqual(calls.post.data, {
    'authenticity_token': 'form-tok',
    'confirmed_limit_message': '1',
    'use_consulate_appointment_capacity': 'true',
    'appointments[consulate_appointment][facility_id]': '56',
    'appointments[consulate_appointment][date]': '2026-11-10',
    'appointments[consulate_appointment][time]': '08:30',
    'appointments[asc_appointment][facility_id]': '60',
    'appointments[asc_appointment][date]': '2026-10-27',
    'appointments[asc_appointment][time]': '07:15',
    'commit': 'Reschedule'
  });
});

test('never posts when the reschedule form is not reached', async () => {
  const { client, calls } = makeClient([PICKER, '<p>Sign in</p>']);
  const ok = await client.book({}, '9', '56', '2026-11-10', '08:30', { facilityId: '60', date: '2026-10-27', time: '07:15' });
  assert.equal(ok, false);
  assert.equal(calls.post, null);
});
