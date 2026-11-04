-- Svorka: all modules (finance, documents, attendance, trips, todos, notifications)
-- Conventions as in 0001: timestamps ISO-8601 UTC text, dates 'YYYY-MM-DD', custom_fields JSON.

-- Lookup lists: colour and extra flags (e.g. {"lead": true} on a job status)
ALTER TABLE codelist ADD COLUMN color TEXT;
ALTER TABLE codelist ADD COLUMN meta TEXT NOT NULL DEFAULT '{}';

-- Names of lookup lists, so new lists can be added without code changes
CREATE TABLE codelist_type (
  key   TEXT PRIMARY KEY,
  label TEXT NOT NULL
);
INSERT INTO codelist_type (key, label) VALUES
  ('job_status', 'Stav zákazky'),
  ('job_type', 'Typ zákazky'),
  ('lead_source', 'Odkiaľ sa o mne dozvedel'),
  ('first_contact_channel', 'Kanál prvého kontaktu'),
  ('payment_method', 'Spôsob platby'),
  ('activity_type', 'Typ aktivity'),
  ('car', 'Auto'),
  ('inspection_status', 'Stav obhliadky'),
  ('invoice_type', 'Typ faktúry');

UPDATE codelist SET color = 'grape', meta = '{"lead":true}' WHERE type = 'job_status' AND label = 'Lead';
UPDATE codelist SET color = 'blue'   WHERE type = 'job_status' AND label = 'Obhliadka';
UPDATE codelist SET color = 'cyan'   WHERE type = 'job_status' AND label = 'Cenová ponuka';
UPDATE codelist SET color = 'orange' WHERE type = 'job_status' AND label = 'Realizácia';
UPDATE codelist SET color = 'yellow' WHERE type = 'job_status' AND label = 'Fakturácia';
UPDATE codelist SET color = 'green'  WHERE type = 'job_status' AND label = 'Ukončená';
UPDATE codelist SET color = 'gray'   WHERE type = 'job_status' AND label = 'Zrušená';

INSERT INTO codelist (type, label, sort_order, is_default, color) VALUES
  ('inspection_status', 'Plánovaná', 10, 1, 'blue'),
  ('inspection_status', 'Realizovaná', 20, 0, 'green'),
  ('inspection_status', 'Zrušená', 30, 0, 'gray'),
  ('invoice_type', 'Faktúra', 10, 1, NULL),
  ('invoice_type', 'Zálohová faktúra', 20, 0, NULL),
  ('invoice_type', 'Dobropis', 30, 0, NULL),
  ('car', 'Súkromné auto', 10, 1, NULL);

