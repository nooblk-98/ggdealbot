# gamedeals-bot

A Telegram channel bot that monitors [GG.deals](https://gg.deals) for game deals across multiple stores and auto-posts new deals every 5 hours. Uses [FlareSolverr](https://github.com/FlareSolverr/FlareSolverr) to bypass Cloudflare protection.

[![Node.js](https://img.shields.io/badge/Node.js->=22-3c873a?style=flat-square)](https://nodejs.org)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ed?style=flat-square&logo=docker&logoColor=white)](https://docker.com)
[![Telegram Channel](https://img.shields.io/badge/Telegram-Live%20Channel-2CA5E0?style=flat-square&logo=telegram&logoColor=white)](https://t.me/+VXwxTf3aF-JlOGNl)

> 📢 **See it in action** — join the live deals channel: [t.me/+VXwxTf3aF-JlOGNl](https://t.me/+VXwxTf3aF-JlOGNl)

## Features

- **Multi-store scraping** — Steam, Epic Games Store, Microsoft Store, Ubisoft Store, PlayStation Store, Rockstar Store (configurable)
- **Cloudflare bypass** — Uses FlareSolverr to reliably access GG.deals
- **Per-store scraping** — Each store is fetched individually for complete results
- **Price history** — Tracks every observed price to detect drops over time
- **Price drop alerts** — When a known deal goes even lower, the bot flags it
- **Historical low badge** — Highlights all-time low prices
- **Free game detection** — Free promotions get a 🆓 FREE badge and bypass price filters
- **Flexible filters** — Min discount %, max price, min rating, platform whitelist, free-only mode, per-store rating overrides
- **Duplicate prevention** — URL dedup + same title skipped within 24h
- **Silent mode** — Batch deals into media groups instead of individual messages
- **30-day retention** — Old deals pruned automatically
- **Error alerts** — Telegram notification when the scraper fails
- **Docker support** — Single-container deployment with docker-compose

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) 22+
- A running [FlareSolverr](https://github.com/FlareSolverr/FlareSolverr) instance
- A [Telegram bot token](https://t.me/BotFather) and a channel ID

### Installation

```bash
git clone https://github.com/yourusername/gamedeals-bot.git
cd gamedeals-bot
npm install
cp .env.example .env
```

Edit `.env` with your credentials:

```ini
FLARE_SOLVER_URL=http://your-flaresolver:8191
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=@yourchannel
```

### Usage

```bash
# Start the bot (checks every 5 hours by default)
npm run bot

# One-off scrape to file
npm run scrape
```

### Docker

```bash
docker compose up -d
```

> Make sure `.env` exists before running — credentials are loaded via `env_file` in `docker-compose.yml`.

## Configuration

All configuration is via `.env`. Restart the bot to apply changes.

| Variable | Default | Description |
|---|---|---|
| `FLARE_SOLVER_URL` | required | URL of your FlareSolverr instance |
| `TELEGRAM_BOT_TOKEN` | required | Bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | required | Target channel/group ID |
| `CRON_SCHEDULE` | `0 */5 * * *` | How often to check for new deals |
| `SCRAPE_PAGES` | `1` | Pages to scrape per store per run |
| `STORES` | `Steam` | Comma-separated store names |
| `MIN_DISCOUNT` | `0` | Minimum discount % to include |
| `MAX_PRICE` | `0` | Maximum price in USD (0 = no limit) |
| `MIN_RATING` | `0` | Minimum deal rating score (0 = no filter) |
| `MIN_RATING_OVERRIDES` | — | Per-store rating overrides e.g. `steam:7.5,epic:6.0` |
| `PLATFORMS` | — | Comma-separated platform filter e.g. `Windows, Steam` |
| `FREE_ONLY` | `false` | Only post free-to-keep deals |
| `SILENT_MODE` | `false` | Batch deals into media group albums |

### Supported Stores

| Store | Config name |
|---|---|
| Steam | `Steam` |
| Epic Games Store | `Epic Games Store` |
| Microsoft Store | `Microsoft Store` |
| PlayStation Store | `PlayStation Store` |
| Ubisoft Store | `Ubisoft Store` |
| Rockstar Store | `Rockstar Store` |

## How It Works

1. **Scraping** — On each cron tick, a FlareSolverr session is created and each store is fetched individually. The session is destroyed after the run.
2. **Filtering** — Deals are filtered by discount, price, rating, and platform thresholds. Free games bypass price/discount filters automatically.
3. **Deduplication** — Deals already in the database (by URL) or with the same title posted in the last 24h are skipped.
4. **Price history** — Each new deal's price is recorded. If a deal resurfaces at a lower price than previously seen, a Price Drop badge is shown.
5. **Delivery** — Each deal is posted as a photo with caption and a View on GG.deals button. In silent mode, deals are batched into photo albums (up to 10 per album).
6. **Retention** — Deals older than 30 days are automatically removed from the database.

## Data

Runtime data lives in `data/` (gitignored):

- `deals.db` — SQLite database with sent deals, price history, and watchlist
- `deals.json` / `deals.csv` — Output from one-off scrape runs
