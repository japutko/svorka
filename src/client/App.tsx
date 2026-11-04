import { useEffect, useState } from "react";
import { Badge, Card, Container, Group, List, Text, Title } from "@mantine/core";

type Health = { ok: boolean; tables: string[] };

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => (r.ok ? (r.json() as Promise<Health>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setHealth)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <Container size="sm" py="xl">
      <Title order={1}>Svorka</Title>
      <Text c="dimmed" mb="lg">
        Evidencia zákaziek, financií, dochádzky a jázd
      </Text>
      <Card withBorder>
        <Group justify="space-between" mb="sm">
          <Text fw={600}>Stav systému</Text>
          {health?.ok && <Badge color="green">API + databáza OK</Badge>}
          {error && <Badge color="red">Chyba</Badge>}
          {!health && !error && <Badge color="gray">Načítavam…</Badge>}
        </Group>
        {error && <Text c="red">{error}</Text>}
        {health && (
          <>
            <Text size="sm" mb={4}>Tabuľky v databáze:</Text>
            <List size="sm">
              {health.tables.map((t) => (
                <List.Item key={t}>{t}</List.Item>
              ))}
            </List>
          </>
        )}
      </Card>
    </Container>
  );
}
