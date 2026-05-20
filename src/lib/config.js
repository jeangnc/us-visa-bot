import dotenv from 'dotenv';

dotenv.config();

export function getConfig() {
  const refreshDelayMin = Number(process.env.REFRESH_DELAY_MIN ?? 60);
  const refreshDelayMax = Number(process.env.REFRESH_DELAY_MAX ?? 120);

  const config = {
    email: process.env.EMAIL,
    password: process.env.PASSWORD,
    scheduleId: process.env.SCHEDULE_ID,
    facilityId: process.env.FACILITY_ID,
    countryCode: process.env.COUNTRY_CODE,
    refreshDelayMin,
    refreshDelayMax
  };

  validateConfig(config);
  return config;
}

function validateConfig(config) {
  const required = ['email', 'password', 'scheduleId', 'facilityId', 'countryCode'];
  const missing = required.filter(key => !config[key]);

  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.map(k => k.toUpperCase()).join(', ')}`);
    process.exit(1);
  }

  if (
    !Number.isFinite(config.refreshDelayMin) ||
    !Number.isFinite(config.refreshDelayMax) ||
    config.refreshDelayMin <= 0 ||
    config.refreshDelayMax < config.refreshDelayMin
  ) {
    console.error(
      `Invalid REFRESH_DELAY_MIN/REFRESH_DELAY_MAX (got ${config.refreshDelayMin}/${config.refreshDelayMax}). ` +
      `Both must be positive numbers and MAX must be >= MIN.`
    );
    process.exit(1);
  }
}

export function getBaseUri(countryCode) {
  return `https://ais.usvisa-info.com/en-${countryCode}/niv`;
}
