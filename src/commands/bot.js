import { Bot } from '../lib/bot.js';
import { getConfig } from '../lib/config.js';
import { log, sleep } from '../lib/utils.js';

const COOLDOWN = 10 * 60; // 10 minutes

export async function botCommand(options) {
  const config = getConfig();
  const bot = new Bot(config);
  let currentBookedDate = options.current;
  const targetDate = options.target;
  const minDate = options.min;

  log(`Initializing with current date ${currentBookedDate}`);

  if (targetDate) {
    log(`Target date: ${targetDate}`);
  }

  if (minDate) {
    log(`Minimum date: ${minDate}`);
  }

  try {
    const sessionHeaders = await bot.initialize();

    while (true) {
      const availableDate = await bot.checkAvailableDate(
        sessionHeaders,
        currentBookedDate,
        minDate
      );

      if (availableDate) {
        const booked = await bot.bookAppointment(sessionHeaders, availableDate);

        if (booked) {
          currentBookedDate = availableDate;

          if (targetDate && availableDate <= targetDate) {
            log(`Target date reached! Successfully booked appointment on ${availableDate}`);
            process.exit(0);
          }
        }
      }

      await sleep(config.refreshDelay);
    }
  } catch (err) {
    console.error(`Error during bot operation: ${err.message}`);

    log(`Trying again after ${COOLDOWN} seconds...`);
    await sleep(COOLDOWN);
    return botCommand(options);
  }
}
