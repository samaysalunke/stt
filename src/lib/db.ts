import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'seekthethrill.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    initializeSchema(_db);
  }
  return _db;
}

function initializeSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_name TEXT NOT NULL,
      trip_date TEXT,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      date_of_birth TEXT,
      gender TEXT,
      address TEXT,
      city TEXT,
      state TEXT,
      country TEXT DEFAULT 'India',
      pincode TEXT,
      emergency_name TEXT NOT NULL,
      emergency_phone TEXT NOT NULL,
      emergency_relationship TEXT,
      num_travelers INTEGER DEFAULT 1,
      other_travelers TEXT,
      dietary TEXT,
      dietary_notes TEXT,
      food_allergies TEXT,
      medical_conditions TEXT,
      medications TEXT,
      experience_level TEXT,
      tshirt_size TEXT,
      payment_screenshot_url TEXT,
      transaction_id TEXT,
      amount_paid INTEGER DEFAULT 0,
      payment_date TEXT,
      payment_method TEXT,
      source TEXT,
      source_detail TEXT,
      special_requests TEXT,
      photo_consent INTEGER DEFAULT 0,
      why_join TEXT,
      status TEXT DEFAULT 'pending',
      admin_notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS contact_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      source TEXT,
      status TEXT DEFAULT 'new',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS newsletter_subscribers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      subscribed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS broadcast_log (
      id TEXT PRIMARY KEY,
      subject TEXT,
      sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      recipient_count INTEGER,
      status TEXT
    );
  `);

  // Migration: add why_join column to existing databases
  try { db.exec('ALTER TABLE registrations ADD COLUMN why_join TEXT'); } catch {}
  // Migration: Task 3 — email tracking
  try { db.exec('ALTER TABLE registrations ADD COLUMN email_sent INTEGER DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE registrations ADD COLUMN transaction_id TEXT'); } catch {}
  // Migration: Task 4A — newsletter columns
  try { db.exec('ALTER TABLE newsletter_subscribers ADD COLUMN name TEXT'); } catch {}
  try { db.exec("ALTER TABLE newsletter_subscribers ADD COLUMN status TEXT DEFAULT 'active'"); } catch {}
  try { db.exec('ALTER TABLE newsletter_subscribers ADD COLUMN source TEXT'); } catch {}
  try { db.exec('ALTER TABLE newsletter_subscribers ADD COLUMN unsubscribe_token TEXT'); } catch {}
  // Migration: occupancy / room-sharing selection
  try { db.exec('ALTER TABLE registrations ADD COLUMN sharing_option TEXT'); } catch {}
  try { db.exec('ALTER TABLE registrations ADD COLUMN total_amount INTEGER'); } catch {}
  // Migration: which departure (batch/date) the booking is for
  try { db.exec('ALTER TABLE registrations ADD COLUMN batch_id TEXT'); } catch {}
  // Migration: consent — timestamp the traveller accepted Terms + Cancellation policy
  try { db.exec('ALTER TABLE registrations ADD COLUMN consent_at DATETIME'); } catch {}
  // Migration: age (text) + instagram handle
  try { db.exec('ALTER TABLE registrations ADD COLUMN age TEXT'); } catch {}
  try { db.exec('ALTER TABLE registrations ADD COLUMN instagram TEXT'); } catch {}
  // Migration: tier_id for per-departure occupancy tracking (new schema)
  try { db.exec('ALTER TABLE registrations ADD COLUMN tier_id TEXT'); } catch {}

  // feature/auth — user accounts + sessions
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      displayName TEXT,
      avatarUrl TEXT,
      googleId TEXT UNIQUE NOT NULL,
      createdAt INTEGER DEFAULT (unixepoch()),
      lastLoginAt INTEGER
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      expiresAt INTEGER NOT NULL,
      createdAt INTEGER DEFAULT (unixepoch())
    );
  `);
}
