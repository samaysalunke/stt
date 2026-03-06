import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(process.cwd(), 'data', 'seekthethrill.db');

// Ensure data directory exists
import fs from 'fs';
const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
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
  `);

  // Migration: add why_join column to existing databases
  try { db.exec('ALTER TABLE registrations ADD COLUMN why_join TEXT'); } catch {}
}
