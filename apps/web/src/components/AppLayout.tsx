import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Bell, LogOut, Menu, Moon, PauseCircle, PlayCircle, Sun, X } from "lucide-react";
import {
  AppShell,
  ConfirmDialog,
  Sidebar,
  SidebarItem,
  Toast,
  ToastViewport,
} from "@renova123/ui";
import { api } from "../api";
import { navigation } from "../navigation";
import { useAuth } from "../auth";

type Theme = "light" | "dark";

export function AppLayout() {
  const [theme, setTheme] = useState<Theme>(() => localStorage.getItem("renova-theme") === "dark" ? "dark" : "light");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isFranciscoOn, setIsFranciscoOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"on" | "off" | null>(null);
  const [toast, setToast] = useState("");
  const [notifications, setNotifications] = useState<Array<{ id: string; title: string; body: string; level: string; readAt?: string | null }>>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const location = useLocation();
  const { session, signOut } = useAuth();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("renova-theme", theme);
  }, [theme]);
  useEffect(() => setMobileOpen(false), [location.pathname]);
  useEffect(() => { api<Record<string, unknown>>("/settings/general").then((settings) => setIsFranciscoOn(settings.automationEnabled !== false)).catch(() => undefined); }, []);
  useEffect(() => { api<{ rows: typeof notifications }>("/notifications?page=1&pageSize=20").then((result) => setNotifications(result.rows)).catch(() => undefined); }, [location.pathname]);

  async function applyAutomation(next: boolean) {
    setBusy(true);
    try {
      const result = await api<{ automationEnabled: boolean }>("/system/pause", { method: "POST", body: JSON.stringify({ paused: !next }) });
      setIsFranciscoOn(result.automationEnabled);
      setConfirmAction(null);
      setToast(result.automationEnabled ? "Francisco ligado. Operação automática iniciada." : "Francisco desligado. Novos automáticos pausados.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Falha ao alterar a parada geral.");
    } finally {
      setBusy(false);
    }
  }

  function toggleFrancisco() {
    setConfirmAction(isFranciscoOn ? "off" : "on");
  }

  function toggleTheme() { setTheme((current) => current === "dark" ? "light" : "dark"); }

  const sidebar = <>
    {mobileOpen ? <button className="sidebar-backdrop" aria-label="Fechar menu" onClick={() => setMobileOpen(false)} /> : null}
    <Sidebar open={mobileOpen} onClose={() => setMobileOpen(false)} className="sidebar">
      <button className="mobile-close" aria-label="Fechar menu" onClick={() => setMobileOpen(false)}><X /></button>
      <div className="brand brand--compact"><img src="/brand/renova123-mark.svg" alt="" /></div>
      <div className="brand brand--full"><img src="/brand/renova123-mark.svg" alt="Renova123" /><strong>Renova123</strong></div>
      <nav className="sidebar-nav">
        {[...new Set(navigation.map((item) => item.group))].map((group) => <div className="nav-group" key={group}>
          <p>{group}</p>
          {navigation.filter((item) => item.group === group).map((item) => {
            const Icon = item.icon;
            const active = item.path === "/dashboard" ? location.pathname === item.path : location.pathname.startsWith(item.path);
            return <SidebarItem
              key={item.path}
              icon={<Icon />}
              label={item.label}
              active={active}
              renderLink={(content, className) => <NavLink to={item.path} title={item.label} className={className}>{content}</NavLink>}
            />;
          })}
        </div>)}
      </nav>
    </Sidebar>
  </>;

  return <AppShell sidebar={sidebar} className="app-shell">
    <button className="mobile-menu-button" aria-label="Abrir menu" onClick={() => setMobileOpen(true)}><Menu /></button>
    <div className="workspace">
      <header className="topbar">
        <div className="topbar-actions">
          <div className="notification-center"><button className="icon-button" aria-label="Notificações" aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen((current) => !current)}><Bell />{notifications.some((item) => !item.readAt) ? <i /> : null}</button>{notificationsOpen ? <aside className="notification-popover"><header><strong>Notificações</strong><span>{notifications.filter((item) => !item.readAt).length} não lidas</span></header>{notifications.length ? notifications.map((item) => <button key={item.id} onClick={() => { void api(`/notifications/${item.id}/read`, { method: "PATCH" }).then(() => setNotifications((current) => current.map((entry) => entry.id === item.id ? { ...entry, readAt: new Date().toISOString() } : entry))); }}><i className={item.level} /><span><strong>{item.title}</strong><small>{item.body}</small></span></button>) : <p>Nenhum alerta operacional.</p>}</aside> : null}</div>
          <button className="icon-button" aria-label={theme === "dark" ? "Ativar tema claro" : "Ativar tema escuro"} onClick={toggleTheme}>{theme === "dark" ? <Sun /> : <Moon />}</button>
          <button className="user-menu-auth" aria-label="Sair" title={session?.user.email ?? "Administrador"} onClick={() => void signOut()}><span>{session?.user.email?.slice(0, 1).toUpperCase() ?? "A"}</span><LogOut /></button>
          <button aria-label={isFranciscoOn ? "Desligar Francisco" : "Ligar Francisco"} className={`pause-button ${isFranciscoOn ? "on" : "resume"}`} disabled={busy} onClick={toggleFrancisco}>{isFranciscoOn ? <PauseCircle /> : <PlayCircle />}<span>{isFranciscoOn ? "DESLIGAR" : "LIGAR"}</span></button>
        </div>
      </header>
      <main className="main-content"><Outlet /></main>
    </div>
    <ConfirmDialog
      open={confirmAction !== null}
      title={confirmAction === "on" ? "Ligar Francisco?" : "Desligar Francisco?"}
      description={confirmAction === "on" ? "Ao ligar, Francisco poderá iniciar os disparos programados, responder conversas, executar follow-ups e qualificar leads automaticamente." : "Novas abordagens, follow-ups e respostas automáticas ficarão pausadas até você ligar novamente."}
      confirmLabel={confirmAction === "on" ? "Ligar Francisco" : "Desligar Francisco"}
      danger={confirmAction === "off"}
      onConfirm={() => void applyAutomation(confirmAction === "on")}
      onClose={() => setConfirmAction(null)}
    />
    {toast ? <ToastViewport><Toast message={toast} tone={toast.startsWith("Falha") ? "danger" : "positive"} onClose={() => setToast("")} /></ToastViewport> : null}
  </AppShell>;
}
