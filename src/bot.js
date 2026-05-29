import 'dotenv/config';
import { Bot, InputFile } from 'grammy';
import cron from 'node-cron';
import { writeFileSync, createReadStream } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { createSession, destroySession, scrapeAll } from './scraper.js';
import {
  initDb, isDealSent, markDealSent, getLastPrice,
  recordPriceHistory, pruneOldDeals, getDealStats, closeDb,
  isTitleRecentlySent, matchWatchlist, removeLastSentDeal,
} from './database.js';
import { escapeHtml, formatDealMessage, formatBatchCaption, storeEmoji, getStoreFallbackImage } from './utils.js';

const FALLBACK_IMAGE = resolve(fileURLToPath(import.meta.url), '../../images/deals.jpg');

// --- Config ---
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '0 * * * *';
const SCRAPE_PAGES = parseInt(process.env.SCRAPE_PAGES || '1', 10);
const SILENT_MODE = process.env.SILENT_MODE === 'true';
const STORES = (process.env.STORES || 'Steam').split(',').map(s => s.trim());
const MIN_DISCOUNT = parseInt(process.env.MIN_DISCOUNT || '0', 10);
const MAX_PRICE = parseFloat(process.env.MAX_PRICE || '0');
const MIN_RATING = parseFloat(process.env.MIN_RATING || '0');
const FREE_ONLY = process.env.FREE_ONLY === 'true';
const PLATFORMS = (process.env.PLATFORMS || '').split(',').map(s => s.trim()).filter(Boolean);
const STORE_MIN_RATINGS = parseStoreRatings(process.env.MIN_RATING_OVERRIDES || '');

function parseStoreRatings(str) {
  if (!str) return {};
  return Object.fromEntries(
    str.split(',')
      .map(s => s.trim().split(':'))
      .filter(p => p.length === 2 && p[0] && !isNaN(parseFloat(p[1])))
      .map(([store, rating]) => [store.trim().toLowerCase(), parseFloat(rating)])
  );
}

if (!BOT_TOKEN || !CHAT_ID) {
  console.error('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID');
  process.exit(1);
}

// --- State ---
let flareSession = null;
let lastErrorAlert = 0;

const bot = new Bot(BOT_TOKEN);

// --- Helpers ---

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function sendWithRetry(fn, label, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const retryAfter = err.parameters?.retry_after;
      if (retryAfter) {
        console.warn(`Rate limited — waiting ${retryAfter}s (attempt ${attempt}/${retries})`);
        await sleep((retryAfter + 1) * 1000);
        continue;
      }
      if (attempt === retries) {
        console.error(`Failed to send "${label}": ${err.message}`);
      }
    }
  }
}

async function sendDeal(deal) {
  const caption = formatDealMessage(deal);
  const keyboard = { inline_keyboard: [[{ text: 'View on GG.deals', url: deal.url }]] };
  const image = deal.image || getStoreFallbackImage(deal.store);

  if (image) {
    const sent = await sendWithRetry(
      () => bot.api.sendPhoto(CHAT_ID, image, { caption, parse_mode: 'HTML', reply_markup: keyboard }),
      deal.title
    );
    if (!sent) {
      await sendWithRetry(
        () => bot.api.sendMessage(CHAT_ID, caption, { parse_mode: 'HTML', reply_markup: keyboard }),
        deal.title
      );
    }
  } else {
    const sent = await sendWithRetry(
      () => bot.api.sendPhoto(CHAT_ID, new InputFile(createReadStream(FALLBACK_IMAGE), 'cover.jpg'), { caption, parse_mode: 'HTML', reply_markup: keyboard }),
      deal.title
    );
    if (!sent) {
      await sendWithRetry(
        () => bot.api.sendMessage(CHAT_ID, caption, { parse_mode: 'HTML', reply_markup: keyboard }),
        deal.title
      );
    }
  }
}

async function sendAlert(message) {
  try {
    await bot.api.sendMessage(CHAT_ID, `⚠️ ${message}`, { parse_mode: 'HTML' });
  } catch (_) {}
}

async function ensureSession() {
  if (!flareSession) {
    flareSession = await createSession();
    console.log('FlareSolverer session active');
  }
  return flareSession;
}

