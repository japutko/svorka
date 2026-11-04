import { useState } from "react";
import { Button, Divider, Paper, SegmentedControl, Stack, Text } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import { useList } from "../api";
import { TodoItem } from "../components/Todos";
import { useForms } from "../forms/FormsProvider";
import { todayIso } from "../format";
import { PageHeader } from "./ListPages";

export function TodoPage() {
  const { openForm } = useForms();
  const [show, setShow] = useState("open");
  const list = useList("todo", show === "open" ? { done: 0 } : undefined);
  const rows = list.data ?? [];
  const today = todayIso();
  const sections =
    show === "open"
      ? [
          ["Po termíne a dnes", rows.filter((t) => t.due_on && t.due_on <= today)],
          ["Naplánované", rows.filter((t) => t.due_on && t.due_on > today)],
          ["Bez termínu", rows.filter((t) => !t.due_on)],
        ]
      : [
          ["Otvorené", rows.filter((t) => !t.done)],
          ["Hotové", rows.filter((t) => t.done).sort((a, b) => (b.closed_at ?? "").localeCompare(a.closed_at ?? ""))],
        ];
  return (
    <Stack>
      <PageHeader title="Todo">
        <SegmentedControl
          size="xs"
          value={show}
          onChange={setShow}
          data={[
            { label: "Otvorené", value: "open" },
            { label: "Všetky", value: "all" },
          ]}
        />
        <Button size="sm" leftSection={<IconPlus size={16} />} onClick={() => openForm("todo")}>
          Nové todo
        </Button>
      </PageHeader>
      {(sections as [string, typeof rows][]).map(([title, items]) =>
        items.length ? (
          <Paper key={title} withBorder p="sm">
            <Text fw={700} size="sm" mb="xs">
              {title} ({items.length})
            </Text>
            <Stack gap="xs">
              {items.map((t, i) => (
                <div key={t.id}>
                  {i > 0 && <Divider mb="xs" />}
                  <TodoItem t={t} />
                </div>
              ))}
            </Stack>
          </Paper>
        ) : null
      )}
      {!rows.length && !list.isLoading && <Text c="dimmed">Nič na práci 🎉</Text>}
    </Stack>
  );
}
