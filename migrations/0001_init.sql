-- Svorka: initial schema (phase 1 foundation)
-- Conventions: timestamps are ISO-8601 text (UTC); dates are 'YYYY-MM-DD'.
-- Every main table has custom_fields (JSON) for user-defined fields.

-- Lookup lists (číselníky). Values are never deleted, only deactivated.
CREATE TABLE codelist (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT    NOT NULL,            -- e.g. job_status, job_type, lead_source, first_contact_channel, payment_method, activity_type, car
  label       TEXT    NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_default  INTEGER NOT NULL DEFAULT 0,
  is_active_state INTEGER,                 -- job_status only: 1 = counts as "active" for colouring/sorting
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_codelist_type ON codelist(type, active, sort_order);

-- People (customers primarily, but also employees, suppliers…)
CREATE TABLE person (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  name                     TEXT NOT NULL,
  email                    TEXT,
  phone                    TEXT,
  billing_address          TEXT,           -- JSON: {label, street, number, city, zip, country, lat, lon, source, source_id}
  lead_source_id           INTEGER REFERENCES codelist(id),
  first_contact_channel_id INTEGER REFERENCES codelist(id),
  search_text              TEXT,           -- lowercase, diacritics stripped, for full-text search
  custom_fields            TEXT NOT NULL DEFAULT '{}'
);

-- Jobs (zákazky)
CREATE TABLE job (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  title            TEXT NOT NULL,
  status_id        INTEGER REFERENCES codelist(id),
  is_active        INTEGER NOT NULL DEFAULT 1,  -- manual, independent of status
  customer_id      INTEGER REFERENCES person(id),
  type_id          INTEGER REFERENCES codelist(id),
  location_address TEXT,                        -- JSON, prefilled from customer
  billing_address  TEXT,                        -- JSON, prefilled from customer
  search_text      TEXT,
  custom_fields    TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_job_customer ON job(customer_id);
CREATE INDEX idx_job_active ON job(is_active, created_at);

-- Comment journal for any entity (newest first in UI)
CREATE TABLE comment (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT    NOT NULL,             -- 'person', 'job', …
  entity_id   INTEGER NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  text        TEXT    NOT NULL
);
CREATE INDEX idx_comment_entity ON comment(entity_type, entity_id, created_at DESC);

-- Full-text search index across people and jobs (FTS5, fed from search_text)
CREATE VIRTUAL TABLE search_index USING fts5(
  entity_type UNINDEXED,
  entity_id   UNINDEXED,
  text,
  tokenize = 'unicode61 remove_diacritics 2'
);

-- User-defined extra fields, rendered by the generic table/form
CREATE TABLE field_definition (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT    NOT NULL,
  key         TEXT    NOT NULL,             -- key inside custom_fields JSON; never changes
  label       TEXT    NOT NULL,             -- display name; safe to rename
  data_type   TEXT    NOT NULL,             -- text, number, date, boolean, codelist
  codelist_type TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  UNIQUE (entity_type, key)
);

-- Saved table views (filters, grouping, sorting, column order)
CREATE TABLE saved_view (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  state       TEXT    NOT NULL,             -- JSON table state
  is_default  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Starter lookup values (editable in the app later)
INSERT INTO codelist (type, label, sort_order, is_default, is_active_state) VALUES
  ('job_status', 'Lead',              10, 1, 1),
  ('job_status', 'Obhliadka',         20, 0, 1),
  ('job_status', 'Cenová ponuka',     30, 0, 1),
  ('job_status', 'Realizácia',        40, 0, 1),
  ('job_status', 'Fakturácia',        50, 0, 1),
  ('job_status', 'Ukončená',          60, 0, 0),
  ('job_status', 'Zrušená',           70, 0, 0);

INSERT INTO codelist (type, label, sort_order) VALUES
  ('job_type', 'Drobná oprava', 10),
  ('job_type', 'Rekonštrukcia bytu', 20),
  ('job_type', 'Dlhodobá spolupráca', 30),
  ('lead_source', 'Odporúčanie', 10),
  ('lead_source', 'Internet', 20),
  ('lead_source', 'Opakovaný zákazník', 30),
  ('first_contact_channel', 'Telefón', 10),
  ('first_contact_channel', 'Email', 20),
  ('first_contact_channel', 'WhatsApp / SMS', 30),
  ('first_contact_channel', 'Osobne', 40),
  ('payment_method', 'Hotovosť', 10),
  ('payment_method', 'Súkromný účet', 20),
  ('payment_method', 'Podnikateľský účet', 30),
  ('payment_method', 'Iné', 40),
  ('activity_type', 'Montáž', 10),
  ('activity_type', 'Obhliadka', 20),
  ('activity_type', 'Nákup materiálu', 30),
  ('activity_type', 'Administratíva', 40);
