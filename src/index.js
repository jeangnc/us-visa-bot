#!/usr/bin/env node

import { program } from 'commander';
import { rescheduleCommand } from './commands/reschedule.js';

program
  .name('us-visa-bot')
  .description('Automated US visa appointment rescheduling bot')
  .version('0.0.1');

program
  .command('reschedule')
  .description('Monitor and reschedule visa appointments')
  .requiredOption('-c, --current <date>', 'current booked date')
  .option('-t, --target <date>', 'target date to stop at')
  .option('-m, --min <date>', 'minimum date acceptable')
  .action(rescheduleCommand);

// Default command for backward compatibility
program
  .requiredOption('-c, --current <date>', 'current booked date')
  .option('-t, --target <date>', 'target date to stop at')
  .option('-m, --min <date>', 'minimum date acceptable')
  .action(rescheduleCommand);

program.parse();