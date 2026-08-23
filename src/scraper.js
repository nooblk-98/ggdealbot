import 'dotenv/config';
import * as cheerio from 'cheerio';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { normalizeUrl } from './utils.js';

const BASE_URL = 'https://gg.deals/deals/';
const MAX_RETRIES = 3;
const NON_RETRYABLE_ERROR = /session not found|invalid session/i;

function getFlareUrl() {
  const base = process.env.FLARE_SOLVER_URL;
  if (!base) throw new Error('Missing FLARE_SOLVER_URL environment variable');
  return base + '/v1';
}

const STORE_IDS = {
  steam: 4,
  'ubisoft store': 38,
  'epic games store': 57,
  'microsoft store': 72,
  'playstation store': 103,
  'rockstar store': 1169,
};

function getStoreId(name) {
  return STORE_IDS[name.toLowerCase()] || null;
}

export function buildDealsUrl(page, stores) {
  const storeIds = stores
    .map(s => getStoreId(s))
    .filter(id => id !== null);

  const params = ['sort=date'];
  if (storeIds.length > 0) params.push(`store=${storeIds.join(',')}`);
  if (page > 1) params.push(`page=${page}`);
  return `${BASE_URL}?${params.join('&')}`;
}

function randomDelay(ms) {
  return new Promise(r => setTimeout(r, ms + Math.random() * 1000));
}

async function withRetry(fn, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries || NON_RETRYABLE_ERROR.test(err.message)) throw err;
      const cause = err.cause ? ` (${err.cause.code || err.cause.message || err.cause})` : '';
      console.log(`Retry ${attempt}/${retries} after error: ${err.message}${cause}`);
      await randomDelay(2000 * attempt);
    }
  }
}

