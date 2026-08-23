FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY src/ src/
COPY images/ images/

# Healthy = last successful scrape within 6 hours (schedule is every 5h)
HEALTHCHECK --interval=30m --timeout=10s --start-period=10m --retries=2 CMD sh -c 'f="${LAST_SCRAPE_FILE:-/tmp/last_scrape}"; test -f "$f" && test $(( $(date +%s) - $(cat "$f") )) -lt 21600' || exit 1

CMD ["node", "src/bot.js"]
