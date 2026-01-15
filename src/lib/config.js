import dotenv from 'dotenv';

dotenv.config();

export function getConfig() {
  const config = {
    email: process.env.EMAIL,
    password: process.env.PASSWORD,
    scheduleId: process.env.SCHEDULE_ID,
    facilityIds: parseFacilityIds(),
    countryCode: process.env.COUNTRY_CODE,
    refreshDelay: Number(process.env.REFRESH_DELAY || 3)
  };

  validateConfig(config);
  return config;
}

function validateConfig(config) {
  const required = ['email', 'password', 'scheduleId', 'countryCode'];
  const missing = required.filter(key => !config[key]);

  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.map(k => k.toUpperCase()).join(', ')}`);
    process.exit(1);
  }

  if (!config.facilityIds || config.facilityIds.length === 0) {
    console.error('Missing required environment variable: FACILITY_ID or FACILITY_IDS');
    process.exit(1);
  }
}

function parseFacilityIds() {
  const raw = process.env.FACILITY_IDS || process.env.FACILITY_ID;

  if (!raw) {
    return [];
  }

  return raw
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);
}

export function getBaseUri(countryCode) {
  return `https://ais.usvisa-info.com/en-${countryCode}/niv`;
}
