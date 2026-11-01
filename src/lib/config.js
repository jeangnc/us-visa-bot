import dotenv from 'dotenv';

dotenv.config();

export function getConfig() {
  const config = {
    email: process.env.EMAIL,
    password: process.env.PASSWORD,
    scheduleId: process.env.SCHEDULE_ID,
    facilityId: parseFacilityIds(process.env.FACILITY_ID),
    countryCode: process.env.COUNTRY_CODE,
    refreshDelay: parseRefreshDelay(process.env.REFRESH_DELAY || '180-300'),
    dailyRequestCap: Number(process.env.DAILY_REQUEST_CAP) || 500
  };

  validateConfig(config);
  return config;
}

function parseFacilityIds(raw) {
  if (!raw) return [];
  const ids = String(raw).split(',').map(s => s.trim()).filter(Boolean);
  if (ids.length === 0) throw new Error(`Invalid FACILITY_ID "${raw}". Use one or more comma-separated IDs.`);
  return ids;
}

function parseRefreshDelay(raw) {
  const parts = String(raw).split('-').map(s => Number(s.trim()));
  if (parts.length === 1 && Number.isFinite(parts[0])) {
    return { min: parts[0], max: parts[0] };
  }
  if (parts.length === 2 && parts.every(Number.isFinite) && parts[0] <= parts[1]) {
    return { min: parts[0], max: parts[1] };
  }
  throw new Error(`Invalid REFRESH_DELAY "${raw}". Use a number (e.g. 240) or a range (e.g. 180-300).`);
}

function validateConfig(config) {
  const required = ['email', 'password', 'scheduleId', 'countryCode'];
  const missing = required.filter(key => !config[key]);
  if (config.facilityId.length === 0) missing.push('facilityId');

  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.map(envName).join(', ')}`);
    process.exit(1);
  }
}

// scheduleId -> SCHEDULE_ID
const envName = key => key.replace(/[A-Z]/g, c => '_' + c).toUpperCase();

export function getBaseUri(countryCode) {
  return `https://ais.usvisa-info.com/en-${countryCode}/niv`;
}
