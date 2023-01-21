#!/usr/bin/env node

import fetch from "node-fetch";
import cheerio from 'cheerio';

const USERNAME = process.env.USERNAME
const PASSWORD = process.env.PASSWORD
const SCHEDULE_ID = process.env.SCHEDULE_ID
const BASE_URI = 'https://ais.usvisa-info.com/pt-br/niv'

function sleep(s) {
  return new Promise((resolve) => {
    setTimeout(resolve, s * 1000);
  });
}

async function baseHeaders() {
  const res = await fetch(`${BASE_URI}/users/sign_in`)

  const cookies = res.headers.get('set-cookie')

  const html = await res.text()
  const $ = cheerio.load(html);
  const csrfToken = $('meta[name="csrf-token"]').attr('content')

  return {
    "cookie": cookies,
    "x-csrf-token": csrfToken,
    "referer": BASE_URI,
    "referrer-policy": "strict-origin-when-cross-origin",
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
  }
}

async function login(headers) {
  const res = await fetch(`${BASE_URI}/users/sign_in`, {
    "headers": Object.assign({}, headers, {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
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

  return Object.assign({}, headers, {
    "cookie": res.headers.get('set-cookie'),
  })
}

async function checkAvailableTimes(headers) {
  fetch(`${BASE_URI}/schedule/${SCHEDULE_ID}/appointment/days/128.json?appointments[expedite]=false`, {
    "headers": Object.assign({}, headers, {
      "accept": "application/json",
      "x-requested-with": "XMLHttpRequest",
    })
  })
    .then(r => r.json())
    .then(d => console.log(new Date().toString(), d[0]))

}

async function main() {
  try {
    const headers = await baseHeaders()
      .then(defaultHeaders => login(defaultHeaders))

    while(true) {
      await checkAvailableTimes(headers)
      await sleep(30)
    }

  } catch(err) {
    console.error(err)
    console.info("Trying again in 1 minute")
    await sleep(60)
    main()
  }
}

main()
