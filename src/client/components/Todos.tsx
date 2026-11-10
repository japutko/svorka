import { useState } from "react";
import { Anchor, Badge, Button, Checkbox, Group, Paper, Stack, Text } from "@mantine/core";
import { Link } from "react-router";
import { notifyError, saveRecord, useList, type Row } from "../api";
import { fmtDate, todayIso } from "../format";
import { useForms } from "../forms/FormsProvider";

const linkPath: Record<string, string> = { job: "/zakazky/" };

export function TodoItem({ t }: { t: Row }) {
  const { openForm } = useForms();
  const overdue = !t.done && t.due_on && t.due_on < todayIso();
  return (
    <Group gap="xs" wrap="nowrap" align="flex-start">
      <Checkbox
        mt={2}
        checked={!!t.done}
        onChange={(e) => saveRecord("todo", { done: e.currentTarget.checked ? 1 : 0 }, t.id).catch(notifyError)}
        aria-label="Hotovo"
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text size="sm" td={t.done ? "line-through" : undefined} c={t.done ? "dimmed" : undefined} style={{ cursor: "pointer" }} onClick={() => openForm("todo", { id: t.id })}>
          {t.text}
        </Text>
        <Group gap={6}>
          {t.due_on && (
            <Text size="xs" c={overdue ? "red" : "dimmed"} fw={overdue ? 600 : undefined}>
              {fmtDate(t.due_on)}
            </Text>
          )}
          {(t.links ?? []).map((l: Row) =>
            linkPath[l.entity_type] ? (
              <Anchor key={`${l.entity_type}${l.entity_id}`} component={Link} to={`${linkPath[l.entity_type]}${l.entity_id}`} size="xs">
                {l.label}
              </Anchor>
            ) : (
              <Anchor key={`${l.entity_type}${l.entity_id}`} size="xs" onClick={() => openForm(l.entity_type, { id: l.entity_id })}>
                {l.label}
              </Anchor>
            )
          )}
          {t.rule_name && (
            <Badge size="xs" variant="outline" color="gray">
              {t.rule_name}
            </Badge>
          )}
          {t.done && t.closed_at && (
            <Text size="xs" c="dimmed">
              uzavreté {fmtDate(t.closed_at)}
            </Text>
          )}
        </Group>
      </div>
    </Group>
  );
}

// Open todos: overdue ones on the dashboard, or all linked to one record
export function TodoStrip({ entityType, entityId, overdueOnly, max = 3 }: { entityType?: string; entityId?: number; overdueOnly?: boolean; max?: number }) {
  const { data } = useList("todo", { done: 0 });
  const [expanded, setExpanded] = useState(false);
  const today = todayIso();
  let todos = data ?? [];
  if (entityType && entityId) todos = todos.filter((t) => (t.links ?? []).some((l: Row) => l.entity_type === entityType && l.entity_id === entityId));
  if (overdueOnly) todos = todos.filter((t) => t.due_on && t.due_on < today);
  if (!todos.length) return null;
  const urgent = todos.filter((t) => t.due_on && t.due_on <= today).length;
  const rest = todos.length - max;
  return (
    <Paper withBorder p="xs" radius="md" bg="var(--mantine-color-orange-light)">
      <Group justify="space-between" mb={4}>
        <Text size="sm" fw={700} component="div">
          {overdueOnly ? `Todo po termíne (${todos.length})` : "Todo"}
          {!overdueOnly && urgent > 0 && <Badge size="sm" color="red" ml={4}>{urgent} na dnes / po termíne</Badge>}
        </Text>
        <Anchor component={Link} to="/todo" size="xs">
          všetky todo
        </Anchor>
      </Group>
      <Stack gap={6}>
        {(expanded ? todos : todos.slice(0, max)).map((t) => (
          <TodoItem key={t.id} t={t} />
        ))}
      </Stack>
      {rest > 0 && (
        <Button size="compact-xs" variant="subtle" mt={4} onClick={() => setExpanded(!expanded)}>
          {expanded ? "Zobraziť menej" : `+ ďalšie (${rest})`}
        </Button>
      )}
    </Paper>
  );
}
