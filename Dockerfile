FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY src/ src/

# Healthy = last successful scrape within 6 hours (schedule is every 5h)
HEALTHCHECK --interval=30m --timeout=10s --start-period=10m --retries=2 CMD test -f /tmp/last_scrape && test $(( $(date +%s) - $(cat /tmp/last_scrape) )) -lt 21600 || exit 1

CMD ["node", "src/bot.js"]
