import { Bot } from 'grammy';
import cron from 'node-cron';
import { writeFileSync } from 'fs';
import { createSession, destroySession, scrapeAll } from './scraper.js';
import {
  initDb, isDealSent, markDealSent, getLastPrice,
  recordPriceHistory, pruneOldDeals, closeDb,
  isTitleRecentlySent, matchWatchlist,
} from './database.js';
import { escapeHtml, getStoreFallbackImage } from './utils.js';
import { BOT_TOKEN, CHAT_ID, CRON_SCHEDULE, SCRAPE_PAGES, STORES, SILENT_MODE } from './config.js';
import { applyFilters } from './filters.js';
import { sendDeal, sendAlert, sendMediaGroupBatch, sendTextBatch } from './sender.js';
import { registerCommands } from './commands.js';

// --- State ---
let flareSession = null;
let lastErrorAlert = 0;

const bot = new Bot(BOT_TOKEN);

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
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

    if (deals.length === 0) {
      console.log('No deals found.');
      return;
    }

    const filtered = applyFilters(deals);
    const newDeals = [];
    const priceDrops = [];

    for (const deal of filtered) {
      if (isDealSent(deal.url) || isTitleRecentlySent(deal.title)) continue;
      const last = getLastPrice(deal.url);
      if (last && last.price_num > 0 && deal.priceNum > 0 && deal.priceNum < last.price_num) {
        deal.priceDrop = { oldPrice: `$${last.price_num.toFixed(2)}` };
        priceDrops.push(deal);
      }
      deal.watchlistMatch = matchWatchlist(deal.title) || null;
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
    writeFileSync('/tmp/last_scrape', Math.floor(Date.now() / 1000).toString());
    console.log(`Posted ${newDeals.length} new deals.`);

    await destroySession(flareSession).catch(() => {});
    flareSession = null;

  } catch (err) {
    console.error('Error in check cycle:', err.message);
    flareSession = null;
    const now = Date.now();
    if (now - lastErrorAlert > 3600000) {
      await sendAlert(bot, escapeHtml(err.message)).catch(() => {});
      lastErrorAlert = now;
    }
  }
}

// --- Start ---
initDb();
registerCommands(bot);
bot.start({ drop_pending_updates: true });

console.log('Bot started');
console.log(`Schedule: ${CRON_SCHEDULE} | Pages: ${SCRAPE_PAGES} | Stores: ${STORES.join(',')}`);

checkAndPostNewDeals();
cron.schedule(CRON_SCHEDULE, checkAndPostNewDeals);

process.on('SIGINT', async () => {
  if (flareSession) await destroySession(flareSession);
  closeDb();
  process.exit();
});
process.on('SIGTERM', async () => {
  if (flareSession) await destroySession(flareSession);
  closeDb();
  process.exit();
});
