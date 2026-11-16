-- Records picked in linked-record fields, so the field can offer the last used ones before typing
CREATE TABLE recent_pick (
  entity_type TEXT    NOT NULL,
  entity_id   INTEGER NOT NULL,
  used_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (entity_type, entity_id)
);
CREATE INDEX idx_recent_pick_used ON recent_pick(entity_type, used_at DESC);
