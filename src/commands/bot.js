import { Bot } from '../lib/bot.js';
import { getConfig, reloadConfig } from '../lib/config.js';
import { notify } from '../lib/notify.js';
import { log, sleep, isSocketHangupError, computerJustSlept, onStopRequest } from '../lib/utils.js';

const MIN_CYCLE_DELAY = 60;                // floor between check cycles (s), whatever REFRESH_DELAY says
const BLOCK_BACKOFF = [3600, 7200, 14400]; // 1h, 2h, 4h after consecutive hangups/blocks
const AUTH_BACKOFF = [300, 900, 3600];     // 5m, 15m, 1h before re-login after auth/session errors
const MAX_CONSECUTIVE_FAILURES = 4;        // give up rather than keep hitting a flagged account

let consecutiveFailures = 0;
let activeBot = null; // the bot holding a signed-in session, if any
let stopping = false;

// Stop (Ctrl-C or a kill signal) signs out of the site before exiting.
// A booking that's already under way is allowed to finish first.
async function shutdown() {
  if (stopping) return;
  stopping = true;
  const bot = activeBot;
  if (bot?.booking) {
    log('stop requested during a booking — finishing the booking first');
    while (bot.booking) await sleep(0.5);
  }
  if (bot?.session) {
    log('stop requested — signing out');
    try {
      const { confirmed, detail } = await Promise.race([bot.logout(), sleep(20).then(() => { throw new Error('timed out'); })]);
      log(confirmed ? `sign-out confirmed: ${detail}` : `sign-out NOT confirmed: ${detail}`);
    } catch (err) {
      log(`sign-out failed: ${err.message}`);
    }
  }
  log('bot stopped');
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
onStopRequest(shutdown);

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

  if (config.refreshDelay.min < MIN_CYCLE_DELAY) {
    const { min, max } = delayRange(config);
    log(`REFRESH_DELAY below safe floor — using ${min}-${max}s between cycles`);
  }

  try {
    const sessionHeaders = await bot.initialize();
    activeBot = bot;

    while (true) {
      applyLiveSettings(bot);
      // A date in the window is booked the moment its city answers
      await bot.checkAvailableDate(sessionHeaders, currentBookedDate, minDate, async candidate => {
        if (!(await bot.bookAppointment(sessionHeaders, candidate))) return false;
        currentBookedDate = candidate.date;
        options = { ...options, current: currentBookedDate };
        if (targetDate && candidate.date <= targetDate) {
          log(`Target date reached! Successfully booked appointment on ${candidate.date}`);
          process.exit(0);
        }
        return true;
      });
      consecutiveFailures = 0;

      const { min, max } = delayRange(bot.config);
      const delay = min + Math.random() * (max - min);
      log(`sleeping ${delay.toFixed(1)}s`);
      await sleep(delay);
    }
  } catch (err) {
    activeBot = null; // the session is dead or blocked: nothing to sign out of
    // Sleep kills open connections: that's not the site blocking us
    if (isSocketHangupError(err) && computerJustSlept()) {
      log('connection lost while the computer was asleep — retrying in 1m');
      await sleep(60);
      return botCommand(options);
    }
    consecutiveFailures++;
    if (consecutiveFailures > MAX_CONSECUTIVE_FAILURES) {
      log(`${consecutiveFailures - 1} failures in a row — stopping to protect the account. Check the site manually before restarting.`);
      await notify(config.ntfyTopic, 'US Visa Bot STOPPED', `Repeated failures: ${err.message}`, { priority: 'high', tags: ['warning'] });
      process.exit(1);
    }

    const step = Math.min(consecutiveFailures, BLOCK_BACKOFF.length) - 1;
    if (isSocketHangupError(err)) {
      const wait = BLOCK_BACKOFF[step];
      log(`Blocked/hangup: ${err.message}. Backing off ${wait / 60}m (failure ${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})...`);
      await sleep(wait);
    } else {
      const wait = AUTH_BACKOFF[step];
      log(`Session/authentication error: ${err.message}. Re-login in ${wait / 60}m (failure ${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})...`);
      await sleep(wait);
    }
    return botCommand(options);
  }
}

// REFRESH_DELAY, raised to the safe floor if it's set lower
function delayRange(cfg) {
  const min = Math.max(cfg.refreshDelay.min, MIN_CYCLE_DELAY);
  return { min, max: Math.max(cfg.refreshDelay.max, min) };
}

// Pick up .env edits between checks. Login details are left alone: changing
// them needs a restart since the session is already open.
function applyLiveSettings(bot) {
  const next = reloadConfig();
  if (!next) return;
  const prev = bot.config;
  const changes = [];
  if (next.facilityId.join(',') !== prev.facilityId.join(',')) changes.push(`cities ${prev.facilityId.join(',')} → ${next.facilityId.join(',')}`);
  if (next.refreshDelay.min !== prev.refreshDelay.min || next.refreshDelay.max !== prev.refreshDelay.max) changes.push(`delay ${prev.refreshDelay.min}-${prev.refreshDelay.max}s → ${next.refreshDelay.min}-${next.refreshDelay.max}s`);
  if (next.dailyRequestCap !== prev.dailyRequestCap) changes.push(`daily cap ${prev.dailyRequestCap} → ${next.dailyRequestCap}`);
  if (next.ntfyTopic !== prev.ntfyTopic) changes.push('alert topic changed');
  if (!changes.length) return;
  bot.config = { ...prev, facilityId: next.facilityId, refreshDelay: next.refreshDelay, dailyRequestCap: next.dailyRequestCap, ntfyTopic: next.ntfyTopic };
  bot.budget.cap = next.dailyRequestCap;
  log(`settings updated: ${changes.join('; ')}`);
}
