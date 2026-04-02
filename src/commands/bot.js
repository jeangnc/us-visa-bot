import { Bot } from '../lib/bot.js';
import { getConfig } from '../lib/config.js';
import { log, sleep, isSocketHangupError, sendTelegram } from '../lib/utils.js';

const COOLDOWN = 3600; // 1 hour in seconds
const MAX_RETRIES = process.env.MAX_RETRIES ? parseInt(process.env.MAX_RETRIES, 10) : 10;

export async function botCommand(options) {
  const config = getConfig();
  const bot = new Bot(config, { dryRun: options.dryRun });
  const currentBookedDate = options.current;
  const targetDate = options.target || process.env.TARGET_DATE;
  const minDate = options.min || process.env.MIN_DATE;

  log(`Initializing with current date ${currentBookedDate}`);
  await sendTelegram(`🟢 <b>Bot started successfully</b>\nCurrent: ${currentBookedDate || 'None'}\nTarget: ${targetDate || 'None'}\nMin: ${minDate || 'None'}`);

  if (options.dryRun) {
    log(`[DRY RUN MODE] Bot will only log what would be booked without actually booking`);
  }

  if (targetDate) {
    log(`Target date: ${targetDate}`);
  }

  if (minDate) {
    log(`Minimum date: ${minDate}`);
  }

  let retries = 0;
  let sessionHeaders = null;

  while (true) {
    try {
      if (!sessionHeaders) {
        sessionHeaders = await bot.initialize();
        retries = 0; // Reset retries upon successful login
      }

      while (true) {
        const availableDate = await bot.checkAvailableDate(
          sessionHeaders,
          currentBookedDate,
          minDate
        );

        if (availableDate) {
          const passesMin = !minDate || availableDate >= minDate;
          const passesTarget = !targetDate || availableDate <= targetDate;

          if (passesMin && passesTarget) {
            log(`📅 Earlier slot found within range: ${availableDate}`);
            await sendTelegram(`📅 <b>Earlier slot found</b>\nDate: ${availableDate}`);
            
            const booked = await bot.bookAppointment(sessionHeaders, availableDate);

            if (booked) {
              log(`✅ Booked within acceptable range: ${availableDate}`);
              await sendTelegram(`✅ <b>Appointment successfully rescheduled</b>\nNew Date: ${availableDate}`);
              process.exit(0);
            }
          } else {
            log(`Found date ${availableDate} but it's outside acceptable range. Ignoring.`);
          }
        }

        await sleep(config.refreshDelay);
      }
    } catch (err) {
      const msg = (err?.message || '').toLowerCase();
      const isAuthError = msg.includes('login') || msg.includes('auth') || msg.includes('unauthorized');
      
      if (isAuthError) {
        await sendTelegram(`❌ <b>Login failed</b>\nError: ${err?.message || 'Unknown Error'}`);
      } else {
        await sendTelegram(`⚠️ <b>Network error / retrying</b>\nError: ${err?.message || 'Unknown Error'}`);
      }

      // Drop session to force re-login on the next outer loop iteration
      sessionHeaders = null;

      retries++;
      if (retries >= MAX_RETRIES) {
        await sendTelegram(`🛑 <b>Max retries hit / bot stopping</b>\nError: ${err?.message || 'Unknown Error'}`);
        log(`Max retries (${MAX_RETRIES}) reached. Exiting.`);
        process.exit(1);
      }

      if (isSocketHangupError(err)) {
        log(`Socket hangup error: ${err?.message || 'Unknown Network Drop'}. Trying again after ${COOLDOWN} seconds... (Retry ${retries}/${MAX_RETRIES})`);
        await sleep(COOLDOWN);
      } else {
        log(`Session/authentication error: ${err?.message || 'Unknown Auth Error'}. Retrying immediately... (Retry ${retries}/${MAX_RETRIES})`);
        await sleep(5); // Brief wait to avoid spamming errors if they repeat instantly
      }
    }
  }
}
