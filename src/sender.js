import { InputFile } from 'grammy';
import { createReadStream } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { escapeHtml, formatDealMessage, formatBatchCaption, getStoreFallbackImage } from './utils.js';
import { CHAT_ID, ADMIN_ID } from './config.js';

export const FALLBACK_IMAGE = resolve(fileURLToPath(import.meta.url), '../../images/deals.jpg');

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export async function sendWithRetry(fn, label, retries = 3) {
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

export async function sendDeal(bot, deal) {
  const caption = formatDealMessage(deal);
  const keyboard = { inline_keyboard: [[{ text: 'View on GG.deals', url: deal.url }]] };
  const image = deal.image || getStoreFallbackImage(deal.store);

  const photo = image
    ? image
    : new InputFile(createReadStream(FALLBACK_IMAGE), 'cover.jpg');

  let sent = await sendWithRetry(
    () => bot.api.sendPhoto(CHAT_ID, photo, { caption, parse_mode: 'HTML', reply_markup: keyboard }),
    deal.title
  );

  if (!sent && image) {
    // URL was blocked — retry with local fallback
    sent = await sendWithRetry(
      () => bot.api.sendPhoto(CHAT_ID, new InputFile(createReadStream(FALLBACK_IMAGE), 'cover.jpg'), { caption, parse_mode: 'HTML', reply_markup: keyboard }),
      deal.title
    );
  }

  if (!sent) {
    await sendWithRetry(
      () => bot.api.sendMessage(CHAT_ID, caption, { parse_mode: 'HTML', reply_markup: keyboard }),
      deal.title
    );
  }
}

export async function sendAlert(bot, message) {
  if (!ADMIN_ID) {
    console.error('Alert not sent — ADMIN_TELEGRAM_ID not configured:', message);
    return;
  }
  try {
    await bot.api.sendMessage(ADMIN_ID, `⚠️ ${message}`, { parse_mode: 'HTML' });
  } catch (err) {
    console.error('Failed to send admin alert:', err.message);
  }
}

export async function sendMediaGroupBatch(bot, batch) {
  const mediaGroup = batch.map(deal => ({
    type: 'photo',
    media: deal.image || getStoreFallbackImage(deal.store),
    caption: formatBatchCaption(deal),
    parse_mode: 'HTML',
  }));
  return sendWithRetry(
    () => bot.api.sendMediaGroup(CHAT_ID, mediaGroup),
    'media group'
  );
}

export async function sendTextBatch(bot, batch, offset) {
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
      `${offset + j + 1}. <b>${escapeHtml(deal.title)}</b>`,
      price,
      flags.join('  ·  '),
    ].filter(Boolean).join('\n   ');
  });
  const msg = `<b>New Deals</b>\n┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n\n${rows.join('\n\n')}`;
  return sendWithRetry(() => bot.api.sendMessage(CHAT_ID, msg, { parse_mode: 'HTML' }), 'batch');
}
