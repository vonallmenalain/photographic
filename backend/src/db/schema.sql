-- Sicherer, E-Mail-basierter Verkaufsraum für Kinderfotos
-- SQLite schema. The whole DB lives on the QNAP volume next to the photos.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Admin users (your control center). Usually a single admin from env, but the
-- table allows more later.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Events / Foto-Sets (a shooting, class, kindergarten group, ...)
-- status: draft | in_progress | ready | published | archived | disabled
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'draft',
  expires_at  TEXT,                       -- retention / availability deadline
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Children. The name is an internal label only and is NEVER shown to parents.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS children (
  id         TEXT PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_children_event ON children(event_id);

-- ---------------------------------------------------------------------------
-- Parent e-mail addresses = the central identity / sales instance anchor.
-- status: created | not_verified | verification_sent | verified | disabled | support
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS parent_emails (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,       -- normalized lowercase
  status      TEXT NOT NULL DEFAULT 'created',
  verified_at TEXT,
  note        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Link e-mail <-> child (many to many). Mutter & Vater, mehrere Kinder, ...
CREATE TABLE IF NOT EXISTS email_children (
  email_id   TEXT NOT NULL REFERENCES parent_emails(id) ON DELETE CASCADE,
  child_id   TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (email_id, child_id)
);

-- ---------------------------------------------------------------------------
-- Photos. Only one original is uploaded; variants are generated from it.
-- status: uploaded | processed | assigned | disabled
-- child_id NULL + is_class_photo=1  -> belongs to a group, assigned per e-mail.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS photos (
  id                TEXT PRIMARY KEY,
  event_id          TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  child_id          TEXT REFERENCES children(id) ON DELETE SET NULL,
  is_class_photo    INTEGER NOT NULL DEFAULT 0,
  original_filename TEXT NOT NULL,
  storage_key       TEXT NOT NULL,        -- base path, variants derived from it
  ext               TEXT NOT NULL DEFAULT 'jpg',
  width             INTEGER,
  height            INTEGER,
  bytes             INTEGER,
  status            TEXT NOT NULL DEFAULT 'uploaded',
  processing_error  TEXT,
  published         INTEGER NOT NULL DEFAULT 0,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_photos_event ON photos(event_id);
CREATE INDEX IF NOT EXISTS idx_photos_child ON photos(child_id);

-- Direct photo <-> e-mail assignment (class photos / manual overrides).
CREATE TABLE IF NOT EXISTS photo_emails (
  photo_id   TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  email_id   TEXT NOT NULL REFERENCES parent_emails(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (photo_id, email_id)
);

-- ---------------------------------------------------------------------------
-- Verification codes / magic links for parents.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS verification_tokens (
  id          TEXT PRIMARY KEY,
  email_id    TEXT NOT NULL REFERENCES parent_emails(id) ON DELETE CASCADE,
  code_hash   TEXT NOT NULL,              -- hashed 6-digit code
  link_token  TEXT NOT NULL UNIQUE,       -- magic link token (opaque)
  attempts    INTEGER NOT NULL DEFAULT 0,
  consumed_at TEXT,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_vtokens_email ON verification_tokens(email_id);

-- ---------------------------------------------------------------------------
-- Parent sessions (browser remembers the verified e-mail).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS parent_sessions (
  id         TEXT PRIMARY KEY,
  email_id   TEXT NOT NULL REFERENCES parent_emails(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_psessions_email ON parent_sessions(email_id);

-- ---------------------------------------------------------------------------
-- Products / pricing.
-- type: digital | print
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type        TEXT NOT NULL DEFAULT 'digital',
  price_cents INTEGER NOT NULL,
  currency    TEXT NOT NULL DEFAULT 'eur',
  active      INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Orders.
-- status: cart | checkout_started | paid | failed | completed | fulfilled | cancelled | refunded
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id              TEXT PRIMARY KEY,
  email_id        TEXT NOT NULL REFERENCES parent_emails(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'cart',
  currency        TEXT NOT NULL DEFAULT 'eur',
  total_cents     INTEGER NOT NULL DEFAULT 0,
  payment_provider TEXT,
  payment_ref     TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_email ON orders(email_id);

CREATE TABLE IF NOT EXISTS order_items (
  id              TEXT PRIMARY KEY,
  order_id        TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  photo_id        TEXT NOT NULL REFERENCES photos(id) ON DELETE RESTRICT,
  product_id      TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  qty             INTEGER NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL,
  product_name    TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

-- Carts are modelled as an order in status 'cart' (max one per e-mail).
-- cart_items reuse order_items via that cart order.

-- ---------------------------------------------------------------------------
-- Download grants (post purchase access to originals/high-res files).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS download_grants (
  id          TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  email_id    TEXT NOT NULL REFERENCES parent_emails(id) ON DELETE CASCADE,
  photo_id    TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  downloads   INTEGER NOT NULL DEFAULT 0,
  expires_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_grants_email ON download_grants(email_id);

-- ---------------------------------------------------------------------------
-- Reports / Meldefunktion (problems reported by parents).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reports (
  id         TEXT PRIMARY KEY,
  email_id   TEXT REFERENCES parent_emails(id) ON DELETE SET NULL,
  email_text TEXT NOT NULL DEFAULT '',
  type       TEXT NOT NULL DEFAULT 'other',
  message    TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Simple audit log for admin actions.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id         TEXT PRIMARY KEY,
  actor      TEXT NOT NULL DEFAULT 'system',
  action     TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
