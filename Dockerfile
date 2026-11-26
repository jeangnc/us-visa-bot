FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod

COPY src ./src

# Pass dates as arguments, e.g. docker run <image> -c 2028-01-31 -t 2026-12-01 -m 2026-12-31
# Config (EMAIL, PASSWORD, LOCALE, SCHEDULE_ID, FACILITY_ID, REFRESH_DELAY) comes from env vars.
ENTRYPOINT ["node", "src/index.js"]
