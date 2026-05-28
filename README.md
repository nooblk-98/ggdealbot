# gamedeals-bot

A Telegram bot that monitors [GG.deals](https://gg.deals) for game deals across multiple stores and posts new deals in real-time. Uses [FlareSolverr](https://github.com/FlareSolverr/FlareSolverr) to bypass Cloudflare protection.

[![Node.js](https://img.shields.io/badge/Node.js->=22-3c873a?style=flat-square)](https://nodejs.org)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ed?style=flat-square&logo=docker&logoColor=white)](https://docker.com)

## Features

- **Multi-store scraping** — Steam, Epic Games Store, Microsoft Store, Ubisoft Store, PlayStation Store, Rockstar Store (configurable)
- **Cloudflare bypass** — Uses FlareSolverr to reliably access GG.deals
- **Automatic retry** — Exponential backoff on transient failures
- **Price history** — Tracks every observed price to detect drops over time
- **Price drop alerts** — When a known deal goes even lower, the bot flags it
- **Historical low badge** — Highlights all-time low prices
- **Platform info** — Shows supported platforms (Windows, Mac, Steam Deck, etc.)
- **Flexible filters** — Min discount %, max price, min rating, platform whitelist, free-only mode, per-store rating overrides
- **Telegram commands** — Adjust filters at runtime without restarting
- **Watchlist** — Get notified when specific games appear on sale
- **Silent mode** — Batch deals into media groups instead of individual messages
- **30-day retention** — Old deals pruned automatically
- **Error alerts** — Telegram notification when the scraper fails
- **Docker support** — Single-container deployment with docker-compose

## Architecture

```
GG.deals ──HTTP──▶ FlareSolverr ──HTML──▶ scraper.js ──deals──▶ bot.js ──Telegram──▶ You
                                                │                     │
                                                ▼                     ▼
                                         database.js ──────SQLite──── database.js
                                         (scrape +           (dedup +
                                          extract)           filter + send)
```

The scraper hits each store's deal page individually via FlareSolverr, extracts deal data with Cheerio, then the bot filters, formats, and sends new deals to your Telegram chat. All sent deals and price history are stored in SQLite.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) 22+
- A running [FlareSolverr](https://github.com/FlareSolverr/FlareSolverr) instance
- A [Telegram bot token](https://t.me/BotFather) and chat ID

### Installation

```bash
# Clone the repo
git clone https://github.com/yourusername/gamedeals-bot.git
cd gamedeals-bot

# Install dependencies
npm install

# Configure environment
cp .env.example .env
```

Edit `.env` with your credentials:

```ini
FLARE_SOLVER_URL=http://your-flaresolver:8191
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

### Usage

```bash
# Start the bot (runs on cron, default: every hour)
npm run bot

# Or run a one-off scrape
npm run scrape
```

### Docker

```bash
docker compose up -d
```

## Configuration

All configuration is via environment variables in `.env`:

| Variable | Required | Default | Description |
|---|---|---|---|
| `FLARE_SOLVER_URL` | Yes | — | URL of your FlareSolverr instance |
| `TELEGRAM_BOT_TOKEN` | Yes | — | Bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | Yes | — | Target chat/group ID |
| `CRON_SCHEDULE` | No | `0 * * * *` | Cron expression for the scrape schedule |
| `SCRAPE_PAGES` | No | `1` | Pages to scrape per store |
| `STORES` | No | `Steam` | Comma-separated store names |
| `MIN_DISCOUNT` | No | `0` | Minimum discount % to include |
| `MAX_PRICE` | No | `0` | Maximum price in USD (0 = no limit) |
| `MIN_RATING` | No | `0` | Minimum deal rating (0 = no filter) |
| `PLATFORMS` | No | — | Comma-separated platforms (e.g. `Windows, Mac`) |
| `FREE_ONLY` | No | `false` | Only post free-to-keep deals |
| `MIN_RATING_OVERRIDES` | No | — | Per-store rating overrides, e.g. `steam:7.5,epic:6.0` |
| `SILENT_MODE` | No | `false` | Batch deals into fewer messages |

### Supported stores

| Store | ID | Config name |
|---|---|---|
| Steam | `4` | `Steam` |
| Ubisoft Store | `38` | `Ubisoft Store` |
| Epic Games Store | `57` | `Epic Games Store` |
| Microsoft Store | `72` | `Microsoft Store` |
| PlayStation Store | `103` | `PlayStation Store` |
| Rockstar Store | `1169` | `Rockstar Store` |

## Telegram Commands

| Command | Description |
|---|---|
| `/status` | Show bot stats — deals tracked, stores, filters, last scraped |
| `/min_discount 50` | Only post deals with ≥50% discount |
| `/max_price 10` | Only post deals ≤$10 |
| `/stores Steam, GOG` | Switch store filter at runtime |
| `/scrape` | Force an immediate check |
| `/help` | List all commands |

> [!TIP]
> Filters set via Telegram commands persist until the bot restarts. For permanent configuration, use `.env`.

## Project Structure

```
src/
├── scraper.js      # FlareSolverr client + HTML parsing + deal extraction
├── database.js     # SQLite layer — dedup, price history, watchlist, stats
├── bot.js          # Telegram bot — cron scheduler, commands, message formatting
└── utils.js        # Formatting helpers — HTML escaping, deal messages, store emojis
```

### Scripts

| Command | Description |
|---|---|
| `npm run bot` | Start the Telegram bot (long-running) |
| `npm run scrape` | One-off scrape to `data/deals.json` |
| `npm run scrape:csv` | One-off scrape to `data/deals.csv` |

## How It Works

1. **Scraping** — On each cron tick, the bot creates a FlareSolverr session and fetches deal pages for each configured store. Results are deduplicated by URL.

2. **Filtering** — Deals are filtered against your configured thresholds (discount %, price, rating, platforms). Filtered deals are compared against the SQLite database to only keep unseen ones.

3. **Price history** — Each newly seen deal's price is recorded. If a deal resurfaces at a lower price than previously observed, the message includes a "Price Drop" badge.

4. **Delivery** — In normal mode, each deal is sent as a photo with caption and an inline "View on GG.deals" button. In silent mode, deals are batched into media groups (up to 10 per message).

5. **Retention** — Deals older than 30 days are automatically pruned from the database. Title-based dedup prevents re-sending the same deal within 24 hours.

## Data

All runtime data lives in `data/` (gitignored):

- `deals.db` — SQLite database with sent deals, price history, and watchlist
- `deals.json` / `deals.csv` — Output from one-off scrape runs
