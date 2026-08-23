import { MIN_DISCOUNT, MAX_PRICE, MIN_RATING, FREE_ONLY, PLATFORMS, STORE_MIN_RATINGS } from './config.js';

const DEFAULT_CONFIG = { MIN_DISCOUNT, MAX_PRICE, MIN_RATING, FREE_ONLY, PLATFORMS, STORE_MIN_RATINGS };

export function applyFilters(deals, config = DEFAULT_CONFIG) {
  const { MIN_DISCOUNT, MAX_PRICE, MIN_RATING, FREE_ONLY, PLATFORMS, STORE_MIN_RATINGS } = config;
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