export async function flaresolverRequest(cmd, session, url) {
  const body = { cmd, ...session ? { session: session.id } : {} };

  if (cmd === 'request.get') {
    body.url = url;
    body.maxTimeout = 120000;
  }

  const resp = await fetch(getFlareUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await resp.json();

  if (data.status !== 'ok') {
    throw new Error(`FlareSolverer error: ${data.message || JSON.stringify(data)}`);
  }

  return data;
}

export async function createSession() {
  return withRetry(async () => {
    const resp = await flaresolverRequest('sessions.create');
    return { id: resp.session.id };
  });
}

export async function destroySession(session) {
  await flaresolverRequest('sessions.destroy', session).catch(() => {});
}

export async function fetchPage(url, session) {
  return withRetry(async () => {
    const result = await flaresolverRequest('request.get', session, url);
    return result.solution.response;
  });
}

export async function scrapeAll(pages = 1, session, stores = ['Steam']) {
  const allDeals = [];
  const seen = new Set();
  const storeSet = new Set(stores.map(s => s.toLowerCase()));

  for (let page = 1; page <= pages; page++) {
    const url = buildDealsUrl(page, stores);
    console.log(`  Scraping page ${page} (${stores.length} stores combined)...`);

    try {
      const html = await fetchPage(url, session);
      if (!html || html.length < 500) break;

      const deals = extractDeals(html, storeSet);
      let added = 0;
      for (const deal of deals) {
        if (!seen.has(deal.url)) {
          seen.add(deal.url);
          allDeals.push(deal);
          added++;
        }
      }
      console.log(`  Page ${page}: ${added} deals`);
      if (deals.length === 0) break;
      if (page < pages) await randomDelay(3000);
    } catch (err) {
      console.error(`  Failed to scrape page ${page}: ${err.message}`);
      break;
    }
  }

  return allDeals;
}

export function extractDeals(html, storeFilter) {
  const $ = cheerio.load(html);
  const deals = [];

  $('.game-list-item').each((_, el) => {
    const $card = $(el);

    const shopName = ($card.attr('data-shop-name') || '').toLowerCase();
    if (storeFilter && !storeFilter.has(shopName)) return;

    const title = $card.attr('data-game-title')
      || $card.find('a.game-info-title.title').first().text().trim()
      || '';
    if (!title) return;

    const href = $card.find('a.game-info-title.title').first().attr('href') || '';
    const dealValue = $card.attr('data-deal-value') || '';
    const price = dealValue ? `$${dealValue}` : '';
    const priceNum = parseFloat(dealValue) || 0;

    const dealId = $card.attr('data-deal-id') || '';

    let oldPrice = '';
    let oldPriceNum = 0;
    const oldPriceEl = $card.find('.base-price.label, .base-price').first();
    if (oldPriceEl.length) {
      oldPrice = oldPriceEl.clone().children().remove().end().text().trim();
      const match = oldPrice.match(/[\d.]+/);
      oldPriceNum = match ? parseFloat(match[0]) : 0;
    }

    let discount = '';
    let discountNum = 0;
    const discountEl = $card.find('.discount.with-tooltip.label, .discount').first();
    if (discountEl.length) {
      discount = discountEl.text().trim().replace(/[-–]/g, '').replace(/^Discount:\s*/i, '').trim();
      discountNum = parseInt(discount) || 0;
    }

    let rating = '';
    const ratingEl = $card.find('.rating-title-icon').first();
    if (ratingEl.length) {
      const r = ratingEl.attr('data-tippy-content') || ratingEl.text().trim();
      rating = r.replace(/<br\s*\/?>/gi, ' | ').trim();
    }

    let ratingScore = 0;
    const ratingMatch = rating.match(/[\d.]+/);
    if (ratingMatch) ratingScore = parseFloat(ratingMatch[0]);

    let image = '';
    const pictureEl = $card.find('picture source').first();
    if (pictureEl.length) {
      const srcset = pictureEl.attr('srcset') || '';
      const sources = srcset.split(',')
        .map(s => { const p = s.trim().split(/\s+/); return { url: p[0], w: parseInt(p[1]) || 0 }; })
        .filter(s => s.url);
      sources.sort((a, b) => b.w - a.w);
      image = sources[0]?.url || '';
    }
    if (!image) {
      const imgEl = $card.find('img').first();
      const src = imgEl.attr('src') || imgEl.attr('data-src') || '';
      image = src.replace(/_\d+xr\d+/, '_616xr353');
    }

    const isHistoricalLow = !!$card.find('.historical.label').length;

    let platforms = [];
    const platformsEl = $card.find('.platforms-tag .tag-icons').first();
    if (platformsEl.length) {
      const tippyContent = platformsEl.attr('data-tippy-content') || '';
      const platformMatch = tippyContent.matchAll(/<span[^>]*>([^<]+)<\/span>/g);
      platforms = [...platformMatch].map(m => m[1]).filter(p => p.trim());
    }
    if (platforms.length === 0) {
      $card.find('.platforms-tag .sr-only').each((_, el) => {
        const text = $(el).text().trim();
        if (text && !text.startsWith(',')) {
          text.split(',').forEach(p => {
            const clean = p.trim().replace(/^,/, '');
            if (clean) platforms.push(clean);
          });
        }
      });
    }

    deals.push({
      title,
      price,
      priceNum,
      oldPrice,
      oldPriceNum,
      discount,
      discountNum,
      rating,
      ratingScore,
      image,
      url: normalizeUrl(href.startsWith('http') ? href : `https://gg.deals${href}`),
      dealId,
      store: shopName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      platforms: [...new Set(platforms)],
      historicalLow: isHistoricalLow,
      scrapedAt: new Date().toISOString(),
    });
  });

  return deals;
}

// --- CLI entry ---
const isMain = process.argv[1] && (
  process.argv[1] === fileURLToPath(import.meta.url)
  || process.argv[1].endsWith('/scraper.js')
);

if (isMain) {
  const args = parseArgs();
  const FORMAT = args.format || 'json';
  const OUTPUT = args.output || 'data/deals.json';
  const MAX_PAGES = parseInt(args.pages || '1', 10);
  const STORES = (args.stores || 'Steam').split(',').map(s => s.trim());

  async function main() {
    let session;
    try {
      session = await createSession();
      const deals = await scrapeAll(MAX_PAGES, session, STORES);

      if (FORMAT === 'csv') {
        const header = 'title,price,oldPrice,discount,rating,url,store,platforms';
        const rows = deals.map(d =>
          `"${(d.title || '').replace(/"/g, '""')}","${d.price}","${d.oldPrice}","${d.discount}","${d.rating}","${d.url}","${d.store}","${(d.platforms||[]).join(';')}"`
        );
        await fs.writeFile(OUTPUT, [header, ...rows].join('\n'), 'utf-8');
      } else {
        await fs.writeFile(OUTPUT, JSON.stringify(deals, null, 2), 'utf-8');
      }

      console.log(`Done — ${deals.length} deals saved to ${OUTPUT}`);
    } finally {
      if (session) await destroySession(session);
    }
  }

  main().catch(err => { console.error(err.message); process.exit(1); });
}

function parseArgs() {
  const result = {};
  const cliArgs = process.argv.slice(2);
  for (let i = 0; i < cliArgs.length; i++) {
    if (cliArgs[i].startsWith('--')) {
      const [key, val] = cliArgs[i].slice(2).split('=');
      result[key] = val || cliArgs[++i];
    }
  }
  return result;
}