-- Key/value settings (e.g. self_person_id = "me")
CREATE TABLE setting (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Accounting entries (účtovné záznamy). One number series per year: U26-001.
-- realized_on drives revenue/cost reporting; paid_on empty = still owed (debt).
CREATE TABLE ledger_entry (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  year              INTEGER NOT NULL,
  seq               INTEGER NOT NULL,
  direction         TEXT NOT NULL CHECK (direction IN ('income','expense')),
  realized_on       TEXT NOT NULL,
  paid_on           TEXT,
  payment_method_id INTEGER REFERENCES codelist(id),
  payment_note      TEXT,
  amount            REAL NOT NULL DEFAULT 0,
  title             TEXT NOT NULL,
  description       TEXT,
  counterparty_id   INTEGER REFERENCES person(id),
  invoice_id        INTEGER REFERENCES invoice(id),
  document_note     TEXT,                    -- free text about the receipt, e.g. "chýba, dodá"
  custom_fields     TEXT NOT NULL DEFAULT '{}',
  UNIQUE (year, seq)
);
CREATE INDEX idx_ledger_realized ON ledger_entry(realized_on);

-- Parts of an entry, each optionally tied to a job (split receipts)
CREATE TABLE ledger_split (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id    INTEGER NOT NULL REFERENCES ledger_entry(id) ON DELETE CASCADE,
  job_id      INTEGER REFERENCES job(id),
  amount      REAL NOT NULL DEFAULT 0,
  title       TEXT,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_split_entry ON ledger_split(entry_id);
CREATE INDEX idx_split_job ON ledger_split(job_id);

CREATE TABLE inspection (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  job_id        INTEGER NOT NULL REFERENCES job(id),
  scheduled_at  TEXT,                        -- 'YYYY-MM-DD HH:mm' or date only
  status_id     INTEGER REFERENCES codelist(id),
  location      TEXT,                        -- address JSON
  phone         TEXT,
  note          TEXT,
  custom_fields TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_inspection_job ON inspection(job_id);

CREATE TABLE quote (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_on    TEXT NOT NULL,
  job_id        INTEGER NOT NULL REFERENCES job(id),
  amount        REAL,
  valid_until   TEXT,
  note          TEXT,
  custom_fields TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_quote_job ON quote(job_id);

-- Issued invoices / advance invoices / credit notes. One series for all types: 12/2026.
CREATE TABLE invoice (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  year          INTEGER NOT NULL,
  seq           INTEGER NOT NULL,
  type_id       INTEGER REFERENCES codelist(id),
  created_on    TEXT NOT NULL,
  realized_on   TEXT,
  due_on        TEXT,
  paid_on       TEXT,
  job_id        INTEGER REFERENCES job(id),
  amount        REAL,
  note          TEXT,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  UNIQUE (year, seq)
);
CREATE INDEX idx_invoice_job ON invoice(job_id);

CREATE TABLE attendance (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  realized_on      TEXT NOT NULL,
  intervals        TEXT,                     -- e.g. "8-12, 16-18"
  person_id        INTEGER REFERENCES person(id),
  job_id           INTEGER REFERENCES job(id),
  hours            REAL,
  activity_type_id INTEGER REFERENCES codelist(id),
  description      TEXT,
  custom_fields    TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_attendance_date ON attendance(realized_on);
CREATE INDEX idx_attendance_job ON attendance(job_id);

-- Trips; a multi-day trip has its km spread evenly over its days in summaries
CREATE TABLE trip (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  date_from     TEXT NOT NULL,
  date_to       TEXT NOT NULL,
  car_id        INTEGER REFERENCES codelist(id),
  km_before     REAL,
  km_after      REAL,
  km            REAL,                        -- computed from odometer when both are filled, else manual
  attendance_id INTEGER REFERENCES attendance(id) ON DELETE SET NULL,
  job_id        INTEGER REFERENCES job(id),
  note          TEXT,
  custom_fields TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_trip_dates ON trip(date_from, date_to);

-- Refuelling adds km to the car's fuel budget; trips subtract from it
CREATE TABLE refuel (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  realized_on     TEXT NOT NULL,
  car_id          INTEGER REFERENCES codelist(id),
  liters          REAL,
  km_range        REAL NOT NULL DEFAULT 0,
  amount          REAL,
  ledger_entry_id INTEGER REFERENCES ledger_entry(id) ON DELETE SET NULL,
  note            TEXT,
  custom_fields   TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE todo (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  text          TEXT NOT NULL,
  due_on        TEXT,
  done          INTEGER NOT NULL DEFAULT 0,
  closed_at     TEXT,
  source_key    TEXT UNIQUE,                 -- set when generated by a notification rule (dedupe)
  rule_id       INTEGER REFERENCES notification_rule(id) ON DELETE SET NULL,
  custom_fields TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_todo_open ON todo(done, due_on);

-- Todo can point at any records
CREATE TABLE todo_link (
  todo_id     INTEGER NOT NULL REFERENCES todo(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id   INTEGER NOT NULL,
  PRIMARY KEY (todo_id, entity_type, entity_id)
);
CREATE INDEX idx_todo_link_entity ON todo_link(entity_type, entity_id);

-- Rules that create todos. kind: missing_attendance, overdue_invoice, stale_job, sql
CREATE TABLE notification_rule (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL,
  params     TEXT NOT NULL DEFAULT '{}',
  enabled    INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT
);
INSERT INTO notification_rule (name, kind, params) VALUES
  ('Chýba dochádzka za pracovný deň', 'missing_attendance', '{"lookback_days":14}'),
  ('Faktúra viac ako týždeň po splatnosti', 'overdue_invoice', '{"days":7}'),
  ('Aktívna zákazka bez pohybu', 'stale_job', '{"days":30}');

-- Stored documents (R2 now, OneDrive later). path is the folder-structured key.
CREATE TABLE file (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  entity_type  TEXT NOT NULL,
  entity_id    INTEGER NOT NULL,
  role         TEXT NOT NULL DEFAULT 'attachment',  -- receipt | attachment | document
  name         TEXT NOT NULL,
  path         TEXT NOT NULL UNIQUE,
  content_type TEXT,
  size         INTEGER
);
CREATE INDEX idx_file_entity ON file(entity_type, entity_id);

-- Read models for tables -------------------------------------------------

CREATE VIEW v_person AS
SELECT p.*,
  ls.label AS lead_source,
  fc.label AS first_contact_channel,
  (SELECT COUNT(*) FROM job j WHERE j.customer_id = p.id) AS job_count,
  (SELECT json_group_array(json_object('id', id, 'created_at', created_at, 'text', text))
     FROM (SELECT * FROM comment c WHERE c.entity_type = 'person' AND c.entity_id = p.id ORDER BY c.created_at DESC)) AS comments
FROM person p
LEFT JOIN codelist ls ON ls.id = p.lead_source_id
LEFT JOIN codelist fc ON fc.id = p.first_contact_channel_id;

CREATE VIEW v_job AS
SELECT j.*,
  p.name AS customer_name,
  p.phone AS customer_phone,
  st.label AS status,
  st.color AS status_color,
  COALESCE(st.is_active_state, 0) AS status_active,
  COALESCE(json_extract(st.meta, '$.lead'), 0) AS is_lead,
  ty.label AS type,
  (SELECT json_group_array(json_object('id', id, 'created_at', created_at, 'text', text))
     FROM (SELECT * FROM comment c WHERE c.entity_type = 'job' AND c.entity_id = j.id ORDER BY c.created_at DESC)) AS comments,
  (SELECT COALESCE(SUM(s.amount), 0) FROM ledger_split s JOIN ledger_entry e ON e.id = s.entry_id
     WHERE s.job_id = j.id AND e.direction = 'income') AS income_total,
  (SELECT COALESCE(SUM(s.amount), 0) FROM ledger_split s JOIN ledger_entry e ON e.id = s.entry_id
     WHERE s.job_id = j.id AND e.direction = 'expense') AS expense_total,
  (SELECT COALESCE(SUM(a.hours), 0) FROM attendance a WHERE a.job_id = j.id) AS hours_total,
  MAX(j.created_at,
    COALESCE((SELECT MAX(created_at) FROM comment c WHERE c.entity_type = 'job' AND c.entity_id = j.id), ''),
    COALESCE((SELECT MAX(realized_on) FROM attendance a WHERE a.job_id = j.id), ''),
    COALESCE((SELECT MAX(e.realized_on) FROM ledger_split s JOIN ledger_entry e ON e.id = s.entry_id WHERE s.job_id = j.id), '')
  ) AS last_activity_at
FROM job j
LEFT JOIN person p ON p.id = j.customer_id
LEFT JOIN codelist st ON st.id = j.status_id
LEFT JOIN codelist ty ON ty.id = j.type_id;

CREATE VIEW v_ledger_entry AS
SELECT e.*,
  'U' || substr(CAST(e.year AS TEXT), 3) || '-' || printf('%03d', e.seq) AS code,
  pm.label AS payment_method,
  cp.name AS counterparty_name,
  CASE WHEN e.invoice_id IS NULL THEN NULL ELSE (SELECT i.seq || '/' || i.year FROM invoice i WHERE i.id = e.invoice_id) END AS invoice_number,
  (SELECT json_group_array(json_object('id', s.id, 'job_id', s.job_id, 'job_title', j.title, 'amount', s.amount, 'title', s.title, 'description', s.description))
     FROM (SELECT * FROM ledger_split WHERE entry_id = e.id ORDER BY sort_order, id) s LEFT JOIN job j ON j.id = s.job_id) AS splits,
  (SELECT group_concat(DISTINCT j.title) FROM ledger_split s JOIN job j ON j.id = s.job_id WHERE s.entry_id = e.id) AS job_titles,
  (SELECT MAX(id) FROM file f WHERE f.entity_type = 'ledger_entry' AND f.entity_id = e.id AND f.role = 'receipt') AS receipt_file_id,
  (SELECT COUNT(*) FROM file f WHERE f.entity_type = 'ledger_entry' AND f.entity_id = e.id) AS file_count
FROM ledger_entry e
LEFT JOIN codelist pm ON pm.id = e.payment_method_id
LEFT JOIN person cp ON cp.id = e.counterparty_id;

CREATE VIEW v_inspection AS
SELECT i.*, j.title AS job_title, p.name AS customer_name,
  st.label AS status, st.color AS status_color,
  (SELECT COUNT(*) FROM file f WHERE f.entity_type = 'inspection' AND f.entity_id = i.id) AS file_count
FROM inspection i
LEFT JOIN job j ON j.id = i.job_id
LEFT JOIN person p ON p.id = j.customer_id
LEFT JOIN codelist st ON st.id = i.status_id;

CREATE VIEW v_quote AS
SELECT q.*, j.title AS job_title, p.name AS customer_name,
  (SELECT COUNT(*) FROM file f WHERE f.entity_type = 'quote' AND f.entity_id = q.id) AS file_count,
  (SELECT MAX(id) FROM file f WHERE f.entity_type = 'quote' AND f.entity_id = q.id) AS latest_file_id
FROM quote q
LEFT JOIN job j ON j.id = q.job_id
LEFT JOIN person p ON p.id = j.customer_id;

CREATE VIEW v_invoice AS
SELECT i.*, i.seq || '/' || i.year AS number,
  ty.label AS type, j.title AS job_title, p.name AS customer_name,
  (SELECT COUNT(*) FROM file f WHERE f.entity_type = 'invoice' AND f.entity_id = i.id) AS file_count,
  (SELECT MAX(id) FROM file f WHERE f.entity_type = 'invoice' AND f.entity_id = i.id) AS latest_file_id
FROM invoice i
LEFT JOIN codelist ty ON ty.id = i.type_id
LEFT JOIN job j ON j.id = i.job_id
LEFT JOIN person p ON p.id = j.customer_id;

CREATE VIEW v_attendance AS
SELECT a.*, pe.name AS person_name, j.title AS job_title, at.label AS activity_type,
  (SELECT COALESCE(SUM(km), 0) FROM trip t WHERE t.attendance_id = a.id) AS trip_km
FROM attendance a
LEFT JOIN person pe ON pe.id = a.person_id
LEFT JOIN job j ON j.id = a.job_id
LEFT JOIN codelist at ON at.id = a.activity_type_id;

CREATE VIEW v_trip AS
SELECT t.*, c.label AS car, j.title AS job_title,
  CAST(julianday(t.date_to) - julianday(t.date_from) + 1 AS INTEGER) AS days
FROM trip t
LEFT JOIN codelist c ON c.id = t.car_id
LEFT JOIN job j ON j.id = t.job_id;

CREATE VIEW v_refuel AS
SELECT r.*, c.label AS car,
  CASE WHEN r.ledger_entry_id IS NULL THEN NULL ELSE (SELECT code FROM v_ledger_entry WHERE id = r.ledger_entry_id) END AS ledger_code
FROM refuel r
LEFT JOIN codelist c ON c.id = r.car_id;

CREATE VIEW v_todo AS
SELECT t.*, r.name AS rule_name,
  (SELECT json_group_array(json_object('entity_type', l.entity_type, 'entity_id', l.entity_id, 'label',
     CASE l.entity_type
       WHEN 'job' THEN (SELECT title FROM job WHERE id = l.entity_id)
       WHEN 'person' THEN (SELECT name FROM person WHERE id = l.entity_id)
       WHEN 'ledger_entry' THEN (SELECT code || ' ' || title FROM v_ledger_entry WHERE id = l.entity_id)
       WHEN 'invoice' THEN (SELECT 'Faktúra ' || seq || '/' || year FROM invoice WHERE id = l.entity_id)
       WHEN 'inspection' THEN (SELECT 'Obhliadka ' || COALESCE(scheduled_at, '') FROM inspection WHERE id = l.entity_id)
       WHEN 'quote' THEN (SELECT 'Ponuka ' || created_on FROM quote WHERE id = l.entity_id)
       WHEN 'attendance' THEN (SELECT 'Dochádzka ' || realized_on FROM attendance WHERE id = l.entity_id)
       ELSE l.entity_type || ' #' || l.entity_id END))
   FROM todo_link l WHERE l.todo_id = t.id) AS links
FROM todo t
LEFT JOIN notification_rule r ON r.id = t.rule_id;
