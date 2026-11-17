-- Jobs get a visible number, one series per year: Z26-001 (same pattern as ledger entries, U26-001)
ALTER TABLE job ADD COLUMN year INTEGER;
ALTER TABLE job ADD COLUMN seq INTEGER;

-- Existing jobs are numbered in the order they were created
UPDATE job SET year = CAST(substr(created_at, 1, 4) AS INTEGER);
UPDATE job SET seq = (
  SELECT COUNT(*) FROM job j2
  WHERE j2.year = job.year AND (j2.created_at < job.created_at OR (j2.created_at = job.created_at AND j2.id <= job.id))
);
CREATE UNIQUE INDEX idx_job_number ON job(year, seq);

-- The view lists j.* columns at creation time, so it is rebuilt to pick up the new ones
DROP VIEW v_job;

CREATE VIEW v_job AS
SELECT j.*,
  'Z' || substr(CAST(j.year AS TEXT), 3) || '-' || printf('%03d', j.seq) AS code,
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
