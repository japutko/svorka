import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ActionIcon, Badge, Box, Button, Checkbox, Group, Menu, MultiSelect, NumberInput, Paper, Popover, ScrollArea,
  SegmentedControl, Select, Stack, Table, Text, TextInput, Tooltip, UnstyledButton,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { useQuery } from "@tanstack/react-query";
import {
  IconArrowDown, IconArrowUp, IconColumns, IconDeviceFloppy, IconFilter, IconLayoutList, IconSearch, IconStar, IconTrash, IconX,
} from "@tabler/icons-react";
import { api, notifyError, queryClient, useCodelists, useFieldDefs, type Row } from "../api";
import { fmtDate, fmtMoney, fmtNum, norm } from "../format";
import { DateField } from "./inputs";

export type ColType = "text" | "number" | "money" | "date" | "bool" | "enum";

export type Column = {
  key: string;
  label: string;
  type?: ColType;
  get?: (r: Row) => unknown; // value used for sorting, filtering and grouping
  render?: (r: Row) => ReactNode;
  hidden?: boolean; // hidden by default
  sum?: boolean; // show totals in group headers / footer
  mobile?: "title" | "sub" | "meta" | false;
  width?: number | string;
};

type Filter = { values?: string[]; text?: string; min?: number | null; max?: number | null; from?: string | null; to?: string | null; bool?: string };

export type TableState = {
  search: string;
  filters: Record<string, Filter>;
  sort: { key: string; dir: "asc" | "desc" }[];
  groupBy: string | null;
  hidden: string[] | null; // null = column defaults
};

type SavedView = { id: number; name: string; state: TableState; is_default: number };

const emptyState: TableState = { search: "", filters: {}, sort: [], groupBy: null, hidden: null };

const valueOf = (c: Column, r: Row) => (c.get ? c.get(r) : r[c.key]);

function display(c: Column, r: Row): ReactNode {
  if (c.render) return c.render(r);
  const v = valueOf(c, r);
  switch (c.type) {
    case "money":
      return fmtMoney(v as number);
    case "number":
      return fmtNum(v as number, 2);
    case "date":
      return fmtDate(v as string);
    case "bool":
      return v ? "áno" : "";
    default:
      return v == null ? "" : String(v);
  }
}

function isActive(f?: Filter) {
  return !!f && (!!f.values?.length || !!f.text || f.min != null || f.max != null || !!f.from || !!f.to || !!f.bool);
}

function matches(c: Column, f: Filter, r: Row) {
  const v = valueOf(c, r);
  if (f.values?.length && !f.values.includes(v == null || v === "" ? "—" : String(v))) return false;
  if (f.text && !norm(v).includes(norm(f.text))) return false;
  if (f.min != null && !(Number(v) >= f.min)) return false;
  if (f.max != null && !(Number(v) <= f.max)) return false;
  if (f.from && !(String(v ?? "") >= f.from)) return false;
  if (f.to && !(String(v ?? "").slice(0, 10) <= f.to)) return false;
  if (f.bool === "yes" && !v) return false;
  if (f.bool === "no" && v) return false;
  return true;
}

function compare(a: unknown, b: unknown) {
  if (a == null || a === "") return b == null || b === "" ? 0 : 1;
  if (b == null || b === "") return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "sk", { numeric: true });
}

function FilterControl({ c, rows, f, set }: { c: Column; rows: Row[]; f: Filter; set: (f: Filter) => void }) {
  const t = c.type ?? "text";
  if (t === "enum") {
    const opts = [...new Set(rows.map((r) => valueOf(c, r)).map((v) => (v == null || v === "" ? "—" : String(v))))].sort((a, b) =>
      a.localeCompare(b, "sk")
    );
    return <MultiSelect label={c.label} data={opts} value={f.values ?? []} onChange={(values) => set({ values })} clearable searchable size="xs" comboboxProps={{ withinPortal: false }} />;
  }
  if (t === "bool")
    return (
      <Box>
        <Text size="xs" fw={500}>
          {c.label}
        </Text>
        <SegmentedControl
          size="xs"
          value={f.bool ?? ""}
          onChange={(bool) => set({ bool })}
          data={[
            { label: "všetko", value: "" },
            { label: "áno", value: "yes" },
            { label: "nie", value: "no" },
          ]}
        />
      </Box>
    );
  if (t === "number" || t === "money")
    return (
      <Group grow gap="xs">
        <NumberInput size="xs" label={`${c.label} od`} value={f.min ?? ""} onChange={(v) => set({ ...f, min: v === "" ? null : Number(v) })} />
        <NumberInput size="xs" label="do" value={f.max ?? ""} onChange={(v) => set({ ...f, max: v === "" ? null : Number(v) })} />
      </Group>
    );
  if (t === "date")
    return (
      <Group grow gap="xs">
        <DateField label={`${c.label} od`} value={f.from} onChange={(from) => set({ ...f, from })} />
        <DateField label="do" value={f.to} onChange={(to) => set({ ...f, to })} />
      </Group>
    );
  return <TextInput size="xs" label={c.label} value={f.text ?? ""} onChange={(e) => set({ text: e.currentTarget.value })} />;
}

