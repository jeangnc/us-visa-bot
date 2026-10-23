# US Visa Bot 🤖

An automated bot that monitors and reschedules US visa interview appointments to get you an earlier date.

## Features

- 🔄 Continuously monitors available appointment slots
- 📅 Automatically books earlier dates when found  
- 🎯 Configurable target, minimum and maximum date constraints
- 🗓️ Allowed weekdays, separately for the interview and the ASC appointment
- 🪪 Books the ASC (biometrics/CASV) appointment together with the interview
- 👨‍👩‍👧 Supports group (family) schedules
- 🧮 Protects limited reschedule attempts (max date + stop on unconfirmed booking)
- 🚨 Exits successfully when target date is reached
- 📊 Detailed logging with timestamps
- 🔐 Secure authentication with environment variables

## How It Works

The bot logs into your account on https://ais.usvisa-info.com/ and checks for available appointment dates every few seconds. When it finds a date earlier than your current booking (and within your specified constraints), it automatically reschedules your appointment.

## Prerequisites

- Node.js 18+ 
- A valid US visa interview appointment
- Access to https://ais.usvisa-info.com/

## Installation

1. Clone the repository:
```bash
git clone https://github.com/your-username/us-visa-bot.git
cd us-visa-bot
```

2. Install dependencies:
```bash
npm install
```

## Configuration

Create a `.env` file in the project root with your credentials:

```env
EMAIL=your.email@example.com
PASSWORD=your_password
COUNTRY_CODE=your_country_code
SCHEDULE_ID=your_schedule_id
FACILITY_ID=your_facility_id
ASC_FACILITY_ID=your_asc_facility_id   # only in countries with an ASC appointment
MAX_DATE=2026-11-30                    # optional
CONSULATE_WEEKDAYS=mon,wed             # optional, defaults to all
ASC_WEEKDAYS=all                       # optional, defaults to all
REFRESH_DELAY=3
```

See [.env.example](.env.example) for a commented template.

### Finding Your Configuration Values

