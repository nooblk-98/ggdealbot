import 'dotenv/config';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'deals.db');

let db;

export function initDb() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS deals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_url TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      price TEXT,
      price_num REAL DEFAULT 0,
      old_price TEXT,
      discount TEXT,
      discount_num INTEGER DEFAULT 0,
      rating TEXT,
      rating_score REAL DEFAULT 0,
      image TEXT,
      platforms TEXT,
      historical_low INTEGER DEFAULT 0,
      store TEXT DEFAULT 'Steam',
      scraped_at TEXT,
      sent_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_url TEXT NOT NULL,
      title TEXT NOT NULL,
      price TEXT,
      price_num REAL DEFAULT 0,
      discount TEXT,
      discount_num INTEGER DEFAULT 0,
      observed_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS watchlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT UNIQUE NOT NULL COLLATE NOCASE,
      added_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_deal_url ON deals(deal_url)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sent_at ON deals(sent_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_price_history_url ON price_history(deal_url)`);

  const runMigration = (id, sql) => {
    if (!db.prepare('SELECT id FROM migrations WHERE id = ?').get(id)) {
      try {
        db.exec(sql);
      } catch (err) {
        // Column/index already exists from a pre-migration run — still mark applied
        if (!err.message.includes('duplicate column name') && !err.message.includes('already exists')) {
          throw err;
        }
      }
      db.prepare('INSERT INTO migrations (id) VALUES (?)').run(id);
    }
  };

  runMigration('add_platforms',     `ALTER TABLE deals ADD COLUMN platforms TEXT`);
  runMigration('add_historical_low',`ALTER TABLE deals ADD COLUMN historical_low INTEGER DEFAULT 0`);
  runMigration('add_price_num',     `ALTER TABLE deals ADD COLUMN price_num REAL DEFAULT 0`);
  runMigration('add_discount_num',  `ALTER TABLE deals ADD COLUMN discount_num INTEGER DEFAULT 0`);
  runMigration('add_rating_score',  `ALTER TABLE deals ADD COLUMN rating_score REAL DEFAULT 0`);

  return db;
}

export function isDealSent(dealUrl) {
  const row = db.prepare('SELECT id FROM deals WHERE deal_url = ?').get(dealUrl);
  return !!row;
}

export function markDealSent(deal) {
  db.prepare(`
    INSERT OR IGNORE INTO deals
      (deal_url, title, price, price_num, old_price, discount, discount_num, rating, rating_score, image, platforms, historical_low, store, scraped_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    deal.url,
    deal.title,
    deal.price,
    deal.priceNum || 0,
    deal.oldPrice,
    deal.discount,
    deal.discountNum || 0,
    deal.rating,
    deal.ratingScore || 0,
    deal.image,
    JSON.stringify(deal.platforms || []),
    deal.historicalLow ? 1 : 0,
    deal.store,
    deal.scrapedAt
  );
}

export function getLastPrice(dealUrl) {
  const row = db.prepare(`
    SELECT price_num, observed_at FROM price_history
    WHERE deal_url = ?
    ORDER BY observed_at DESC LIMIT 1
  `).get(dealUrl);
  return row || null;
}

export function recordPriceHistory(deal) {
  db.prepare(`
    INSERT INTO price_history (deal_url, title, price, price_num, discount, discount_num)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    deal.url,
    deal.title,
    deal.price,
    deal.priceNum || 0,
    deal.discount,
    deal.discountNum || 0
  );
}

// Time-based expiry: keep 30 days of deals instead of a fixed row cap
export function pruneOldDeals() {
  db.prepare(`DELETE FROM deals WHERE sent_at < datetime('now', '-30 days')`).run();
}

export function getDealStats() {
  const total = db.prepare('SELECT COUNT(*) as cnt FROM deals').get().cnt;
  const uniqueStores = db.prepare('SELECT DISTINCT store FROM deals').all().map(r => r.store);
  const lastScraped = db.prepare('SELECT scraped_at FROM deals ORDER BY scraped_at DESC LIMIT 1').get();
  return { total, stores: uniqueStores, lastScraped: lastScraped?.scraped_at || null };
}

export function removeLastSentDeal() {
  const row = db.prepare('SELECT id, title FROM deals ORDER BY sent_at DESC LIMIT 1').get();
  if (row) {
    db.prepare('DELETE FROM deals WHERE id = ?').run(row.id);
    return row.title;
  }
  return null;
}

export function closeDb() {
  if (db) db.close();
}

export function isTitleRecentlySent(title) {
  const row = db.prepare(
    `SELECT id FROM deals WHERE title = ? AND sent_at > datetime('now', '-1 day')`
  ).get(title);
  return !!row;
}

export function getRecentDeals(limit = 10) {
  return db.prepare(`
    SELECT title, price, discount, store, deal_url, sent_at
    FROM deals ORDER BY sent_at DESC LIMIT ?
  `).all(limit);
}

// --- Watchlist ---

export function addWatch(pattern) {
  try {
    db.prepare('INSERT INTO watchlist (pattern) VALUES (?)').run(pattern.trim());
    return true;
  } catch {
    return false; // already exists
  }
}

export function removeWatch(pattern) {
  const result = db.prepare('DELETE FROM watchlist WHERE pattern = ? COLLATE NOCASE').run(pattern.trim());
  return result.changes > 0;
}

export function getWatchlist() {
  return db.prepare('SELECT pattern, added_at FROM watchlist ORDER BY added_at DESC').all();
}

export function matchWatchlist(title) {
  const patterns = db.prepare('SELECT pattern FROM watchlist').all().map(r => r.pattern);
  return patterns.find(p => title.toLowerCase().includes(p.toLowerCase())) || null;
}

// --- Top deals ---

export function getTopDeals(limit = 5) {
  return db.prepare(`
    SELECT title, price, old_price, discount, rating, rating_score, store, platforms, deal_url
    FROM deals
    WHERE rating_score > 0
    ORDER BY rating_score DESC
    LIMIT ?
  `).all(limit);
}
