import dotenv from 'dotenv';

dotenv.config();

// Index matches Date#getUTCDay()
export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// "mon,wed" -> [1, 3]; unset or "all" -> null (any day)
export function parseWeekdays(value, name) {
  if (!value || value.trim().toLowerCase() === 'all') return null;

  const days = value.split(',').map(d => d.trim().toLowerCase());
  const invalid = days.filter(d => !WEEKDAYS.includes(d));

  if (invalid.length > 0) {
    console.error(`${name} must be "all" or a comma-separated list of ${WEEKDAYS.join(', ')}; got "${value}"`);
    process.exit(1);
  }

  return days.map(d => WEEKDAYS.indexOf(d));
}

export function getConfig() {
  const config = {
    email: process.env.EMAIL,
    password: process.env.PASSWORD,
    scheduleId: process.env.SCHEDULE_ID,
    facilityId: process.env.FACILITY_ID,
    ascFacilityId: process.env.ASC_FACILITY_ID,
    countryCode: process.env.COUNTRY_CODE,
    maxDate: process.env.MAX_DATE,
    consulateWeekdays: parseWeekdays(process.env.CONSULATE_WEEKDAYS, 'CONSULATE_WEEKDAYS'),
    ascWeekdays: parseWeekdays(process.env.ASC_WEEKDAYS, 'ASC_WEEKDAYS'),
    refreshDelay: Number(process.env.REFRESH_DELAY || 3)
  };

  validateConfig(config);
  return config;
}

function validateConfig(config) {
  const required = ['email', 'password', 'scheduleId', 'facilityId', 'countryCode'];
  const missing = required.filter(key => !config[key]);

  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.map(k => k.replace(/[A-Z]/g, c => '_' + c).toUpperCase()).join(', ')}`);
    process.exit(1);
  }
}

export function getBaseUri(countryCode) {
  return `https://ais.usvisa-info.com/en-${countryCode}/niv`;
}
