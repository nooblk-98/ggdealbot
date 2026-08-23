# GG Deals Bot

A Telegram channel bot that watches [GG.deals](https://gg.deals) for game deals across multiple stores and posts new ones automatically. Uses [FlareSolverr](https://github.com/FlareSolverr/FlareSolverr) to get past Cloudflare.

[![Node.js](https://img.shields.io/badge/Node.js->=22-3c873a?style=flat-square)](https://nodejs.org)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ed?style=flat-square&logo=docker&logoColor=white)](https://github.com/nooblk-98/ggdealbot/pkgs/container/ggdealbot)
[![Docker Publish](https://img.shields.io/github/actions/workflow/status/nooblk-98/ggdealbot/docker-publish.yml?style=flat-square&label=build)](https://github.com/nooblk-98/ggdealbot/actions/workflows/docker-publish.yml)
[![License: MIT](https://img.shields.io/github/license/nooblk-98/ggdealbot?style=flat-square)](LICENSE)
[![Telegram Channel](https://img.shields.io/badge/Telegram-Live%20Channel-2CA5E0?style=flat-square&logo=telegram&logoColor=white)](https://t.me/game_dealzz)

> [!TIP]
> See it in action: join the live deals channel at [t.me/game_dealzz](https://t.me/game_dealzz)

## Features

- **Multi-store scraping**: Steam, Epic Games Store, Microsoft Store, Ubisoft Store, PlayStation Store, Rockstar Store (configurable)
- **Cloudflare bypass**: uses FlareSolverr to reliably access GG.deals
- **Per-store scraping**: each store is fetched individually for complete results
- **Price history**: tracks every observed price to detect drops over time
- **Price drop alerts**: flags it when a known deal resurfaces at an even lower price
- **Historical low badge**: highlights all-time low prices
- **Free game detection**: free promotions get a 🆓 FREE badge and bypass price filters
- **Flexible filters**: min discount %, max price, min rating, platform whitelist, free-only mode, per-store rating overrides
- **Duplicate prevention**: URL dedup, plus same-title skip within 24h
- **Silent mode**: batch deals into media group albums instead of individual messages
- **30-day retention**: old deals pruned automatically
- **Admin alerts**: scrape failures and suspected site-markup breakage are DMed privately to the admin, never posted to the public channel
- **Docker support**: single-container deployment with docker-compose, multi-arch images published to GHCR

## How it works

1. **Scraping**: on each cron tick, a FlareSolverr session is created and each store is fetched individually. The session is destroyed after the run.
2. **Filtering**: deals are filtered by discount, price, rating, and platform thresholds. Free games bypass price/discount filters automatically.
3. **Deduplication**: deals already in the database (by URL), or with the same title posted in the last 24h, are skipped.
4. **Price history**: each new deal's price is recorded. If a deal resurfaces at a lower price than previously seen, a Price Drop badge is shown.
5. **Delivery**: each deal is posted as a photo with a caption and a "View on GG.deals" button. In silent mode, deals are batched into photo albums (up to 10 per album).
6. **Retention**: deals older than 30 days are automatically removed from the database.
7. **Failure alerts**: if a scrape errors out, or returns 0 deals for 3 consecutive runs (a likely sign GG.deals changed its markup), the admin is notified privately, throttled to once per hour.

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org) 22+
- A running [FlareSolverr](https://github.com/FlareSolverr/FlareSolverr) instance
- A [Telegram bot token](https://t.me/BotFather) and a channel ID

### Installation

```bash
git clone https://github.com/nooblk-98/ggdealbot.git
cd ggdealbot
npm install
cp .env.example .env
```

Edit `.env` with your credentials:

```ini
FLARE_SOLVER_URL=http://your-flaresolverr:8191
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=@yourchannel
```

### Usage

```bash
# Start the bot (checks every hour by default; set CRON_SCHEDULE to change)
npm run bot

# One-off scrape to a file
npm run scrape
```

### Docker

```bash
docker compose up -d
```

> [!NOTE]
> Make sure `.env` exists before running: `docker-compose.yml` substitutes its `environment:` values from `.env` automatically. It also defaults `CRON_SCHEDULE` to every 5 hours instead of the code's hourly default.

A multi-arch (`amd64`/`arm64`) image is also published to GHCR on every release: `ghcr.io/nooblk-98/ggdealbot:latest`.

## Configuration

All configuration is via `.env`. Restart the bot to apply changes.

| Variable | Default | Description |
|---|---|---|
| `FLARE_SOLVER_URL` | required | URL of your FlareSolverr instance |
| `TELEGRAM_BOT_TOKEN` | required | Bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | required | Target channel/group ID |
| `ADMIN_TELEGRAM_ID` | none | Your Telegram user ID. Enables `/stats` and routes error/failure alerts to you privately instead of the public channel |
| `CRON_SCHEDULE` | `0 * * * *` | How often to check for new deals |
| `SCRAPE_PAGES` | `1` | Pages to scrape per store per run |
| `STORES` | `Steam` | Comma-separated store names |
| `MIN_DISCOUNT` | `0` | Minimum discount % to include |
| `MAX_PRICE` | `0` | Maximum price in USD (0 = no limit) |
| `MIN_RATING` | `0` | Minimum deal rating score (0 = no filter) |
| `MIN_RATING_OVERRIDES` | none | Per-store rating overrides, e.g. `steam:7.5,epic:6.0` |
| `PLATFORMS` | none | Comma-separated platform filter, e.g. `Windows, Steam` |
| `FREE_ONLY` | `false` | Only post free-to-keep deals |
| `SILENT_MODE` | `false` | Batch deals into media group albums |
| `LAST_SCRAPE_FILE` | `/tmp/last_scrape` | Path to the marker file used by the Docker healthcheck |
| `DB_PATH` | `data/deals.db` | Override the SQLite database file location |

### Supported stores

| Store | Config name |
|---|---|
| Steam | `Steam` |
| Epic Games Store | `Epic Games Store` |
| Microsoft Store | `Microsoft Store` |
| PlayStation Store | `PlayStation Store` |
| Ubisoft Store | `Ubisoft Store` |
| Rockstar Store | `Rockstar Store` |

## Admin commands

When `ADMIN_TELEGRAM_ID` is set, these commands are available to you in a DM with the bot:

| Command | Description |
|---|---|
| `/start` | Confirms the bot is running |
| `/stats` | Uptime, last scrape time, total deals sent, and active configuration |

## Development

```bash
npm install
npm test    # unit tests, via Node's built-in test runner
npm run lint
```

Tests live in `test/` and cover the pure logic: HTML extraction (against a saved fixture), filters, message formatting, and the SQLite layer (in-memory DB). They don't hit FlareSolverr, GG.deals, or Telegram.

## Data

Runtime data lives in `data/` (gitignored):

- `deals.db`: SQLite database with sent deals and price history
- `deals.json` / `deals.csv`: output from one-off scrape runs
