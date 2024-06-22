import fetch from 'node-fetch';
import cheerio from 'cheerio';
import { preciseSleep } from './preciseSleep.js';
const EMAIL = process.env.EMAIL;
const PASSWORD = process.env.PASSWORD;
const SCHEDULE_ID = process.env.SCHEDULE_ID;
const FACILITY_ID = process.env.FACILITY_ID;
const LOCALE = process.env.LOCALE;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const BASE_URI = `https://ais.usvisa-info.com/${LOCALE}/niv`;
const desired_start_date = "2024-06-30";
const desired_end_date = "2025-10-30";
let state = {};


/******************************************************************************************** */
async function main(currentBookedDate) {
  if (!currentBookedDate) {
    log(`Invalid current booked date: ${currentBookedDate}`);
    process.exit(1);
  }

  log(`
---------------------------------------------------------------------
    Iniciando sesión con: ${EMAIL}
 
    Iniciando con la Fecha actual ${currentBookedDate}
 
    Buscando fechas disponibles en el rango: ${desired_start_date} a ${desired_end_date}
 
    Facility ID: ${FACILITY_ID}
--------------------------------------------------------------------
    `);

  try {
    const sessionHeaders = await login();
    let lastSecond = state.lastSecond || -1;
    state.startTime = state.startTime || new Date();

    while (true) {
      const now = new Date();
      const currentMinute = now.getMinutes();
      const currentSecond = now.getSeconds();

      if (currentMinute % 5 !== 0 || currentSecond < 9) {
        if (currentSecond !== lastSecond && currentSecond % 15 === 0) {
          log("Espera...");
          lastSecond = currentSecond;
          state.lastSecond = lastSecond;
        }
        await preciseSleep(1.1); 
        continue;
      }

  
      const date = await checkAvailableDate(sessionHeaders, desired_start_date, desired_end_date);

      if (!date) {
        log('No hay fechas disponibles');
      } else if (new Date(date) > new Date(currentBookedDate)) {
        log(`La fecha más cercana es posterior a la ya reservada (${currentBookedDate} vs ${date})`);
      } else {
        currentBookedDate = date;
        const time = await checkAvailableTime(sessionHeaders, date);
        await sendTelegramMessage(`${EMAIL},Nueva cita disponible el ${date} Reservando...`);

        await book(sessionHeaders, date, time);
        log(`\n**Fecha reservada para el ${date} a las ${time}.`);
        await sendTelegramMessage(`Cita reservada para ${EMAIL} el ${date} a las ${time}`);
        return preciseSleep (2000000)
      }

      await preciseSleep(1.1); 
    }
  } catch (err) {
    console.error(err);
    log('Trying again');
    main(currentBookedDate);
  }
}


async function login() {
  log('Iniciando sesión');
  const anonymousHeaders = await fetchWithRetry(`${BASE_URI}/users/sign_in`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
    },
  }).then(response => {
    if (!response.ok) {
      throw new Error(`Error al iniciar sesión: ${response.statusText}`);
    }
    log('Sesión iniciada correctamente');
    return extractHeaders(response);
  });
  const loginResponse = await fetchWithRetry(`${BASE_URI}/users/sign_in`, {
    headers: {
      ...anonymousHeaders,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    },
    method: 'POST',
    body: new URLSearchParams({
      'utf8': '✓',
      'user[email]': EMAIL,
      'user[password]': PASSWORD,
      'policy_confirmed': '1',
      'commit': 'Sign In',
    }),
  });

  if (!loginResponse.ok) {
    throw new Error(`Error al iniciar sesión: ${loginResponse.statusText}`);
  }

  return {
    ...anonymousHeaders,
    'Cookie': extractRelevantCookies(loginResponse),
  };
}

