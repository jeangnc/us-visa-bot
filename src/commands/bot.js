import { Bot } from '../lib/bot.js';
import { getConfig, getAppointmentUrl } from '../lib/config.js';
import { notify } from '../lib/notify.js';
import { log, sleep, isSocketHangupError } from '../lib/utils.js';

const COOLDOWN = 3600; // 1 hour in seconds
const FAILURE_ALERT_THRESHOLD = 5; // consecutive errors before emailing that the bot is stuck

// Module level so they survive the re-login recursion below
let consecutiveFailures = 0;
let failureAlertSent = false;

export async function botCommand(options) {
  const config = getConfig();
  const bot = new Bot(config, { dryRun: options.dryRun });
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
      const availableDate = await bot.checkAvailableDate(
        sessionHeaders,
        currentBookedDate,
        minDate
      );

      consecutiveFailures = 0;

      if (failureAlertSent) {
        failureAlertSent = false;
        await notify(config, 'Resolved: visa bot is working again', 'The bot is checking for appointments normally again.');
      }

      if (availableDate) {
        const bookedTime = await bot.bookAppointment(sessionHeaders, availableDate);

        if (bookedTime) {
          // Update current date to the new available date
          currentBookedDate = availableDate;

          options = {
            ...options,
            current: currentBookedDate
          };

          if (!options.dryRun) {
            await notify(
              config,
              `Action required: visa appointment booked for ${availableDate} ${bookedTime}`,
              `The bot booked your US visa interview for ${availableDate} at ${bookedTime} (facility ${config.facilityId}).\n\n` +
              `Log in to check the booking and print the confirmation: ${getAppointmentUrl(config)}`
            );
          }

          if (targetDate && availableDate <= targetDate) {
            log(`Target date reached! Successfully booked appointment on ${availableDate}`);
            process.exit(0);
          }
        }
      }

      await sleep(config.refreshDelay);
    }
  } catch (err) {
    consecutiveFailures++;

    if (consecutiveFailures >= FAILURE_ALERT_THRESHOLD && !failureAlertSent) {
      failureAlertSent = true;
      await notify(
        config,
        'Warning: visa bot is failing to check appointments',
        `The last ${consecutiveFailures} attempts failed. Latest error: ${err.message}\n\n` +
        `It keeps retrying. Check the login details in .env, or whether the site changed or is blocking you.`
      );
    }

    if (isSocketHangupError(err)) {
      log(`Socket hangup error: ${err.message}. Trying again after ${COOLDOWN} seconds...`);
      await sleep(COOLDOWN);
    } else {
      log(`Session/authentication error: ${err.message}. Retrying immediately...`);
    }
    return botCommand(options);
  }
}
