import { Bot } from 'grammy';
import cron from 'node-cron';
import { writeFileSync } from 'fs';
import { createSession, destroySession, scrapeAll } from './scraper.js';
import {
  initDb, isDealSent, markDealSent, getLastPrice,
  recordPriceHistory, pruneOldDeals, closeDb,
  isTitleRecentlySent, getWatchlistPatterns,
} from './database.js';
import { escapeHtml, getStoreFallbackImage, matchWatchlistPatterns } from './utils.js';
import { BOT_TOKEN, CRON_SCHEDULE, SCRAPE_PAGES, STORES, SILENT_MODE } from './config.js';
import { applyFilters } from './filters.js';
import { sendDeal, sendAlert, sendMediaGroupBatch, sendTextBatch } from './sender.js';
import { registerCommands } from './commands.js';

// --- State ---
let flareSession = null;
let lastAlertAt = 0;
let consecutiveEmptyScrapes = 0;
const ALERT_COOLDOWN_MS = 3600000;
const EMPTY_SCRAPE_ALERT_THRESHOLD = 3;
const LAST_SCRAPE_FILE = process.env.LAST_SCRAPE_FILE || '/tmp/last_scrape';

const bot = new Bot(BOT_TOKEN);

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function notifyAdmin(message) {
  const now = Date.now();
  if (now - lastAlertAt < ALERT_COOLDOWN_MS) return;
  lastAlertAt = now;
  await sendAlert(bot, message).catch(() => {});
}

async function ensureSession() {
  if (!flareSession) {
    flareSession = await createSession();
    console.log('FlareSolverer session active');
  }
  return flareSession;
}

async function checkAndPostNewDeals() {
  console.log(`[${new Date().toISOString()}] Checking for new deals...`);

  try {
    const session = await ensureSession();
    const deals = await scrapeAll(SCRAPE_PAGES, session, STORES);
    try {
      writeFileSync(LAST_SCRAPE_FILE, Math.floor(Date.now() / 1000).toString());
    } catch (err) {
      console.warn('Could not write last-scrape marker:', err.message);
    }

    if (deals.length === 0) {
      consecutiveEmptyScrapes++;
      console.log('No deals found.');
      if (consecutiveEmptyScrapes >= EMPTY_SCRAPE_ALERT_THRESHOLD) {
        await notifyAdmin(`Scraper has returned 0 deals for ${consecutiveEmptyScrapes} consecutive runs — GG.deals markup may have changed.`);
      }
      return;
    }
    consecutiveEmptyScrapes = 0;

    const filtered = applyFilters(deals);
    const newDeals = [];
    const priceDrops = [];
    const watchlistPatterns = getWatchlistPatterns();

    for (const deal of filtered) {
      if (isDealSent(deal.url) || isTitleRecentlySent(deal.title)) continue;
      const last = getLastPrice(deal.url);
      if (last && last.price_num > 0 && deal.priceNum > 0 && deal.priceNum < last.price_num) {
        deal.priceDrop = { oldPrice: `$${last.price_num.toFixed(2)}` };
        priceDrops.push(deal);
      }
      deal.watchlistMatch = matchWatchlistPatterns(deal.title, watchlistPatterns);
      newDeals.push(deal);
    }

    if (newDeals.length === 0) {
      console.log('No new deals.');
      return;
    }

    console.log(`${newDeals.length} new deals (${priceDrops.length} price drops)`);

    if (SILENT_MODE) {
      const withImages    = newDeals.filter(d => d.image || getStoreFallbackImage(d.store));
      const withoutImages = newDeals.filter(d => !d.image && !getStoreFallbackImage(d.store));

      for (let i = 0; i < withImages.length; i += 10) {
        const batch = withImages.slice(i, i + 10);
        const sent = await sendMediaGroupBatch(bot, batch);
        if (!sent) {
          for (const deal of batch) {
            await sendDeal(bot, deal);
            markDealSent(deal);
            recordPriceHistory(deal);
            await sleep(3000);
          }
        } else {
          for (const deal of batch) {
            markDealSent(deal);
            recordPriceHistory(deal);
          }
        }
        await sleep(3000);
      }

      for (let i = 0; i < withoutImages.length; i += 10) {
        const batch = withoutImages.slice(i, i + 10);
        await sendTextBatch(bot, batch, i);
        for (const deal of batch) {
          markDealSent(deal);
          recordPriceHistory(deal);
        }
        await sleep(3000);
      }
    } else {
      for (const deal of newDeals) {
        await sendDeal(bot, deal);
        markDealSent(deal);
        recordPriceHistory(deal);
        await sleep(3000);
      }
    }

    pruneOldDeals();
    console.log(`Posted ${newDeals.length} new deals.`);

    await destroySession(flareSession).catch(() => {});
    flareSession = null;

  } catch (err) {
    console.error('Error in check cycle:', err.message);
    if (flareSession) await destroySession(flareSession).catch(() => {});
    flareSession = null;
    await notifyAdmin(escapeHtml(err.message));
  }
}

// --- Start ---
initDb();
registerCommands(bot);
bot.start({ drop_pending_updates: true }).catch(err => {
  console.error('Failed to start bot:', err.message);
  process.exit(1);
});

console.log('Bot started');
console.log(`Schedule: ${CRON_SCHEDULE} | Pages: ${SCRAPE_PAGES} | Stores: ${STORES.join(',')}`);

checkAndPostNewDeals();
cron.schedule(CRON_SCHEDULE, checkAndPostNewDeals);

async function shutdown(exitCode = 0) {
  if (flareSession) await destroySession(flareSession).catch(() => {});
  closeDb();
  process.exit(exitCode);
}

process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());
process.on('uncaughtException', err => {
  console.error('Uncaught exception:', err);
  shutdown(1);
});
process.on('unhandledRejection', err => {
  console.error('Unhandled rejection:', err);
  shutdown(1);
});
