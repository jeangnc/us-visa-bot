# us-visa-bot
Bot to anticipate the interview date for a US visa.

## How it works

The bot is quite simple. You provide some informations for the bot to sign in in your behalf on https://ais.usvisa-info.com/, and then
it checks the nearest dates every few seconds. When it finds a closer date, it automatically book that time for you.

## How to find the variables?

- EMAIL and PASSWORD are your credentials to https://ais.usvisa-info.com.
- LOCALE depends on your language, can be found in the URL when trying to reschedule https://ais.usvisa-info.com/{LOCALE}/. 'fr-fr' for France, 'pt-br' for Brazil...
- SCHEDULE_ID can be found in the URL when trying to reschedule manually https://ais.usvisa-info.com/{LOCALE}/niv/schedule/{SCHEDULE_ID}/continue_actions.
- FACILITY_ID can be found looking at the network calls when trying to reschedule manually, when you get on the page where you can select a new date, you should see a network call similar to https://ais.usvisa-info.com/{LOCALE}/niv/schedule/{SCHEDULE_ID}/appointment/address/{FACILITY_ID}. Ecuador 108 Guayaquil. Alternatively you can inspect the Selector on this page and look at the value.
- TELEGRAM Using Telegram with constants TELEGRAM_TOKEN and TELEGRAM_CHAT_ID, you will receive notifications only for successfully booked appointment reservations.
- WAITING TIME Algorithm to wait for every minute multiple, which is the exact time appointment slots are released.


## Installing

You'll need node 16+ to run the bot. Also, you'll have to install some dependencies:

```sh
npm install
```

## Usage

```sh
export EMAIL=''
export PASSWORD=''
export LOCALE=''
export SCHEDULE_ID=
export FACILITY_ID=
export TELEGRAM_TOKEN=
export TELEGRAM_CHAT_ID=

./index.js <your current interview date, ex: 2023-01-01>
```
