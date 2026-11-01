export const FACILITY_NAMES = {
  ca: {
    '89': 'Calgary',
    '90': 'Halifax',
    '91': 'Montreal',
    '92': 'Ottawa',
    '93': 'Quebec City',
    '94': 'Toronto',
    '95': 'Vancouver',
  },
};

export function facilityName(countryCode, id) {
  return FACILITY_NAMES[countryCode]?.[String(id)] || `#${id}`;
}
