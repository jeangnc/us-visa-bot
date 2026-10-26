#!/usr/bin/env node

// Separate entry point: the main CLI requires -c on every invocation
import { getConfig } from './lib/config.js';
import { notify } from './lib/notify.js';

const sent = await notify(
  getConfig(),
  'Visa bot test email',
  'This is a test from your visa appointment bot. Booking notifications and warnings will arrive like this.'
);

process.exit(sent ? 0 : 1);