function applyFilters(deals) {
  return deals.filter(d => {
    // Drop cards where extraction returned no price and no discount (bad scrape)
    if (!d.price && !d.discount) return false;

    const isFree = d.priceNum === 0 && d.price;
    if (FREE_ONLY) return isFree;
    if (!isFree) {
      if (MIN_DISCOUNT > 0 && (d.discountNum || 0) < MIN_DISCOUNT) return false;
      if (MAX_PRICE > 0 && (d.priceNum || 0) > MAX_PRICE) return false;
    }
    const storeKey = (d.store || '').toLowerCase();
    const effectiveMinRating = STORE_MIN_RATINGS[storeKey] ?? MIN_RATING;
    if (effectiveMinRating > 0 && (d.ratingScore || 0) < effectiveMinRating) return false;
    if (PLATFORMS.length > 0 && d.platforms?.length > 0) {
      const hit = d.platforms.some(p =>
        PLATFORMS.some(f => p.toLowerCase().includes(f.toLowerCase()))
      );
      if (!hit) return false;
    }
    return true;
  });
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
      // Treat deals with a store fallback image as having an image too
      const withImages = newDeals.filter(d => d.image || getStoreFallbackImage(d.store));
      const withoutImages = newDeals.filter(d => !d.image && !getStoreFallbackImage(d.store));

      for (let i = 0; i < withImages.length; i += 10) {
        const batch = withImages.slice(i, i + 10);
        const mediaGroup = batch.map(deal => ({
          type: 'photo',
          media: deal.image || getStoreFallbackImage(deal.store),
          caption: formatBatchCaption(deal),
          parse_mode: 'HTML',
        }));
        const sent = await sendWithRetry(
          () => bot.api.sendMediaGroup(CHAT_ID, mediaGroup),
          'media group'
        );
        if (!sent) {
          for (const deal of batch) {
            await sendDeal(deal);
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

      if (withoutImages.length > 0) {
        for (let i = 0; i < withoutImages.length; i += 10) {
          const batch = withoutImages.slice(i, i + 10);
          const rows = batch.map((deal, j) => {
            const isFree = deal.priceNum === 0 && deal.price;
            const price = isFree
              ? `🆓 <b>FREE!</b>`
              : deal.oldPrice && deal.price
                ? `<s>${escapeHtml(deal.oldPrice)}</s> ➜ <b>${escapeHtml(deal.price)}</b>${deal.discount ? `  <b>${escapeHtml(deal.discount)} OFF</b>` : ''}`
                : deal.price ? `<b>${escapeHtml(deal.price)}</b>` : '';
            const flags = [];
            if (deal.historicalLow) flags.push('📉 Low');
            return [
              `${i + j + 1}. <b>${escapeHtml(deal.title)}</b>`,
              price,
              flags.join('  ·  '),
            ].filter(Boolean).join('\n   ');
          });
          const msg = `<b>New Deals</b>\n┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n\n${rows.join('\n\n')}`;
          await sendWithRetry(() => bot.api.sendMessage(CHAT_ID, msg, { parse_mode: 'HTML' }), 'batch');
          for (const deal of batch) {
            markDealSent(deal);
            recordPriceHistory(deal);
          }
          await sleep(3000);
        }
      }
    } else {
      for (const deal of newDeals) {
        await sendDeal(deal);
        markDealSent(deal);
        recordPriceHistory(deal);
        await sleep(3000);
      }
    }

    pruneOldDeals();
    writeFileSync('/tmp/last_scrape', Math.floor(Date.now() / 1000).toString());
    console.log(`Posted ${newDeals.length} new deals.`);

    // Destroy session after each run — no need to hold it for 5 hours
    await destroySession(flareSession).catch(() => {});
    flareSession = null;

  } catch (err) {
    console.error('Error in check cycle:', err.message);
    flareSession = null;
    const now = Date.now();
    if (now - lastErrorAlert > 3600000) {
      await sendAlert(`Scraper error: ${escapeHtml(err.message)}`).catch(() => {});
      lastErrorAlert = now;
    }
  }
}

// --- Start ---
initDb();
const removedDeal = removeLastSentDeal();
if (removedDeal) console.log(`Removed last sent deal from history for re-test: "${removedDeal}"`);
console.log('Bot started');
console.log(`Schedule: ${CRON_SCHEDULE} | Pages: ${SCRAPE_PAGES} | Stores: ${STORES.join(',')}`);
console.log(`Filters: min ${MIN_DISCOUNT}% off | max $${MAX_PRICE || '∞'} | min rating ${MIN_RATING || 'off'} | free only: ${FREE_ONLY} | silent: ${SILENT_MODE}`);

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
