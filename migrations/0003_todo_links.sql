-- Todos can link to trips and refuels too
DROP VIEW v_todo;

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
       WHEN 'trip' THEN (SELECT 'Jazda ' || date_from || COALESCE(' · ' || printf('%g', km) || ' km', '') FROM trip WHERE id = l.entity_id)
       WHEN 'refuel' THEN (SELECT 'Tankovanie ' || realized_on FROM refuel WHERE id = l.entity_id)
       ELSE l.entity_type || ' #' || l.entity_id END))
   FROM todo_link l WHERE l.todo_id = t.id) AS links
FROM todo t
LEFT JOIN notification_rule r ON r.id = t.rule_id;
