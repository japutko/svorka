import { useRef, useState } from "react";
import { ActionIcon, Anchor, Badge, Button, Group, Image, Paper, SimpleGrid, Stack, Text, Tooltip } from "@mantine/core";
import { IconCamera, IconDownload, IconFile, IconTrash, IconUpload, IconX } from "@tabler/icons-react";
import { api, fileUrl, invalidateAll, notifyError, uploadFile, useFiles } from "../api";
import { fmtDateTime } from "../format";

// Shrinks a photo so a multi-page receipt PDF stays small
async function toJpeg(file: File, maxSide = 2000): Promise<Uint8Array> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), "image/jpeg", 0.82));
  return new Uint8Array(await blob.arrayBuffer());
}

// Joins photos and PDFs (in order) into one PDF document
export async function buildPdf(pages: File[]): Promise<Blob> {
  // Loaded only when a receipt is saved, keeps the app quick to open
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  for (const f of pages) {
    if (f.type === "application/pdf") {
      const src = await PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true });
      for (const p of await doc.copyPages(src, src.getPageIndices())) doc.addPage(p);
    } else {
      const img = await doc.embedJpg(await toJpeg(f));
      const page = doc.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    }
  }
  const bytes = await doc.save();
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}

function PickButtons({ onFiles, accept, camera = true }: { onFiles: (f: File[]) => void; accept?: string; camera?: boolean }) {
  const cam = useRef<HTMLInputElement>(null);
  const up = useRef<HTMLInputElement>(null);
  const take = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.currentTarget.files ?? [])];
    e.currentTarget.value = "";
    if (files.length) onFiles(files);
  };
  return (
    <Group gap="xs">
      {camera && (
        <Button size="xs" variant="light" leftSection={<IconCamera size={16} />} onClick={() => cam.current?.click()}>
          Odfotiť
        </Button>
      )}
      <Button size="xs" variant="light" leftSection={<IconUpload size={16} />} onClick={() => up.current?.click()}>
        Nahrať
      </Button>
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={take} />
      <input ref={up} type="file" accept={accept} multiple hidden onChange={take} />
    </Group>
  );
}

// Pages of a receipt (photos or PDFs), saved later as a single PDF
export function ReceiptPages({ pages, onChange }: { pages: File[]; onChange: (p: File[]) => void }) {
  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Text size="sm" fw={500} component="div">
          Účtovný doklad {pages.length > 0 && <Badge size="sm">{pages.length} str.</Badge>}
        </Text>
        <PickButtons accept="image/*,application/pdf" onFiles={(f) => onChange([...pages, ...f])} />
      </Group>
      {pages.length > 0 && (
        <SimpleGrid cols={{ base: 3, sm: 5 }} spacing="xs">
          {pages.map((p, i) => (
            <Paper key={i} withBorder p={4} pos="relative">
              {p.type.startsWith("image/") ? (
                <Image src={URL.createObjectURL(p)} h={80} fit="cover" radius="xs" />
              ) : (
                <Stack h={80} align="center" justify="center" gap={2}>
                  <IconFile />
                  <Text size="xs" lineClamp={1}>
                    {p.name}
                  </Text>
                </Stack>
              )}
              <ActionIcon size="xs" color="red" pos="absolute" top={2} right={2} onClick={() => onChange(pages.filter((_, j) => j !== i))}>
                <IconX size={12} />
              </ActionIcon>
            </Paper>
          ))}
        </SimpleGrid>
      )}
    </Stack>
  );
}

// Files attached to a record. Before the record exists, files are held in `pending`.
export function FileSection(props: {
  entityType: string;
  entityId?: number;
  role?: string;
  title?: string;
  pending?: File[];
  onPending?: (f: File[]) => void;
}) {
  const { data } = useFiles(props.entityType, props.entityId);
  const [busy, setBusy] = useState(false);
  const files = (data ?? []).filter((f) => !props.role || f.role === props.role);

  const add = async (list: File[]) => {
    if (!props.entityId) return props.onPending?.([...(props.pending ?? []), ...list]);
    setBusy(true);
    try {
      for (const f of list) await uploadFile(props.entityType, props.entityId, f, f.name, props.role);
      invalidateAll();
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Text size="sm" fw={500}>
          {props.title ?? "Dokumenty"}
        </Text>
        {busy ? <Text size="xs">Nahrávam…</Text> : <PickButtons onFiles={add} />}
      </Group>
      {props.pending?.map((f, i) => (
        <Group key={`p${i}`} gap="xs" wrap="nowrap">
          <IconFile size={16} />
          <Text size="sm" style={{ flex: 1 }} lineClamp={1}>
            {f.name}
          </Text>
          <Badge size="xs" color="gray">
            po uložení
          </Badge>
          <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => props.onPending?.(props.pending!.filter((_, j) => j !== i))}>
            <IconX size={14} />
          </ActionIcon>
        </Group>
      ))}
      {files.map((f) => (
        <Group key={f.id} gap="xs" wrap="nowrap">
          <IconFile size={16} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <Anchor href={fileUrl(f.id)} target="_blank" size="sm" lineClamp={1}>
              {f.name}
            </Anchor>
            <Text size="xs" c="dimmed" lineClamp={1}>
              {fmtDateTime(f.created_at)} · {f.path.slice(0, f.path.lastIndexOf("/"))}
            </Text>
          </div>
          <Tooltip label="Stiahnuť">
            <ActionIcon component="a" href={fileUrl(f.id, true)} size="sm" variant="subtle">
              <IconDownload size={14} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Zmazať">
            <ActionIcon
              size="sm"
              variant="subtle"
              color="red"
              onClick={async () => {
                if (!confirm(`Zmazať ${f.name}?`)) return;
                await api(`/files/${f.id}`, { method: "DELETE" }).catch(notifyError);
                invalidateAll();
              }}
            >
              <IconTrash size={14} />
            </ActionIcon>
          </Tooltip>
        </Group>
      ))}
      {!files.length && !props.pending?.length && (
        <Text size="xs" c="dimmed">
          Zatiaľ žiadne súbory
        </Text>
      )}
    </Stack>
  );
}
