import { Bot } from '../lib/bot.js';
import { getConfig } from '../lib/config.js';
import { log, sleep, isSocketHangupError } from '../lib/utils.js';

const BASE_BACKOFF = 5;      // seconds
const MAX_BACKOFF = 120;     // seconds
const JITTER_MIN = 0.5;      // 50% jitter to spread retries
const JITTER_MAX = 1.5;

const CHECK_DATES_RETRIES = 3;     // retries on hangup before full restart
const CHECK_DATES_RETRY_DELAY = 5; // seconds between retries

async function checkAvailableDateWithRetry(bot, sessionHeaders, currentBookedDate, minDate, targetDate) {
  let lastErr;
  for (let attempt = 1; attempt <= CHECK_DATES_RETRIES; attempt++) {
    try {
      return await bot.checkAvailableDate(sessionHeaders, currentBookedDate, minDate, targetDate);
    } catch (err) {
      lastErr = err;
      if (!isSocketHangupError(err)) throw err;
      if (attempt === CHECK_DATES_RETRIES) {
        log(`Socket hangup on check dates (${attempt}/${CHECK_DATES_RETRIES} attempts). Giving up, will re-login.`);
        throw err;
      }
      log(`Socket hangup on check dates: ${err.message}. Retrying in ${CHECK_DATES_RETRY_DELAY}s (${attempt}/${CHECK_DATES_RETRIES})`);
      await sleep(CHECK_DATES_RETRY_DELAY);
    }
  }
  throw lastErr;
}

export async function botCommand(options) {
  const config = getConfig();
  const bot = new Bot(config, { dryRun: options.dryRun });
  let retryCount = options.retryCount || 0;
  let currentBookedDate = options.current;
  const targetDate = options.target;
  const minDate = options.min;

  log(`Initializing with current date ${currentBookedDate}`);

  if (options.dryRun) {
    log(`[DRY RUN MODE] Bot will only log what would be booked without actually booking`);
  }

  if (targetDate) {
    log(`Target date: ${targetDate}`);
  }

  if (minDate) {
    log(`Minimum date: ${minDate}`);
  }

  try {
    const sessionHeaders = await bot.initialize();

    while (true) {
      const availableDate = await checkAvailableDateWithRetry(
        bot,
        sessionHeaders,
        currentBookedDate,
        minDate,
        targetDate
      );

      if (availableDate) {
        const booked = await bot.bookAppointment(sessionHeaders, availableDate);

        if (booked) {
          // Update current date to the new available date
          currentBookedDate = availableDate.date;

          options = {
            ...options,
            current: currentBookedDate
          };

          if (targetDate && availableDate.date <= targetDate) {
            log(`Target date reached! Successfully booked appointment on ${availableDate.date} (facility ${availableDate.facilityId})`);
            process.exit(0);
          }
        }
      }

      // Successful loop iteration: reset backoff
      retryCount = 0;
      await sleep(config.refreshDelay);
    }
  } catch (err) {
    if (isSocketHangupError(err)) {
      const base = config.refreshDelay || BASE_BACKOFF;
      const exponential = base * (2 ** retryCount);
      const capped = Math.min(MAX_BACKOFF, exponential);
      const jitter = JITTER_MIN + (Math.random() * (JITTER_MAX - JITTER_MIN));
      const wait = Math.min(MAX_BACKOFF, Math.round(capped * jitter));

      log(`Socket hangup error: ${err.message}. Retry in ${wait} seconds (attempt ${retryCount + 1})`);
      await sleep(wait);
      return botCommand({ ...options, retryCount: retryCount + 1 });
    } else {
      log(`Session/authentication error: ${err.message}. Retrying immediately...`);
      return botCommand({ ...options, retryCount: 0 });
    }
  }
}
