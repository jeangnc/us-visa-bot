# us-visa-bot
Bot to anticipate the interview date for a US visa.

## How it works

The bot is quite simple. You provide some informations for the bot to sign in in your behalf on https://ais.usvisa-info.com/, and then
it checks the nearest dates every few seconda. When it finds a closer date, it automatically book that time for you.

## Installing

You'll need node 16+ to run the bot. Also, you'll have to install some dependencies:

```sh
npm install
```

## Usage

```sh
export USERNAME=''
export PASSWORD = ''
export SCHEDULE_ID = ''
export FACILITY_ID = ''

./index.js <your current interview date, ex: 2023-01-01>
```