export function DataTable(props: {
  viewKey: string; // saved views and custom fields belong to this entity
  rows: Row[] | undefined;
  columns: Column[];
  defaultState?: Partial<TableState>;
  onRowClick?: (r: Row) => void;
  rowStyle?: (r: Row) => React.CSSProperties | undefined;
  toolbar?: ReactNode;
  loading?: boolean;
  compact?: boolean; // embedded lists: no saved views
}) {
  const isMobile = useMediaQuery("(max-width: 48em)");
  const fieldDefs = useFieldDefs(props.viewKey);
  const codelists = useCodelists();
  const lsKey = `svorka.table.${props.viewKey}${props.compact ? ".compact" : ""}`;

  // User-defined fields become extra columns automatically
  const columns = useMemo<Column[]>(() => {
    const cl = new Map((codelists.data ?? []).map((c) => [c.id, c.label]));
    const extra: Column[] = fieldDefs.map((d) => ({
      key: `cf.${d.key}`,
      label: d.label,
      type: d.data_type === "number" ? "number" : d.data_type === "date" ? "date" : d.data_type === "boolean" ? "bool" : d.data_type === "codelist" ? "enum" : "text",
      get: (r: Row) => {
        const v = r.custom_fields?.[d.key];
        return d.data_type === "codelist" ? (v ? cl.get(v) : null) : v;
      },
      hidden: true,
    }));
    return [...props.columns, ...extra];
  }, [props.columns, fieldDefs, codelists.data]);

  const views = useQuery({
    queryKey: ["views", props.viewKey],
    queryFn: () => api<SavedView[]>(`/admin/views?entity_type=${props.viewKey}`),
    enabled: !props.compact,
  });
  const [viewId, setViewId] = useState<number | null>(null);
  const [state, setState] = useState<TableState>(() => {
    try {
      const saved = localStorage.getItem(lsKey);
      if (saved) return { ...emptyState, ...JSON.parse(saved) };
    } catch {
      /* storage unavailable */
    }
    return { ...emptyState, ...props.defaultState };
  });
  const [limit, setLimit] = useState(200);

  // First visit: apply the default saved view if there is one
  useEffect(() => {
    if (!views.data || viewId !== null) return;
    let hasLocal = false;
    try {
      hasLocal = !!localStorage.getItem(lsKey);
    } catch {
      /* ignore */
    }
    const def = views.data.find((v) => v.is_default);
    if (def && !hasLocal) {
      setState({ ...emptyState, ...def.state });
      setViewId(def.id);
    }
  }, [views.data]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try {
      localStorage.setItem(lsKey, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [state, lsKey]);

  const visible = columns.filter((c) => (state.hidden ? !state.hidden.includes(c.key) : !c.hidden));

  const processed = useMemo(() => {
    let rows = props.rows ?? [];
    for (const [k, f] of Object.entries(state.filters)) {
      const c = columns.find((x) => x.key === k);
      if (c && isActive(f)) rows = rows.filter((r) => matches(c, f, r));
    }
    if (state.search) {
      const words = norm(state.search).split(/\s+/).filter(Boolean);
      rows = rows.filter((r) => {
        const hay = norm(columns.map((c) => valueOf(c, r)).join(" "));
        return words.every((w) => hay.includes(w));
      });
    }
    if (state.sort.length) {
      rows = [...rows].sort((a, b) => {
        for (const s of state.sort) {
          const c = columns.find((x) => x.key === s.key);
          if (!c) continue;
          const d = compare(valueOf(c, a), valueOf(c, b));
          if (d) return s.dir === "asc" ? d : -d;
        }
        return 0;
      });
    }
    return rows;
  }, [props.rows, state, columns]);

  const groups = useMemo(() => {
    const gc = columns.find((c) => c.key === state.groupBy);
    if (!gc) return null;
    const m = new Map<string, Row[]>();
    for (const r of processed) {
      const v = valueOf(gc, r);
      const k = gc.type === "date" ? fmtDate(v as string) || "—" : v == null || v === "" ? "—" : gc.type === "bool" ? (v ? "áno" : "nie") : String(v);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    return [...m.entries()];
  }, [processed, state.groupBy, columns]);

  const sums = (rows: Row[]) =>
    visible
      .filter((c) => c.sum)
      .map((c) => ({ c, total: rows.reduce((a, r) => a + (Number(valueOf(c, r)) || 0), 0) }));

  const toggleSort = (key: string, add: boolean) => {
    setState((s) => {
      const cur = s.sort.find((x) => x.key === key);
      const rest = add ? s.sort.filter((x) => x.key !== key) : [];
      if (!cur) return { ...s, sort: [...rest, { key, dir: "asc" }] };
      if (cur.dir === "asc") return { ...s, sort: [...rest, { key, dir: "desc" }] };
      return { ...s, sort: rest };
    });
  };

  const activeFilters = Object.entries(state.filters).filter(([, f]) => isActive(f));

  const saveView = async (asNew: boolean) => {
    try {
      if (!asNew && viewId) {
        await api(`/admin/views/${viewId}`, { method: "PATCH", json: { state } });
      } else {
        const name = prompt("Názov zobrazenia");
        if (!name) return;
        const v = await api<SavedView>("/admin/views", { method: "POST", json: { entity_type: props.viewKey, name, state } });
        setViewId(v.id);
      }
      queryClient.invalidateQueries({ queryKey: ["views", props.viewKey] });
    } catch (e) {
      notifyError(e);
    }
  };

  const toolbar = (
    <Group gap="xs" wrap="wrap">
      <TextInput
        placeholder="Hľadať…"
        leftSection={<IconSearch size={16} />}
        value={state.search}
        onChange={(e) => setState({ ...state, search: e.currentTarget.value })}
        rightSection={state.search ? <IconX size={14} style={{ cursor: "pointer" }} onClick={() => setState({ ...state, search: "" })} /> : null}
        style={{ flex: "1 1 180px", maxWidth: 320 }}
        size="sm"
      />
      <Popover width={320} position="bottom-start" shadow="md" trapFocus={false}>
        <Popover.Target>
          <Button size="sm" variant={activeFilters.length ? "filled" : "default"} leftSection={<IconFilter size={16} />}>
            Filter{activeFilters.length ? ` (${activeFilters.length})` : ""}
          </Button>
        </Popover.Target>
        <Popover.Dropdown>
          <ScrollArea.Autosize mah={420}>
            <Stack gap="xs">
              {columns
                .filter((c) => !c.render || c.get || c.type)
                .map((c) => (
                  <FilterControl
                    key={c.key}
                    c={c}
                    rows={props.rows ?? []}
                    f={state.filters[c.key] ?? {}}
                    set={(f) => setState({ ...state, filters: { ...state.filters, [c.key]: f } })}
                  />
                ))}
              <Button size="xs" variant="subtle" onClick={() => setState({ ...state, filters: {} })}>
                Zrušiť filtre
              </Button>
            </Stack>
          </ScrollArea.Autosize>
        </Popover.Dropdown>
      </Popover>
      <Select
        size="sm"
        placeholder="Zoskupiť"
        leftSection={<IconLayoutList size={16} />}
        clearable
        data={columns.filter((c) => c.type === "enum" || c.type === "bool" || c.type === "date" || c.type === "text").map((c) => ({ value: c.key, label: c.label }))}
        value={state.groupBy}
        onChange={(groupBy) => setState({ ...state, groupBy })}
        w={160}
      />
      {isMobile && (
        <Select
          size="sm"
          placeholder="Zoradiť"
          clearable
          w={150}
          data={columns.flatMap((c) => [
            { value: `${c.key}:asc`, label: `${c.label} ↑` },
            { value: `${c.key}:desc`, label: `${c.label} ↓` },
          ])}
          value={state.sort[0] ? `${state.sort[0].key}:${state.sort[0].dir}` : null}
          onChange={(v) => {
            if (!v) return setState({ ...state, sort: [] });
            const i = v.lastIndexOf(":");
            setState({ ...state, sort: [{ key: v.slice(0, i), dir: v.slice(i + 1) as "asc" | "desc" }] });
          }}
        />
      )}
      {!isMobile && (
        <Menu closeOnItemClick={false} withinPortal>
          <Menu.Target>
            <Tooltip label="Stĺpce">
              <ActionIcon variant="default" size="lg">
                <IconColumns size={16} />
              </ActionIcon>
            </Tooltip>
          </Menu.Target>
          <Menu.Dropdown>
            {columns.map((c) => (
              <Menu.Item key={c.key}>
                <Checkbox
                  size="xs"
                  label={c.label}
                  checked={visible.includes(c)}
                  onChange={(e) => {
                    const hidden = columns.filter((x) => !visible.includes(x)).map((x) => x.key);
                    setState({ ...state, hidden: e.currentTarget.checked ? hidden.filter((k) => k !== c.key) : [...hidden, c.key] });
                  }}
                />
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      )}
      {!props.compact && (
        <Menu withinPortal>
          <Menu.Target>
            <Button size="sm" variant="default" leftSection={<IconDeviceFloppy size={16} />}>
              {views.data?.find((v) => v.id === viewId)?.name ?? "Zobrazenia"}
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            {views.data?.map((v) => (
              <Menu.Item
                key={v.id}
                leftSection={v.is_default ? <IconStar size={14} /> : <span style={{ width: 14 }} />}
                onClick={() => {
                  setState({ ...emptyState, ...v.state });
                  setViewId(v.id);
                }}
              >
                {v.name}
              </Menu.Item>
            ))}
            <Menu.Item
              onClick={() => {
                setState({ ...emptyState, ...props.defaultState });
                setViewId(null);
              }}
            >
              Predvolené
            </Menu.Item>
            <Menu.Divider />
            {viewId && <Menu.Item onClick={() => saveView(false)}>Uložiť zmeny do „{views.data?.find((v) => v.id === viewId)?.name}“</Menu.Item>}
            <Menu.Item onClick={() => saveView(true)}>Uložiť ako nové…</Menu.Item>
            {viewId && (
              <>
                <Menu.Item
                  leftSection={<IconStar size={14} />}
                  onClick={async () => {
                    await api(`/admin/views/${viewId}`, { method: "PATCH", json: { is_default: true } });
                    queryClient.invalidateQueries({ queryKey: ["views", props.viewKey] });
                  }}
                >
                  Nastaviť ako predvolené
                </Menu.Item>
                <Menu.Item
                  color="red"
                  leftSection={<IconTrash size={14} />}
                  onClick={async () => {
                    if (!confirm("Zmazať zobrazenie?")) return;
                    await api(`/admin/views/${viewId}`, { method: "DELETE" });
                    setViewId(null);
                    queryClient.invalidateQueries({ queryKey: ["views", props.viewKey] });
                  }}
                >
                  Zmazať zobrazenie
                </Menu.Item>
              </>
            )}
          </Menu.Dropdown>
        </Menu>
      )}
      <Box style={{ flex: 1 }} />
      {props.toolbar}
    </Group>
  );

  const chips = activeFilters.length > 0 && (
    <Group gap={4}>
      {activeFilters.map(([k, f]) => {
        const c = columns.find((x) => x.key === k);
        const desc = f.values?.join(", ") ?? f.text ?? (f.bool ? (f.bool === "yes" ? "áno" : "nie") : [f.min ?? f.from, f.max ?? f.to].map((x) => x ?? "…").join(" – "));
        return (
          <Badge
            key={k}
            variant="light"
            rightSection={<IconX size={10} style={{ cursor: "pointer" }} onClick={() => setState({ ...state, filters: { ...state.filters, [k]: {} } })} />}
          >
            {c?.label}: {desc}
          </Badge>
        );
      })}
    </Group>
  );

  const rowsOut = (rows: Row[]) =>
    rows.slice(0, limit).map((r) =>
      isMobile ? (
        <Paper
          key={r.id}
          withBorder
          p="sm"
          mb={6}
          style={{ cursor: props.onRowClick ? "pointer" : undefined, ...props.rowStyle?.(r) }}
          onClick={() => props.onRowClick?.(r)}
        >
          <Group justify="space-between" wrap="nowrap" align="flex-start">
            <Text fw={600} size="sm" lineClamp={2}>
              {visible.filter((c) => c.mobile === "title").map((c) => <Fragment key={c.key}>{display(c, r)} </Fragment>)}
            </Text>
            <Group gap={4} wrap="nowrap">
              {visible.filter((c) => c.mobile === "meta").map((c) => <Fragment key={c.key}>{display(c, r)}</Fragment>)}
            </Group>
          </Group>
          {visible
            .filter((c) => c.mobile === "sub")
            .map((c) => {
              const d = display(c, r);
              return d === "" || d == null ? null : (
                <Text key={c.key} size="xs" c="dimmed" component="div" lineClamp={2}>
                  {d}
                </Text>
              );
            })}
        </Paper>
      ) : (
        <Table.Tr key={r.id} style={{ cursor: props.onRowClick ? "pointer" : undefined, ...props.rowStyle?.(r) }} onClick={() => props.onRowClick?.(r)}>
          {visible.map((c) => (
            <Table.Td key={c.key} style={{ textAlign: c.type === "money" || c.type === "number" ? "right" : undefined, whiteSpace: c.type === "money" || c.type === "date" ? "nowrap" : undefined }}>
              {display(c, r)}
            </Table.Td>
          ))}
        </Table.Tr>
      )
    );

  const groupHeader = (label: string, rows: Row[]) => {
    const s = sums(rows);
    const text = (
      <Group gap="xs">
        <Text fw={700} size="sm">
          {label}
        </Text>
        <Badge size="sm" variant="light" color="gray">
          {rows.length}
        </Badge>
        {s.map(({ c, total }) => (
          <Text key={c.key} size="xs" c="dimmed">
            {c.label}: {c.type === "money" ? fmtMoney(total) : fmtNum(total, 2)}
          </Text>
        ))}
      </Group>
    );
    return isMobile ? (
      <Box key={`g-${label}`} mt="sm" mb={4}>
        {text}
      </Box>
    ) : (
      <Table.Tr key={`g-${label}`} bg="var(--mantine-color-default-hover)">
        <Table.Td colSpan={visible.length}>{text}</Table.Td>
      </Table.Tr>
    );
  };

  const body = groups ? groups.flatMap(([label, rows]) => [groupHeader(label, rows), ...rowsOut(rows)]) : rowsOut(processed);
  const totals = sums(processed);

  return (
    <Stack gap="xs">
      {toolbar}
      {chips}
      {props.loading && !props.rows ? (
        <Text c="dimmed" size="sm">
          Načítavam…
        </Text>
      ) : isMobile ? (
        <Box>{body}</Box>
      ) : (
        <ScrollArea>
          <Table striped={false} highlightOnHover verticalSpacing={props.compact ? 4 : 6} fz="sm" stickyHeader>
            <Table.Thead>
              <Table.Tr>
                {visible.map((c) => {
                  const s = state.sort.find((x) => x.key === c.key);
                  return (
                    <Table.Th key={c.key} style={{ width: c.width, whiteSpace: "nowrap" }}>
                      <UnstyledButton onClick={(e) => toggleSort(c.key, e.shiftKey)} title="Klik = zoradiť, Shift+klik = ďalšie zoradenie">
                        <Group gap={2} wrap="nowrap">
                          <Text fw={600} size="sm">
                            {c.label}
                          </Text>
                          {s && (s.dir === "asc" ? <IconArrowUp size={12} /> : <IconArrowDown size={12} />)}
                          {s && state.sort.length > 1 && (
                            <Text size="xs" c="dimmed">
                              {state.sort.indexOf(s) + 1}
                            </Text>
                          )}
                        </Group>
                      </UnstyledButton>
                    </Table.Th>
                  );
                })}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>{body}</Table.Tbody>
            {totals.length > 0 && processed.length > 1 && (
              <Table.Tfoot>
                <Table.Tr>
                  {visible.map((c) => {
                    const t = totals.find((x) => x.c === c);
                    return (
                      <Table.Td key={c.key} style={{ textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" }}>
                        {t ? (c.type === "money" ? fmtMoney(t.total) : fmtNum(t.total, 2)) : ""}
                      </Table.Td>
                    );
                  })}
                </Table.Tr>
              </Table.Tfoot>
            )}
          </Table>
        </ScrollArea>
      )}
      <Group justify="space-between">
        <Text size="xs" c="dimmed">
          {processed.length} {processed.length === (props.rows?.length ?? 0) ? "záznamov" : `z ${props.rows?.length ?? 0} záznamov`}
        </Text>
        {processed.length > limit && (
          <Button size="xs" variant="subtle" onClick={() => setLimit(limit + 500)}>
            Zobraziť ďalšie
          </Button>
        )}
      </Group>
    </Stack>
  );
}

// Coloured status badge from a lookup list value
export function StatusBadge({ label, color }: { label?: string | null; color?: string | null }) {
  if (!label) return null;
  return (
    <Badge color={color ?? "gray"} variant="light" size="sm" style={{ flexShrink: 0, overflow: "visible" }} styles={{ label: { overflow: "visible" } }}>
      {label}
    </Badge>
  );
}