async function fetchWithRetry(url, options, retries = 4, fastRetryErrors = [500, 502, 503, 504, 501, 403, 401]) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        const status = response.status;
        const code = response.statusText;

        if (fastRetryErrors.includes(status)) {
          console.error(`\x1b[33m⚠️ Error \x1b[0m${status}\x1b[33m: \x1b[0m${code}. Reintentando rápidamente... (${i + 1}/${retries})\x1b[0m\n`);
          await preciseSleep(0.5);
          continue;
        }
      }
      return response;
    } catch (error) {
      const errorMessage = error.message || 'Error desconocido';
      console.error(`\x1b[31m❌ Error de red:${errorMessage}. Reintentando... (${i + 1}/${retries})\x1b[0m\n`);
      if (error.code === 'ECONNRESET') {
        continue;
      } else if (error.code === 'ECONNABORTED') {
        console.error('\x1b[31m🛑 Conexión abortada. Reintentando...\x1b[0m\n');
      } else if (error.response && error.response.status === 401) {
        console.error('\x1b[31m🔒 Error 401 (No autorizado) detectado. Reiniciando función principal...\x1b[0m\n');
        await main();
        return;
      }
      console.error('\x1b[31m❌ Error general:', error.message, '\x1b[0m\n');
      await main(currentBookedDate);
      await preciseSleep(0.8);
    }
  }
  console.error(`\x1b[31m🚫 No se pudo completar la solicitud después de ${retries} intentos\x1b[0m\n`);
  log("\x1b[36m🔄 Reiniciando sesión...\x1b[0m\n")
  process.exit(1);
}

/**************************************************************************************************************** */

async function checkAvailableDate(headers, desired_start_date, desired_end_date) {
  return fetchWithRetry(
    `${BASE_URI}/schedule/${SCHEDULE_ID}/appointment/days/${FACILITY_ID}.json?appointments[expedite]=false`,
    {
      headers: Object.assign({}, headers, {
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "Connection":"keep-alive",
        'Sec-Fetch-User': '?1',
        "DNT": 1,
      }),
      cache: "no-store",
    }
  ).then((response) =>
    response.json().then((available_dates) =>
      available_dates.length > 0
        ? available_dates.filter(
            (available_date) =>
              Date.parse(available_date.date) >= Date.parse(desired_start_date) &&
              Date.parse(available_date.date) <= Date.parse(desired_end_date)
          )
        : []
    ).then((options) => (options.length > 0 ? options[0].date : null))
  );
}

async function checkAvailableTime(headers, date) {
  const response = await fetchWithRetry(`${BASE_URI}/schedule/${SCHEDULE_ID}/appointment/times/${FACILITY_ID}.json?date=${date}&appointments[expedite]=false`, {
    headers: {
      ...headers,
      'Accept': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    },
    cache: 'no-store',
  });

  return response.json().then((times) => times['business_times'][0] || times['available_times'][0]);
}

/*-----------------------------------------------------------------------------------------------*/
async function sendTelegramMessage(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  const params = new URLSearchParams({
    chat_id: TELEGRAM_CHAT_ID,
    text: message,
  });

  return fetchWithRetry(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });
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

async function extractHeaders(res) {
  const cookies = extractRelevantCookies(res);

  const html = await res.text();
  const $ = cheerio.load(html);
  const csrfToken = $('meta[name="csrf-token"]').attr('content');

  if (!csrfToken) {
    throw new Error('CSRF token not found');
  }

  return {
    Cookie: cookies,
    'X-CSRF-Token': csrfToken,
    Referer: BASE_URI,
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept-Language': 'en-US,en;q=0.9',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-User': '?1',
    Pragma: 'no-cache',
    DNT: '1',
    'X-Requested-With': 'XMLHttpRequest',
    'Accept-Charset': 'utf-8',
    'X-Forwarded-For': '127.0.0.1',
    'X-Forwarded-Proto': 'http',
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes', 
    'Keep-Alive': 'timeout=5, max=100000', 
    'If-Unmodified-Since': new Date(), 
    'Content-Security-Policy': "default-src 'self'; script-src 'self' www.google-analytics.com",
  };
}

function extractRelevantCookies(res) {
  const parsedCookies = parseCookies(res.headers.get('set-cookie'));
  return `_yatri_session=${parsedCookies['_yatri_session']}`;
}

function parseCookies(cookies) {
  const parsedCookies = {};

  cookies.split(';').map(c => c.trim()).forEach(c => {
    const [name, value] = c.split('=', 2);
    parsedCookies[name] = value;
  });

  return parsedCookies;
}

function sleep(seconds) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

const args = process.argv.slice(2);
const currentBookedDate = args[0];
main(currentBookedDate);