| Variable | Description | How to Find |
|----------|-------------|-------------|
| `EMAIL` | Your login email | Your credentials for ais.usvisa-info.com |
| `PASSWORD` | Your login password | Your credentials for ais.usvisa-info.com |
| `COUNTRY_CODE` | Your country code | Found in URL: `https://ais.usvisa-info.com/en-{COUNTRY_CODE}/` <br>Examples: `br` (Brazil), `fr` (France), `de` (Germany) |
| `SCHEDULE_ID` | Your appointment schedule ID | Found in URL when rescheduling: <br>`https://ais.usvisa-info.com/en-{COUNTRY_CODE}/niv/schedule/{SCHEDULE_ID}/continue_actions` |
| `FACILITY_ID` | Your consulate facility ID | See [Finding Your Facility IDs](#finding-your-facility-ids) <br>Examples: Paris = `44`, Sao Paulo = `56` |
| `ASC_FACILITY_ID` | Your ASC (biometrics, "CASV" in Brazil) facility ID | Optional. **Required in countries with a separate ASC appointment** (e.g. Brazil, Mexico, Colombia): without it the site drops your existing ASC appointment. See [Finding Your Facility IDs](#finding-your-facility-ids) |
| `MAX_DATE` | Latest acceptable interview date (YYYY-MM-DD) | Optional. See [Limited reschedule attempts](#limited-reschedule-attempts). The `--max` flag overrides it |
| `CONSULATE_WEEKDAYS` | Weekdays you can attend the interview | Optional. Comma-separated `mon,tue,wed,thu,fri,sat,sun` (case-insensitive), or `all`. Defaults to `all`. Example: `mon,wed` |
| `ASC_WEEKDAYS` | Weekdays you can attend the ASC appointment | Optional, same format as `CONSULATE_WEEKDAYS`. Defaults to `all` |
| `REFRESH_DELAY` | Seconds between checks | Optional, defaults to 3 seconds. Short delays get the account soft-banned sooner, see [Rate Limiting](#rate-limiting-soft-ban) |

### Finding Your Facility IDs

1. Log in, open **Reschedule Appointment** and click **Continue** until you reach the page with the location and date fields. Opening this page does not use a reschedule attempt; **do not submit it**.
2. Open the browser DevTools console (F12) and run:
   ```js
   [...document.querySelectorAll('select[id$="facility_id"] option')].map(o=>`${o.parentElement.id} = ${o.value} (${o.text})`).join('\n')
   ```
3. The `consulate_appointment` line for your city is `FACILITY_ID`; the `asc_appointment` line (if any) is `ASC_FACILITY_ID`.

## Usage

Run the bot with your current appointment date:

```bash
npm start -- -c <current_date> [-t <target_date>] [-m <min_date>] [--max <max_date>] [--dry-run]
```

### Command Line Arguments

| Flag | Long Form | Required | Description |
|------|-----------|----------|-------------|
| `-c` | `--current` | ✅ | Your current booked interview date (YYYY-MM-DD) |
| `-t` | `--target` | ❌ | Target date to stop at - exits successfully when reached |
| `-m` | `--min` | ❌ | Minimum acceptable date - skips dates before this |
| | `--max` | ❌ | Maximum acceptable date - skips dates after this (overrides `MAX_DATE`) |
| | `--dry-run` | ❌ | Go through the whole booking flow but only log what would be submitted |

### Examples

```bash
# Basic usage - reschedule to any earlier date
npm start -- -c 2023-06-15

# With target date - stop when you get June 1st or earlier  
npm start -- -c 2023-06-15 -t 2023-06-01

# With minimum date - only accept dates after May 1st
npm start -- -c 2023-06-15 -m 2023-05-01

# With both constraints - only book between May 1st and June 1st
npm start -- -c 2023-06-15 -t 2023-06-01 -m 2023-05-01

# Limited attempts - only spend one on a date until the end of May
npm start -- -c 2023-08-15 --max 2023-05-31

# Check your setup without booking anything
npm start -- -c 2023-06-15 --dry-run

# Get help
npm start -- --help
```

### Saving the Log

The bot only prints to the terminal. To keep the whole run (useful to see, for example, when the site started rate limiting), also write it to `bot.log`:

```powershell
# Windows PowerShell
npm start -- -c 2023-06-15 | Tee-Object -FilePath bot.log -Append
```

```bash
# macOS / Linux
npm start -- -c 2023-06-15 | tee -a bot.log
```

`bot.log` is gitignored because it contains your schedule and applicant IDs.

## Limited Reschedule Attempts

Some countries limit how many times you can reschedule (e.g. Brazil and Canada allow 3). Without constraints the bot would spend an attempt on any earlier date, even one only a day earlier.

With a max date (`MAX_DATE` or `--max`):
- Dates after the max date are ignored.
- After each booking, the max date steps down to **the end of the previous month**, so another attempt is only spent to gain at least a whole month. Example: with `--max 2026-11-30`, booking Nov 20 makes only October count; booking in October makes September the limit, which is already in the past, so the bot stops.
- The bot stops when the max date has passed, because nothing else can be found.
- If the site does not confirm a submitted booking, the bot stops instead of retrying, so an unknown state never costs a second attempt. Check the site before restarting.

## Rate Limiting (Soft Ban)

The site has no published rate limit, but too many requests or logins in a short time get the account temporarily throttled ("soft ban"):

- **Symptom:** the date list comes back empty (`no dates available`) even though dates existed minutes before. In the browser, the reschedule page shows a red message saying there are no appointments at the selected location *or the system is busy* (in Portuguese: "Não há agendamentos disponíveis no local selecionado ou o sistema está ocupado"). The account itself is not locked, and you can still log in.
- **Cause:** every run of the bot (including `--dry-run`) and every debugging script logs in again, and manual page refreshes also count. In our case, about 8 logins within 10 minutes (several dry runs and debugging scripts) triggered it right away. Polling alone also adds up: community reports mention empty lists after ~48 requests, or after ~3 hours of polling every 60 seconds. In one of our runs at a ~30 second interval, the site started resetting connections (`ECONNRESET`) after about 2 hours of polling, and after the third reset the date list came back empty.
- **Duration:** there is no official policy. Community reports consistently mention **about 5 hours**. Some tools simply sleep 5 hours when the list is empty, others retry after 1 hour.
- **What the bot does:** after a connection reset, or after 3 empty date lists in a row, it pauses for 1 hour and then logs in again, instead of polling through the ban (which returns nothing and may extend it). The site's session also expires after about 1 hour; the bot logs in again on its own.
- **What to do:** leave the bot running and let it pause. Do not keep refreshing the site or restarting the bot, since each restart is a new login.
- **Prevention:** do not run several dry runs, restarts or debugging scripts back to back; test once and leave it running. Prefer a longer `REFRESH_DELAY`: a steady, slower poll over the whole day catches more cancellations than a fast burst followed by hours of soft ban.

Sources (community reports, not official): [gist comments on ban length and intervals](https://gist.github.com/Svision/04202d93fb32d14f00ac746879820722), [uxDaniel/visa_rescheduler#76](https://github.com/uxDaniel/visa_rescheduler/issues/76), [zangjiucheng/us_visa_scheduler](https://github.com/zangjiucheng/us_visa_scheduler).

## How It Behaves

The bot will:
1. **Log in** to your account using provided credentials
2. **Check** for available dates every few seconds
3. **Compare** found dates against your constraints:
   - Must be earlier than current date (`-c`)
   - Must be after minimum date (`-m`) if specified
   - Must be before maximum date (`--max` / `MAX_DATE`) if specified
   - Must fall on an allowed interview weekday (`CONSULATE_WEEKDAYS`) if specified
   - Will exit successfully if target date (`-t`) is reached
4. **Find an ASC slot** for the chosen interview slot when `ASC_FACILITY_ID` is set: the first one on an allowed weekday (`ASC_WEEKDAYS`). No ASC slot, no booking; the bot tries again on the next check
5. **Book** the appointment the same way the site does: confirm the scheduling limit warning, select every applicant of a group schedule, then submit
6. **Continue** monitoring until target is reached or manually stopped

## Output Examples

```
[2023-07-16T10:30:00.000Z] Initializing with current date 2023-08-15
[2023-07-16T10:30:00.000Z] Max date: 2023-07-31
[2023-07-16T10:30:00.000Z] Target date: 2023-07-01
[2023-07-16T10:30:01.000Z] Logging in
[2023-07-16T10:30:03.000Z] date 2023-09-01 is further than already booked (2023-08-15)
[2023-07-16T10:30:03.000Z] no good dates found after filtering
[2023-07-16T10:30:06.000Z] found 1 good dates: 2023-07-15, using earliest: 2023-07-15
[2023-07-16T10:30:06.000Z] booking 2023-07-15 09:00 + ASC 2023-07-10 08:30
[2023-07-16T10:30:07.000Z] group schedule, selecting applicants: 111, 222
[2023-07-16T10:30:08.000Z] booked 2023-07-15 09:00 + ASC 2023-07-10 08:30
[2023-07-16T10:30:08.000Z] Rescheduled to 2023-07-15. From now on only dates up to 2023-06-30 count.
[2023-07-16T10:30:08.000Z] Target date reached! Successfully booked appointment on 2023-07-15
```

## Safety Features

- ✅ **Read-only until booking** - Only books when better dates are found
- ✅ **Respects constraints** - Won't book outside your specified date range
- ✅ **Keeps your ASC appointment** - Never submits without an ASC slot when `ASC_FACILITY_ID` is set
- ✅ **Verified bookings** - Stops if the site does not confirm a booking, instead of retrying blindly
- ✅ **Graceful exit** - Stops automatically when target is reached
- ✅ **Error recovery** - Pauses 1 hour after connection resets or repeated empty date lists, then logs in again
- ✅ **Secure credentials** - Uses environment variables for sensitive data

## Testing

```bash
npm test
```

The tests run offline against a stubbed client.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

This project is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE).

Commercial use is not permitted. You may use, modify, and distribute this
software for noncommercial purposes — personal use, research, education, and
use by nonprofit and government organizations. Selling it, offering it as a
paid service, or using it as part of a commercial offering requires a separate
license. Contact the copyright holder to discuss commercial terms.

## Disclaimer

This bot is for educational purposes. Use responsibly and in accordance with the terms of service of the visa appointment system. The authors are not responsible for any misuse or consequences.
