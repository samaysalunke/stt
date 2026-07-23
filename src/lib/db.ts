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
      dietary_notes TEXT,
      experience_level TEXT,
      tshirt_size TEXT,
      payment_screenshot_url TEXT,
      transaction_id TEXT,
      amount_paid INTEGER DEFAULT 0,
      payment_date TEXT,
      payment_method TEXT,
      source TEXT,
      source_detail TEXT,
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
  // Migration: store email send error for failed transactional emails so ops can follow up
  try { db.exec('ALTER TABLE registrations ADD COLUMN email_error TEXT'); } catch {}
  // Checkout recovery: track status transitions and manual unpaid-lead nudges.
  try { db.exec('ALTER TABLE registrations ADD COLUMN status_changed_at DATETIME'); } catch {}
  try { db.exec('ALTER TABLE registrations ADD COLUMN nudge_sent_at DATETIME'); } catch {}
  // Migration: drop deprecated registration fields no longer collected by the booking form
  for (const col of ['num_travelers', 'other_travelers', 'dietary', 'food_allergies', 'medical_conditions', 'medications', 'special_requests']) {
    try { db.exec(`ALTER TABLE registrations DROP COLUMN ${col}`); } catch {}
  }

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

  // feature/public-profile — share tracking on registrations
  try { db.exec('ALTER TABLE registrations ADD COLUMN sharedAt TEXT'); } catch {}

  // feature/gamification — usernames, leaderboard, geocoding
  // Note: SQLite ALTER TABLE cannot add UNIQUE columns — add column then index separately
  try { db.exec('ALTER TABLE users ADD COLUMN username TEXT'); } catch {}
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON users(username) WHERE username IS NOT NULL'); } catch {}
  try { db.exec('ALTER TABLE users ADD COLUMN usernameChangedAt INTEGER'); } catch {}
  try { db.exec('ALTER TABLE users ADD COLUMN leaderboardOptOut INTEGER DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE users ADD COLUMN showTripsPublicly INTEGER DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE users ADD COLUMN homeCityLatLng TEXT'); } catch {}
  try { db.exec('ALTER TABLE users ADD COLUMN displayNameOverride INTEGER DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE registrations ADD COLUMN trip_slug TEXT'); } catch {}
  // Indices for customer directory aggregation
  try { db.exec('CREATE INDEX IF NOT EXISTS registrations_email_lower ON registrations(lower(trim(email)))'); } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS registrations_batch_id ON registrations(batch_id)'); } catch {}

  db.exec(`
    CREATE TABLE IF NOT EXISTS geocode_cache (
      query TEXT PRIMARY KEY,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      displayName TEXT,
      fetchedAt INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS leaderboard_cache (
      userId TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      displayName TEXT,
      username TEXT,
      avatarUrl TEXT,
      homeCityLatLng TEXT,
      kmsFromHome REAL DEFAULT 0,
      daysOutdoors INTEGER DEFAULT 0,
      destinationsCount INTEGER DEFAULT 0,
      tripsCount INTEGER DEFAULT 0,
      updatedAt INTEGER DEFAULT (unixepoch())
    );
  `);

  // feature/rbac — roles, admin sessions, audit log
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_roles (
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('owner','ops','trip_lead')),
      assignedBy TEXT REFERENCES users(id),
      assignedAt INTEGER DEFAULT (unixepoch()),
      tripIds TEXT DEFAULT '[]',
      PRIMARY KEY (userId, role)
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      expiresAt INTEGER NOT NULL,
      lastActivityAt INTEGER NOT NULL,
      ipAddress TEXT,
      createdAt INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      actorUserId TEXT,
      actorEmail TEXT,
      actorRole TEXT,
      action TEXT NOT NULL,
      targetType TEXT,
      targetId TEXT,
      previousValue TEXT,
      newValue TEXT,
      ipAddress TEXT,
      createdAt INTEGER DEFAULT (unixepoch())
    );
  `);

  // feature/analytics-chatbot — owner-only analytics sessions, messages, audit
  db.exec(`
    CREATE TABLE IF NOT EXISTS analytics_sessions (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS analytics_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES analytics_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user','assistant','tool')),
      content TEXT,
      tool_name TEXT,
      tool_input TEXT,
      tool_output TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS analytics_audit_log (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      owner_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      tool_tier TEXT,
      tool_name TEXT,
      tool_input TEXT,
      pii_attempt_detected INTEGER NOT NULL DEFAULT 0,
      ambiguity_resolved INTEGER NOT NULL DEFAULT 0,
      selection_made TEXT,
      result_row_count INTEGER,
      error TEXT,
      duration_ms INTEGER,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS analytics_messages_session_id ON analytics_messages(session_id);
    CREATE INDEX IF NOT EXISTS analytics_audit_log_owner_created ON analytics_audit_log(owner_id, created_at);
  `);

  // feature/custom-itineraries — leads from the bespoke-trip enquiry form
  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_itinerary_leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      destination TEXT,
      travellers TEXT,
      dates TEXT,
      budget TEXT,
      message TEXT,
      status TEXT DEFAULT 'new',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Soft-delete tombstones for trips. The YAML file stays on disk (on the
  // content volume); a row here hides the trip everywhere. Restore = delete
  // the row. Lives on the DATA_DIR volume so it survives deploys/re-seeds.
  db.exec(`
    CREATE TABLE IF NOT EXISTS deleted_trips (
      slug TEXT PRIMARY KEY,
      deletedAt INTEGER DEFAULT (unixepoch()),
      actorEmail TEXT,
      actorRole TEXT
    );
  `);
}
