-- Retail Customer Management System - initial schema
-- Covers all planned modules so later milestones do not require destructive migrations.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- Staff accounts and roles
-- ---------------------------------------------------------------------------
-- Roles are a fixed enum rather than a join table: the brief calls for three
-- well-defined roles, and an enum keeps permission checks cheap and typo-proof.
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'back_office', 'front_of_house');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  role          user_role NOT NULL DEFAULT 'front_of_house',
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Case-insensitive uniqueness: staff type their email inconsistently on a tablet.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id             SERIAL PRIMARY KEY,
  customer_code  TEXT,                  -- the shop's own reference / legacy ID
  first_name     TEXT NOT NULL,
  last_name      TEXT NOT NULL,
  email          TEXT,
  phone          TEXT,
  address_line1  TEXT,
  address_line2  TEXT,
  city           TEXT,
  postcode       TEXT,
  country        TEXT,
  date_of_birth  DATE,
  marketing_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  loyalty_tier   TEXT,                  -- bronze / silver / gold, shop-defined
  loyalty_points INTEGER NOT NULL DEFAULT 0,
  -- Admin-defined extra fields live here. JSONB (not extra columns) so the
  -- admin panel can add a field without a migration or a deploy.
  custom_fields  JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes_summary  TEXT,
  archived_at    TIMESTAMPTZ,           -- NULL = active. Archive, never delete.
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Legacy imports frequently carry duplicate/blank codes, so this is a partial
-- index: uniqueness is enforced only where a code actually exists.
CREATE UNIQUE INDEX IF NOT EXISTS customers_code_idx
  ON customers (lower(customer_code)) WHERE customer_code IS NOT NULL AND customer_code <> '';

-- Trigram indexes power the "type any fragment" directory search. GIN + trigram
-- handles partial matches ("smi", "0771") that a plain b-tree or tsvector will not.
CREATE INDEX IF NOT EXISTS customers_name_trgm_idx
  ON customers USING gin ((coalesce(first_name,'') || ' ' || coalesce(last_name,'')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS customers_email_trgm_idx
  ON customers USING gin (coalesce(email,'') gin_trgm_ops);
CREATE INDEX IF NOT EXISTS customers_phone_trgm_idx
  ON customers USING gin (coalesce(phone,'') gin_trgm_ops);
CREATE INDEX IF NOT EXISTS customers_archived_idx ON customers (archived_at);
CREATE INDEX IF NOT EXISTS customers_created_idx  ON customers (created_at DESC);

-- ---------------------------------------------------------------------------
-- Purchase history
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchases (
  id           SERIAL PRIMARY KEY,
  customer_id  INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  occurred_at  TIMESTAMPTZ NOT NULL,
  reference    TEXT,                    -- receipt / order number
  channel      TEXT,                    -- in-store, online, phone
  -- NUMERIC not float: money must not drift.
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency     TEXT NOT NULL DEFAULT 'GBP',
  items        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Timeline reads are always "this customer, newest first".
CREATE INDEX IF NOT EXISTS purchases_customer_time_idx ON purchases (customer_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS purchases_time_idx ON purchases (occurred_at DESC);

-- ---------------------------------------------------------------------------
-- Notes, reminders, support tickets
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notes (
  id          SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  author_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notes_customer_idx ON notes (customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS reminders (
  id           SERIAL PRIMARY KEY,
  customer_id  INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  body         TEXT NOT NULL,
  due_at       TIMESTAMPTZ NOT NULL,
  assigned_to  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Partial index: the "what's due" screen only ever reads open reminders.
CREATE INDEX IF NOT EXISTS reminders_open_idx ON reminders (due_at) WHERE completed_at IS NULL;
CREATE INDEX IF NOT EXISTS reminders_customer_idx ON reminders (customer_id);

DO $$ BEGIN
  CREATE TYPE ticket_status AS ENUM ('open', 'pending', 'resolved', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS tickets (
  id          SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  subject     TEXT NOT NULL,
  body        TEXT,
  status      ticket_status NOT NULL DEFAULT 'open',
  priority    TEXT NOT NULL DEFAULT 'normal',
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS tickets_customer_idx ON tickets (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tickets_open_idx ON tickets (status) WHERE status IN ('open','pending');

-- ---------------------------------------------------------------------------
-- Admin-defined custom fields
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS custom_field_defs (
  id         SERIAL PRIMARY KEY,
  field_key  TEXT NOT NULL UNIQUE,      -- key inside customers.custom_fields
  label      TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'text', -- text | number | date | select | checkbox
  options    JSONB NOT NULL DEFAULT '[]'::jsonb,
  required   BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- CSV import audit
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS import_jobs (
  id            SERIAL PRIMARY KEY,
  filename      TEXT NOT NULL,
  total_rows    INTEGER NOT NULL DEFAULT 0,
  inserted_rows INTEGER NOT NULL DEFAULT 0,
  updated_rows  INTEGER NOT NULL DEFAULT 0,
  failed_rows   INTEGER NOT NULL DEFAULT 0,
  errors        JSONB NOT NULL DEFAULT '[]'::jsonb, -- capped sample, see importer
  status        TEXT NOT NULL DEFAULT 'completed',
  duration_ms   INTEGER,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS customers_touch ON customers;
CREATE TRIGGER customers_touch BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS users_touch ON users;
CREATE TRIGGER users_touch BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS tickets_touch ON tickets;
CREATE TRIGGER tickets_touch BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
