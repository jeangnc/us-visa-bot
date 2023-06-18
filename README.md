# us-visa-bot
Bot to anticipate the interview date for a US visa.

## How it works

The bot is quite simple. You provide some informations for the bot to sign in in your behalf on https://ais.usvisa-info.com/, and then
he checks the nearest dates every few seconds, and when it finds a closer date, it automatically book that time for you.

## How to find the variables?

- EMAIL and PASSWORD are your credentials to https://ais.usvisa-info.com.
- SCHEDULE_ID can be found in the URL when trying to reschedule manually https://ais.usvisa-info.com/fr-fr/niv/schedule/SCHEDULE_ID/continue_actions.
- FACILITY_ID can be found looking at the network calls when trying to reschedule manually, when you get on the page where you can select a new date, you should see a network call similar to https://ais.usvisa-info.com/fr-fr/niv/schedule/XXXX/appointment/address/YY. Facility id is your YY. Paris is 44. Alternatively you can inspect the Selector on this page and look at the value.


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

