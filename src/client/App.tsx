import { ActionIcon, AppShell, Badge, Burger, Group, Menu, NavLink, Text, Title } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconBell, IconBriefcase, IconCar, IconCash, IconClock, IconFileText, IconGasStation, IconHome, IconListCheck, IconPlus, IconReceipt,
  IconSettings, IconUser, IconUsers,
} from "@tabler/icons-react";
import { Link, Route, Routes, useLocation } from "react-router";
import { useList } from "./api";
import { useForms } from "./forms/FormsProvider";
import { Dashboard } from "./pages/Dashboard";
import { JobDetail } from "./pages/JobDetail";
import { DocumentsPage, FinancePage, JobsPage, PersonsPage, WorkPage } from "./pages/ListPages";
import { NotificationsPage } from "./pages/NotificationsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TodoPage } from "./pages/TodoPage";

const nav = [
  { to: "/", label: "Prehľad", icon: IconHome },
  { to: "/zakazky", label: "Zákazky", icon: IconBriefcase },
  { to: "/osoby", label: "Osoby", icon: IconUsers },
  { to: "/financie", label: "Financie", icon: IconCash },
  { to: "/doklady", label: "Obhliadky, ponuky, faktúry", icon: IconFileText },
  { to: "/dochadzka", label: "Dochádzka a jazdy", icon: IconClock },
  { to: "/todo", label: "Todo", icon: IconListCheck },
  { to: "/notifikacie", label: "Notifikácie", icon: IconBell },
  { to: "/nastavenia", label: "Nastavenia", icon: IconSettings },
];

function QuickAdd() {
  const { openForm } = useForms();
  return (
    <Menu position="bottom-end" width={220}>
      <Menu.Target>
        <ActionIcon size="lg" radius="xl" aria-label="Nový záznam">
          <IconPlus size={20} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item leftSection={<IconClock size={16} />} onClick={() => openForm("attendance")}>
          Dochádzka
        </Menu.Item>
        <Menu.Item leftSection={<IconReceipt size={16} />} onClick={() => openForm("ledger_entry", { defaults: { direction: "expense" } })}>
          Nákup / výdaj
        </Menu.Item>
        <Menu.Item leftSection={<IconCash size={16} />} onClick={() => openForm("ledger_entry", { defaults: { direction: "income" } })}>
          Príjem
        </Menu.Item>
        <Menu.Item leftSection={<IconCar size={16} />} onClick={() => openForm("trip")}>
          Jazda
        </Menu.Item>
        <Menu.Item leftSection={<IconGasStation size={16} />} onClick={() => openForm("refuel")}>
          Tankovanie
        </Menu.Item>
        <Menu.Item leftSection={<IconListCheck size={16} />} onClick={() => openForm("todo")}>
          Todo
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item leftSection={<IconBriefcase size={16} />} onClick={() => openForm("job")}>
          Zákazka
        </Menu.Item>
        <Menu.Item leftSection={<IconUser size={16} />} onClick={() => openForm("person")}>
          Osoba
        </Menu.Item>
        <Menu.Item leftSection={<IconFileText size={16} />} onClick={() => openForm("inspection")}>
          Obhliadka
        </Menu.Item>
        <Menu.Item leftSection={<IconFileText size={16} />} onClick={() => openForm("quote")}>
          Cenová ponuka
        </Menu.Item>
        <Menu.Item leftSection={<IconFileText size={16} />} onClick={() => openForm("invoice")}>
          Faktúra
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

export default function App() {
  const [opened, { toggle, close }] = useDisclosure();
  const { pathname } = useLocation();
  const todos = useList("todo", { done: 0 });
  const openTodos = todos.data?.length ?? 0;

  return (
    <AppShell header={{ height: 56 }} navbar={{ width: 250, breakpoint: "sm", collapsed: { mobile: !opened } }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="xs">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Title order={3} c="orange">
              <Link to="/" style={{ color: "inherit", textDecoration: "none" }}>
                Svorka
              </Link>
            </Title>
          </Group>
          <QuickAdd />
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="xs">
        {nav.map((n) => (
          <NavLink
            key={n.to}
            component={Link}
            to={n.to}
            label={n.label}
            leftSection={<n.icon size={18} />}
            active={n.to === "/" ? pathname === "/" : pathname.startsWith(n.to)}
            onClick={close}
            rightSection={n.to === "/todo" && openTodos > 0 ? <Badge size="sm" circle={openTodos < 10}>{openTodos}</Badge> : null}
          />
        ))}
      </AppShell.Navbar>
      <AppShell.Main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/zakazky" element={<JobsPage />} />
          <Route path="/zakazky/:id" element={<JobDetail />} />
          <Route path="/osoby" element={<PersonsPage />} />
          <Route path="/financie" element={<FinancePage />} />
          <Route path="/doklady" element={<DocumentsPage />} />
          <Route path="/dochadzka" element={<WorkPage />} />
          <Route path="/todo" element={<TodoPage />} />
          <Route path="/notifikacie" element={<NotificationsPage />} />
          <Route path="/nastavenia" element={<SettingsPage />} />
          <Route path="*" element={<Text>Stránka neexistuje.</Text>} />
        </Routes>
      </AppShell.Main>
    </AppShell>
  );
}
