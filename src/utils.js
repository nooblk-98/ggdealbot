// Store-branded fallback images shown when a deal has no thumbnail
const STORE_FALLBACK_IMAGES = {
  'steam':               'https://images.gg.deals/shops/4_616xr353.webp',
  'epic games store':    'https://images.gg.deals/shops/57_616xr353.webp',
  'microsoft store':     'https://images.gg.deals/shops/72_616xr353.webp',
  'playstation store':   'https://images.gg.deals/shops/103_616xr353.webp',
  'ubisoft store':       'https://images.gg.deals/shops/38_616xr353.webp',
  'rockstar store':      'https://images.gg.deals/shops/1169_616xr353.webp',
};

export function getStoreFallbackImage(store) {
  return STORE_FALLBACK_IMAGES[(store || '').toLowerCase()] || null;
}

export function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}

export function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function storeEmoji(store) {
  const s = (store || '').toLowerCase();
  if (s.includes('steam')) return '🎮';
  if (s.includes('microsoft') || s.includes('xbox')) return '🏪';
  if (s.includes('playstation')) return '🕹';
  if (s.includes('epic')) return '🚀';
  if (s.includes('gog')) return '📦';
  if (s.includes('ubisoft')) return '🛡';
  if (s.includes('rockstar')) return '🌟';
  return '🏬';
}

export function formatRating(rating) {
  if (!rating) return '';
  const scoreMatch = rating.match(/deal rating[:\s]+([0-9.]+)/i);
  const score = scoreMatch ? scoreMatch[1] : null;
  const labelPart = rating.split(/\||deal rating/i)[0].trim();
  const pieces = [];
  if (score) pieces.push(`⭐ <b>${escapeHtml(score)}</b>/10`);
  if (labelPart) pieces.push(`🔥 ${escapeHtml(labelPart)}`);
  return pieces.join('  ·  ');
}

export function formatDealMessage(deal) {
  const DIVIDER = '┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄';
  const lines = [];

  lines.push(`Game : <b>${escapeHtml(deal.title)}</b>`);
  lines.push('');

  if (deal.priceNum === 0 && deal.price) {
    lines.push(`🆓 <b>FREE!</b>${deal.oldPrice ? `  <s>${escapeHtml(deal.oldPrice)}</s>` : ''}`);
  } else {
    const priceParts = [];
    if (deal.oldPrice) priceParts.push(`<s>${escapeHtml(deal.oldPrice)}</s>`);
    if (deal.price) priceParts.push(`<b>${escapeHtml(deal.price)}</b>`);
    if (priceParts.length) lines.push(`💰 ${priceParts.join('  ➜  ')}`);

    if (deal.discount) {
      const saveParts = [`🏷 <b>${escapeHtml(deal.discount)} OFF</b>`];
      if (deal.oldPriceNum > 0 && deal.priceNum > 0) {
        const saved = (deal.oldPriceNum - deal.priceNum).toFixed(2);
        if (parseFloat(saved) > 0) saveParts.push(`Save <b>$${saved}</b>`);
      }
      lines.push(saveParts.join('  ·  '));
    }
  }

  if (deal.historicalLow) lines.push(`📉 <b>Historical Low!</b>`);
  if (deal.priceDrop) lines.push(`📊 <b>Price Drop</b>  ${escapeHtml(deal.priceDrop.oldPrice)} ➜ <b>${escapeHtml(deal.price)}</b>`);

  const ratingLine = formatRating(deal.rating);
  if (ratingLine) lines.push(ratingLine);

  lines.push('');
  lines.push(DIVIDER);
  if (deal.store) lines.push(`Store : <b>${escapeHtml(deal.store)}</b>`);
  if (deal.platforms?.length) lines.push(`\nPlatforms : ${deal.platforms.map(escapeHtml).join(' | ')}`);

  return lines.join('\n');
}

export function formatBatchCaption(deal) {
  const parts = [];
  parts.push(`<b>${escapeHtml(deal.title)}</b>`);
  if (deal.priceNum === 0 && deal.price) {
    parts.push(`🆓 <b>FREE!</b>${deal.oldPrice ? `  <s>${escapeHtml(deal.oldPrice)}</s>` : ''}`);
  } else {
    const price = [];
    if (deal.oldPrice) price.push(`<s>${escapeHtml(deal.oldPrice)}</s>`);
    if (deal.price) price.push(`<b>${escapeHtml(deal.price)}</b>`);
    if (price.length) parts.push(`💰 ${price.join('  ➜  ')}`);
    if (deal.discount) parts.push(`🏷 <b>${escapeHtml(deal.discount)} OFF</b>`);
  }
  const flags = [];
  if (deal.historicalLow) flags.push('📉 Low');
  if (deal.ratingScore > 0) flags.push(`⭐ ${deal.ratingScore}/10`);
  if (flags.length) parts.push(flags.join('  ·  '));
  return parts.join('\n');
}
