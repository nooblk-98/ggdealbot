import 'dotenv/config';

function parseStoreRatings(str) {
  if (!str) return {};
  return Object.fromEntries(
    str.split(',')
      .map(s => s.trim().split(':'))
      .filter(p => p.length === 2 && p[0] && !isNaN(parseFloat(p[1])))
      .map(([store, rating]) => [store.trim().toLowerCase(), parseFloat(rating)])
  );
}

export const BOT_TOKEN     = process.env.TELEGRAM_BOT_TOKEN;
export const CHAT_ID       = process.env.TELEGRAM_CHAT_ID;
export const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '0 * * * *';
export const SCRAPE_PAGES  = parseInt(process.env.SCRAPE_PAGES || '1', 10);
export const SILENT_MODE   = process.env.SILENT_MODE === 'true';
export const STORES        = (process.env.STORES || 'Steam').split(',').map(s => s.trim());
export const MIN_DISCOUNT  = parseInt(process.env.MIN_DISCOUNT || '0', 10);
export const MAX_PRICE     = parseFloat(process.env.MAX_PRICE || '0');
export const MIN_RATING    = parseFloat(process.env.MIN_RATING || '0');
export const FREE_ONLY     = process.env.FREE_ONLY === 'true';
export const PLATFORMS     = (process.env.PLATFORMS || '').split(',').map(s => s.trim()).filter(Boolean);
export const STORE_MIN_RATINGS = parseStoreRatings(process.env.MIN_RATING_OVERRIDES || '');
export const ADMIN_ID          = process.env.ADMIN_TELEGRAM_ID ? parseInt(process.env.ADMIN_TELEGRAM_ID, 10) : null;

if (!BOT_TOKEN || !CHAT_ID) {
  console.error('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID');
  process.exit(1);
}
