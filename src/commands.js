import { getDealStats, getRecentDeals, getTopDeals } from './database.js';
import { escapeHtml, storeEmoji } from './utils.js';
import { ADMIN_ID, CRON_SCHEDULE, SCRAPE_PAGES, STORES, MIN_DISCOUNT, MAX_PRICE, MIN_RATING, FREE_ONLY, SILENT_MODE } from './config.js';

function isAdmin(ctx) {
  if (!ADMIN_ID) return false;
  return ctx.from?.id === ADMIN_ID;
}

function formatUptime() {
  const s = Math.floor(process.uptime());
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatLastScrape(isoDate) {
  if (!isoDate) return 'never';
  const diff = Math.floor((Date.now() - new Date(isoDate).getTime()) / 60000);
  if (diff < 1) return 'just now';
  if (diff < 60) return `${diff}m ago`;
  return `${Math.floor(diff / 60)}h ${diff % 60}m ago`;
}

export function registerCommands(bot) {
  bot.command('start', ctx => {
    if (!isAdmin(ctx)) return;
    ctx.reply('👋 GG Deals Bot is running.\n\nCommands:\n/stats — full status report');
  });

  bot.command('stats', async ctx => {
    if (!isAdmin(ctx)) return;

    const stats = getDealStats();
    const recent = getRecentDeals(5);
    const top = getTopDeals(3);

    const lines = [];

    // Header
    lines.push(`<b>📊 GG Deals Bot — Status</b>`);
    lines.push(`┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄`);

    // Bot health
    lines.push(`⏱ <b>Uptime:</b> ${formatUptime()}`);
    lines.push(`🕐 <b>Last scrape:</b> ${formatLastScrape(stats.lastScraped)}`);
    lines.push(`📦 <b>Total deals sent:</b> ${stats.total}`);
    lines.push(``);

    // Config
    lines.push(`<b>⚙️ Config</b>`);
    lines.push(`• Schedule: <code>${CRON_SCHEDULE}</code>`);
    lines.push(`• Stores: ${STORES.join(', ')}`);
    lines.push(`• Pages/run: ${SCRAPE_PAGES}`);
    if (MIN_DISCOUNT > 0) lines.push(`• Min discount: ${MIN_DISCOUNT}%`);
    if (MAX_PRICE > 0)    lines.push(`• Max price: $${MAX_PRICE}`);
    if (MIN_RATING > 0)   lines.push(`• Min rating: ${MIN_RATING}`);
    if (FREE_ONLY)        lines.push(`• Free only: yes`);
    if (SILENT_MODE)      lines.push(`• Silent mode: yes`);
    lines.push(``);

    // Stores breakdown
    if (stats.stores?.length) {
      lines.push(`<b>🏬 Active stores</b>`);
      lines.push(stats.stores.map(s => `${storeEmoji(s)} ${escapeHtml(s)}`).join('  ·  '));
      lines.push(``);
    }

    // Recent deals
    if (recent.length) {
      lines.push(`<b>🕐 Last 5 sent</b>`);
      recent.forEach(d => {
        lines.push(`• ${escapeHtml(d.title)} — <b>${escapeHtml(d.price || 'free')}</b>`);
      });
      lines.push(``);
    }

    // Top rated
    if (top.length) {
      lines.push(`<b>⭐ Top rated (all time)</b>`);
      top.forEach(d => {
        lines.push(`• ${escapeHtml(d.title)} — ${d.rating_score}/10`);
      });
    }

    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
  });
}
