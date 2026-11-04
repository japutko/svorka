import { useState } from "react";
import { ActionIcon, Button, Group, Paper, Stack, Text, Textarea, Tooltip } from "@mantine/core";
import { IconTrash } from "@tabler/icons-react";
import { api, invalidateAll, useAddComment, useComments, type Comment } from "../api";
import { fmtDateTime } from "../format";

// Journal of notes, newest on top
export function CommentJournal({ entityType, entityId }: { entityType: string; entityId: number }) {
  const { data } = useComments(entityType, entityId);
  const add = useAddComment();
  const [text, setText] = useState("");
  const submit = () => {
    if (!text.trim()) return;
    add.mutate({ entity_type: entityType, entity_id: entityId, text }, { onSuccess: () => setText("") });
  };
  return (
    <Stack gap="xs">
      <Textarea
        placeholder="Nová poznámka…"
        autosize
        minRows={2}
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
      />
      <Group justify="flex-end">
        <Button size="xs" onClick={submit} loading={add.isPending} disabled={!text.trim()}>
          Pridať poznámku
        </Button>
      </Group>
      {data?.map((c) => (
        <Paper key={c.id} withBorder p="xs" radius="sm">
          <Group justify="space-between" wrap="nowrap" align="flex-start">
            <div>
              <Text size="xs" c="dimmed">
                {fmtDateTime(c.created_at)}
              </Text>
              <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                {c.text}
              </Text>
            </div>
            <Tooltip label="Zmazať">
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                onClick={async () => {
                  if (!confirm("Zmazať poznámku?")) return;
                  await api(`/admin/comments/${c.id}`, { method: "DELETE" });
                  invalidateAll();
                }}
              >
                <IconTrash size={14} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Paper>
      ))}
    </Stack>
  );
}

// Compact display for table cells: latest note + count, full list on hover
export function CommentsCell({ comments }: { comments?: Comment[] | null }) {
  const list = (comments ?? []).filter((c) => c && c.id);
  if (!list.length) return null;
  const [last] = list;
  return (
    <Tooltip
      multiline
      w={360}
      withinPortal
      label={list.slice(0, 6).map((c) => (
        <Text key={c.id} size="xs" mb={4}>
          <b>{fmtDateTime(c.created_at)}</b> {c.text}
        </Text>
      ))}
    >
      <Text size="sm" lineClamp={2}>
        <Text span size="xs" c="dimmed">
          {fmtDateTime(last.created_at).split(" ")[0]}
          {list.length > 1 ? ` (${list.length})` : ""}:{" "}
        </Text>
        {last.text}
      </Text>
    </Tooltip>
  );
}
