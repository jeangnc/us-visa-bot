import { Bot, nextMaxDate } from '../lib/bot.js';
import { getConfig, WEEKDAYS } from '../lib/config.js';
import { log, sleep, isSocketHangupError } from '../lib/utils.js';

const COOLDOWN = 3600; // 1 hour in seconds
const EMPTY_LIST_LIMIT = 3; // consecutive empty date lists before pausing like a connection reset

export async function botCommand(options) {
  const config = getConfig();
  const bot = new Bot(config, { dryRun: options.dryRun });
  let currentBookedDate = options.current;
  const targetDate = options.target;
  const minDate = options.min;
  // options.max also carries a lowered ceiling across the retry restarts below
  let maxDate = options.max || config.maxDate;

  // A malformed date parses to NaN and would silently disable the ceiling
  if (maxDate && !/^\d{4}-\d{2}-\d{2}$/.test(maxDate)) {
    console.error(`Max date must be YYYY-MM-DD, got "${maxDate}"`);
    process.exit(1);
  }

  log(`Initializing with current date ${currentBookedDate}`);

  if (maxDate) {
    log(`Max date: ${maxDate}`);
  }

  if (config.consulateWeekdays || config.ascWeekdays) {
    const days = (weekdays) => (weekdays ? weekdays.map(d => WEEKDAYS[d]).join(', ') : 'all');
    log(`Weekdays: interview ${days(config.consulateWeekdays)}; ASC ${days(config.ascWeekdays)}`);
  }

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
      if (maxDate && maxDate < new Date().toISOString().slice(0, 10)) {
        log(`Max date ${maxDate} has passed, nothing left to look for. Stopping.`);
        process.exit(0);
      }

      const availableDate = await bot.checkAvailableDate(
        sessionHeaders,
        currentBookedDate,
        minDate,
        maxDate
      );

      // Polling through a rate limit only extends it; pause, then log in again
      if (bot.emptyStreak >= EMPTY_LIST_LIMIT) {
        log(`${bot.emptyStreak} empty date lists in a row, probably rate limited. Trying again after ${COOLDOWN} seconds...`);
        await sleep(COOLDOWN);
        return botCommand(options);
      }

      if (availableDate) {
        const booked = await bot.bookAppointment(sessionHeaders, availableDate, maxDate);

        if (booked) {
          // Update current date; with a max date, only a whole month earlier is worth another attempt
          currentBookedDate = availableDate;

          if (maxDate) {
            maxDate = nextMaxDate(availableDate);
            log(`Rescheduled to ${availableDate}. From now on only dates up to ${maxDate} count.`);
          }

          options = {
            ...options,
            current: currentBookedDate,
            max: maxDate
          };

          if (targetDate && availableDate <= targetDate) {
            log(`Target date reached! Successfully booked appointment on ${availableDate}`);
            process.exit(0);
          }
        }
      }

      await sleep(config.refreshDelay);
    }
  } catch (err) {
    if (isSocketHangupError(err)) {
      log(`Socket hangup error: ${err.message}. Trying again after ${COOLDOWN} seconds...`);
      await sleep(COOLDOWN);
    } else {
      log(`Session/authentication error: ${err.message}. Retrying immediately...`);
    }
    return botCommand(options);
  }
}
