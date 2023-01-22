#!/usr/bin/env node

import fetch from "node-fetch";
import cheerio from 'cheerio';

const USERNAME = process.env.USERNAME
const PASSWORD = process.env.PASSWORD
const SCHEDULE_ID = process.env.SCHEDULE_ID
const FACILITY_ID = process.env.FACILITY_ID

const BASE_URI = 'https://ais.usvisa-info.com/pt-br/niv'

function sleep(s) {
  return new Promise((resolve) => {
    setTimeout(resolve, s * 1000);
  });
}

async function extractHeaders(res) {
  const cookies = extractRelevantCookies(res)

  const html = await res.text()
  const $ = cheerio.load(html);
  const csrfToken = $('meta[name="csrf-token"]').attr('content')

  return {
    "Cookie": cookies,
    "X-CSRF-Token": csrfToken,
    "Referer": BASE_URI,
    "Referrer-Policy": "strict-origin-when-cross-origin",
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
  }
}

function parseCookies(cookies) {
  const parsedCookies = {}

  cookies.split(';').map(c => c.trim()).forEach(c => {
    const [name, value] = c.split('=', 2)
    parsedCookies[name] = value
  })

  return parsedCookies
}

function extractRelevantCookies(res) {
  const parsedCookies = parseCookies(res.headers.get('set-cookie'))
  return `_yatri_session=${parsedCookies['_yatri_session']}`
}

function login(headers) {
  return fetch(`${BASE_URI}/users/sign_in`, {
    "headers": Object.assign({}, headers, {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    }),
    "method": "POST",
    "body": new URLSearchParams({
      'utf8': '✓',
      'user[email]': USERNAME,
      'user[password]': PASSWORD,
      'policy_confirmed': '1',
      'commit': 'Acessar'
    }),
  })
}

function checkAvailableDate(headers) {
  return fetch(`${BASE_URI}/schedule/${SCHEDULE_ID}/appointment/days/${FACILITY_ID}.json?appointments[expedite]=false`, {
    "headers": Object.assign({}, headers, {
      "Accept": "application/json",
      "X-Requested-With": "XMLHttpRequest",
    })
  })
    .then(r => r.json())
    .then(d => d.length > 0 ? d[0]['date'] : null)

}
function checkAvailableTime(headers, date) {
  return fetch(`${BASE_URI}/schedule/${SCHEDULE_ID}/appointment/times/${FACILITY_ID}.json?date=${date}&appointments[expedite]=false`, {
    "headers": Object.assign({}, headers, {
      "Accept": "application/json",
      "X-Requested-With": "XMLHttpRequest",
    })
  })
    .then(r => r.json())
    .then(d => d['business_times'][0] || d['available_times'][0])
}

async function book(headers, date, time) {
  const url = `${BASE_URI}/schedule/${SCHEDULE_ID}/appointment`

  const newHeaders = await fetch(url, { "headers": headers })
    .then(response => extractHeaders(response))

  return fetch(url, {
    "method": "POST",
    "redirect": "follow",
    "headers": Object.assign({}, newHeaders, {
      'Content-Type': 'application/x-www-form-urlencoded',
    }),
    "body": new URLSearchParams({
      'utf8': '✓',
      'authenticity_token': newHeaders['X-CSRF-Token'],
      'confirmed_limit_message': '1',
      'use_consulate_appointment_capacity': 'true',
      'appointments[consulate_appointment][facility_id]': FACILITY_ID,
      'appointments[consulate_appointment][date]': date,
      'appointments[consulate_appointment][time]': time,
      'appointments[asc_appointment][facility_id]': '',
      'appointments[asc_appointment][date]': '',
      'appointments[asc_appointment][time]': ''
    }),
  })
}

async function main(nearestDate = null) {
  try {
    const sessionHeaders = await fetch(`${BASE_URI}/users/sign_in`)
      .then(response => extractHeaders(response))
      .then(async anonymousHeaders => (
        Object.assign({}, anonymousHeaders, {
          'Cookie': await login(anonymousHeaders).then(res => extractRelevantCookies(res))
        })
      ))

    while(true) {
      const date = await checkAvailableDate(sessionHeaders)

      if (date) {
        const parsedDate = Date.parse(date)

        if (!nearestDate || parsedDate < nearestDate) {
          nearestDate = parsedDate
          await checkAvailableTime(sessionHeaders, date)
            .then(time => book(sessionHeaders, date, time))
            .then(d => console.log(d))

          console.log(new Date().toString(), "booked time at", date, time)
        } else {
          console.log(new Date().toString(), "nearest date is further than already booked", date)
        }
      } else {
        console.log(new Date().toString(), "no dates available")
      }

      await sleep(30)
    }

  } catch(err) {
    console.error(err)
    console.info("Trying again")

    main(nearestDate)
  }
}

main()
