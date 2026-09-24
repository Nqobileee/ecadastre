'use strict';
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STORAGE_DIR = path.join(DATA_DIR, 'storage');
fs.mkdirSync(STORAGE_DIR, { recursive: true });

const db = new DatabaseSync(process.env.DB_PATH || path.join(DATA_DIR, 'cadastre.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('surveyor','planner','conveyancer','examiner','admin')),
  reg_no        TEXT,
  organisation  TEXT,
  phone         TEXT,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','suspended')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

-- A cadastral record: survey record, general plan, diagram, working plan, compilation, coordinate list.
CREATE TABLE IF NOT EXISTS records (
  id             INTEGER PRIMARY KEY,
  ref_no         TEXT UNIQUE,                 -- SR 51/2012, S.G. 200/76, GP 64-5/18 (null until approved)
  lodgement_no   TEXT UNIQUE,                 -- L-2026-0001 for online lodgements
  record_type    TEXT NOT NULL,
  title          TEXT NOT NULL,
  property_name  TEXT NOT NULL,
  district       TEXT NOT NULL,
  province       TEXT,
  office         TEXT,
  surveyor       TEXT,
  survey_date    TEXT,
  approved_date  TEXT,
  declared_area  TEXT,                        -- as written on the plan, e.g. "1 343,8769 ha"
  coord_system   TEXT NOT NULL DEFAULT 'LO29',-- LO29 = Lo 29 (metres); LEGACY = old plan units, not mapped
  datum          TEXT,
  related_refs   TEXT,
  notes          TEXT,
  status         TEXT NOT NULL CHECK (status IN ('lodged','under_examination','returned','approved')),
  lodged_by      INTEGER REFERENCES users(id),
  lodged_at      TEXT,
  examiner_id    INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS beacons (
  id          INTEGER PRIMARY KEY,
  record_id   INTEGER REFERENCES records(id) ON DELETE CASCADE,   -- null = national control network
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('trig','station','found','placed','computed')),
  y           REAL NOT NULL,
  x           REAL NOT NULL,
  z           REAL,
  description TEXT,
  locality    TEXT,
  calc_page   TEXT
);

CREATE TABLE IF NOT EXISTS parcels (
  id            INTEGER PRIMARY KEY,
  record_id     INTEGER NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  beacon_order  TEXT NOT NULL,                -- JSON array of beacon names, in order around the figure
  declared_m2   REAL
);

CREATE TABLE IF NOT EXISTS documents (
  id           INTEGER PRIMARY KEY,
  record_id    INTEGER NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  filename     TEXT NOT NULL,
  stored_name  TEXT NOT NULL,
  mime         TEXT NOT NULL,
  size         INTEGER NOT NULL,
  kind         TEXT,
  sha256       TEXT NOT NULL,
  uploaded_by  INTEGER REFERENCES users(id),
  uploaded_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS examinations (
  id          INTEGER PRIMARY KEY,
  record_id   INTEGER NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id),
  action      TEXT NOT NULL,                  -- lodged, resubmitted, started, returned, approved, comment
  comment     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id),
  action     TEXT NOT NULL,
  target     TEXT,
  ip         TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_beacons_record ON beacons(record_id);
CREATE INDEX IF NOT EXISTS idx_beacons_name ON beacons(name);
CREATE INDEX IF NOT EXISTS idx_records_status ON records(status);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit(created_at);
`);

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt') return false;
  const hash = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

function audit(userId, action, target, ip) {
  db.prepare('INSERT INTO audit (user_id, action, target, ip) VALUES (?, ?, ?, ?)').run(userId ?? null, action, target ?? null, ip ?? null);
}

/** Copy a file into managed storage and register it against a record. */
function storeDocument({ recordId, filename, buffer, mime, kind, userId }) {
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const ext = path.extname(filename).toLowerCase().replace(/[^.a-z0-9]/g, '');
  const storedName = `${crypto.randomUUID()}${ext}`;
  fs.writeFileSync(path.join(STORAGE_DIR, storedName), buffer);
  const r = db.prepare(`INSERT INTO documents (record_id, filename, stored_name, mime, size, kind, sha256, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(recordId, filename, storedName, mime, buffer.length, kind ?? null, sha256, userId ?? null);
  return Number(r.lastInsertRowid);
}

module.exports = { db, DATA_DIR, STORAGE_DIR, hashPassword, verifyPassword, audit, storeDocument };
