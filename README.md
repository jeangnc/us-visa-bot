# US Visa Bot 🤖

An automated bot that monitors and reschedules US visa interview appointments to get you an earlier date.

## Features

- 🔄 Continuously monitors available appointment slots
- 📅 Automatically books earlier dates when found
- 🎯 Configurable target and minimum date constraints
- 🚨 Exits successfully when target date is reached
- 📊 Detailed logging with timestamps
- 🔐 Secure authentication with environment variables
- 🔁 Exponential backoff with jitter on network errors
- 🛡️ Retry logic for transient failures (socket hangup, timeouts)

## How It Works

The bot logs into your account on https://ais.usvisa-info.com/ and checks for available appointment dates every few seconds. When it finds a date earlier than your current booking (and within your specified constraints), it automatically reschedules your appointment.

## Project Structure

```
us-visa-bot/
├── src/
│   ├── index.js          # CLI entry point (Commander)
│   ├── commands/
│   │   └── bot.js        # Bot orchestration, retry logic
│   └── lib/
│       ├── bot.js        # Bot logic (check dates, book)
│       ├── client.js     # HTTP client for visa API
│       ├── config.js     # Environment config
│       └── utils.js      # sleep, log, error helpers
├── .env                  # Your credentials (create from .env.example)
├── package.json
└── README.md
```

## Prerequisites

- Node.js 16+
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
FACILITY_IDS=fac1,fac2   # comma-separated, or single FACILITY_ID
REFRESH_DELAY=3
```

### Finding Your Configuration Values

| Variable | Description | How to Find |
|----------|-------------|-------------|
| `EMAIL` | Your login email | Your credentials for ais.usvisa-info.com |
| `PASSWORD` | Your login password | Your credentials for ais.usvisa-info.com |
| `COUNTRY_CODE` | Your country code | Found in URL: `https://ais.usvisa-info.com/en-{COUNTRY_CODE}/` <br>Examples: `br` (Brazil), `fr` (France), `de` (Germany) |
| `SCHEDULE_ID` | Your appointment schedule ID | Found in URL when rescheduling: <br>`https://ais.usvisa-info.com/en-{COUNTRY_CODE}/niv/schedule/{SCHEDULE_ID}/continue_actions` |
| `FACILITY_IDS` | One or more consulate facility IDs, comma-separated | Found in network calls when selecting dates, or inspect the date selector dropdown <br>Example: Paris = `44` |
| `FACILITY_ID` | (Optional legacy) Single facility ID if you prefer | Same as above |
| `REFRESH_DELAY` | Seconds between checks | Optional, defaults to 3 seconds |

## Usage

Run the bot with your current appointment date:

```bash
node index.js -c <current_date> [-t <target_date>] [-m <min_date>]
```

### Command Line Arguments

| Flag | Long Form | Required | Description |
|------|-----------|----------|-------------|
| `-c` | `--current` | ✅ | Your current booked interview date (YYYY-MM-DD) |
| `-t` | `--target` | ❌ | Target date to stop at - exits successfully when reached |
| `-m` | `--min` | ❌ | Minimum acceptable date - skips dates before this |
| `--dry-run` | | ❌ | Log what would be booked without actually booking |

### Examples

```bash
# Basic usage - reschedule to any earlier date
node index.js -c 2023-06-15

# With target date - stop when you get June 1st or earlier  
node index.js -c 2023-06-15 -t 2023-06-01

# With minimum date - only accept dates after May 1st
node index.js -c 2023-06-15 -m 2023-05-01

# With both constraints - only book between May 1st and June 1st
node index.js -c 2023-06-15 -t 2023-06-01 -m 2023-05-01

# Get help
node index.js --help
```

## How It Behaves

The bot will:
1. **Log in** to your account using provided credentials
2. **Check** for available dates every few seconds (per facility)
3. **Compare** found dates against your constraints:
   - Must be earlier than current date (`-c`)
   - Must be after minimum date (`-m`) if specified
   - Will exit successfully if target date (`-t`) is reached
4. **Book** the appointment automatically if conditions are met
5. **Continue** monitoring until target is reached or manually stopped

### Error Recovery

- **Socket hangup / network errors**: Exponential backoff (5s base, up to 120s) with jitter; re-login and retry
- **Check dates failures**: Up to 3 retries before triggering full re-login
- **Session/auth errors**: Immediate retry with fresh login
- **Booking HTTP errors**: Thrown with status and response details

## Output Examples

```
[2023-07-16T10:30:00.000Z] Initializing with current date 2023-08-15
[2023-07-16T10:30:00.000Z] Target date: 2023-07-01
[2023-07-16T10:30:00.000Z] Minimum date: 2023-06-01
[2023-07-16T10:30:01.000Z] Initializing visa bot...
[2023-07-16T10:30:01.000Z] Logging in (GET login page for CSRF + cookie)
[2023-07-16T10:30:02.000Z] Submitting login form
[2023-07-16T10:30:03.000Z] checking dates for facility 44
[2023-07-16T10:30:03.000Z] facility 44: nearest available date 2023-08-01
[2023-07-16T10:30:03.000Z] facility 44: earliest acceptable date 2023-07-15
[2023-07-16T10:30:04.000Z] checking time slots for facility 44 on 2023-07-15
[2023-07-16T10:30:04.000Z] booked time at facility 44 2023-07-15 09:00
[2023-07-16T10:30:04.000Z] Target date reached! Successfully booked appointment on 2023-07-15 (facility 44)
```

## Safety Features

- ✅ **Read-only until booking** - Only books when better dates are found
- ✅ **Respects constraints** - Won't book outside your specified date range
- ✅ **Graceful exit** - Stops automatically when target is reached
- ✅ **Error recovery** - Exponential backoff and retries on network errors
- ✅ **Secure credentials** - Uses environment variables for sensitive data
- ✅ **Dry run mode** - Test without actually booking

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

This project is licensed under the ISC License.

## Disclaimer

This bot is for educational purposes. Use responsibly and in accordance with the terms of service of the visa appointment system. The authors are not responsible for any misuse or consequences.
