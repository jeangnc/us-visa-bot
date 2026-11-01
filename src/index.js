#!/usr/bin/env node

import { program } from 'commander';
import { botCommand } from './commands/bot.js';

// Keep running if the terminal that started the bot is closed
process.on('SIGHUP', () => {});

program
  .name('us-visa-bot')
  .description('Automated US visa appointment rescheduling bot')
  .version('0.0.1');

program
  .command('bot')
  .description('Monitor and reschedule visa appointments')
  .option('-c, --current <date>', 'book only dates before this (default: the day after BOOK_TO in .env)')
  .option('-t, --target <date>', 'target date to stop at')
  .option('-m, --min <date>', 'minimum date acceptable (default: BOOK_FROM in .env)')
  .option('--dry-run', 'only log what would be booked without actually booking (default: BOOK_MODE=watch in .env)')
  .action(botCommand);

// Default command for backward compatibility
program
  .option('-c, --current <date>', 'book only dates before this (default: the day after BOOK_TO in .env)')
  .option('-t, --target <date>', 'target date to stop at')
  .option('-m, --min <date>', 'minimum date acceptable (default: BOOK_FROM in .env)')
  .option('--dry-run', 'only log what would be booked without actually booking (default: BOOK_MODE=watch in .env)')
  .action(botCommand);

program.parse();
