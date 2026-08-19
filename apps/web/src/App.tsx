import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import { DashboardPage } from "./pages/DashboardPage";
import { ImportPage } from "./pages/ImportPage";
import { MaterialsPage } from "./pages/MaterialsPage";
import { ResourcePage } from "./pages/ResourcePage";
import { SettingsPage } from "./pages/SettingsPage";
import { WhatsAppPage } from "./pages/WhatsAppPage";
import { GroqPage } from "./pages/GroqPage";
import { ConversationsPage } from "./pages/ConversationsPage";
import { KnowledgePage } from "./pages/KnowledgePage";
import { AppointmentsPage } from "./pages/AppointmentsPage";
import { HealthPage } from "./pages/HealthPage";
import { LogsPage } from "./pages/LogsPage";
import { TakeoverPage } from "./pages/TakeoverPage";
import { WolfPage } from "./pages/WolfPage";
import type { PageKey } from "@renova123/shared";
import { ProtectedRoute } from "./auth";
import { LoginPage } from "./pages/LoginPage";
import { FlowPage } from "./pages/FlowPage";

const resourceRoutes: Array<[string, PageKey]> = [
  ["leads", "leads"], ["lotes", "batches"], ["fila", "queue"],
  ["interessados", "interested"], ["qualificados", "qualified"], ["nao-responderam", "unanswered"],
  ["follow-ups", "followups"], ["perdidos", "lost"],
  ["opt-outs", "optouts"], ["mensagens-iniciais", "openers"],
];

export function App() {
  return <Routes>
    <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
      <Route index element={<Navigate to="/dashboard" replace />} />
      <Route path="dashboard" element={<DashboardPage />} />
      <Route path="conversations" element={<ConversationsPage />} />
      <Route path="leads" element={<ResourcePage pageKey="leads" />} />
      <Route path="settings" element={<SettingsPage pageKey="settings" section="general" />} />
      <Route path="fluxo" element={<FlowPage />} />
      <Route path="the-wolf" element={<WolfPage />} />
      <Route path="importacoes" element={<ImportPage />} />
      <Route path="conversas" element={<ConversationsPage />} />
      <Route path="materiais" element={<MaterialsPage />} />
      <Route path="base-conhecimento" element={<KnowledgePage />} />
      <Route path="demonstracoes" element={<AppointmentsPage />} />
      <Route path="saude" element={<HealthPage />} />
      <Route path="logs" element={<LogsPage />} />
      <Route path="transferencias" element={<TakeoverPage />} />
      <Route path="integracoes/whatsapp" element={<WhatsAppPage />} />
      <Route path="mente-da-ia" element={<SettingsPage pageKey="mind" section="mind" />} />
      <Route path="horarios-limites" element={<SettingsPage pageKey="schedule" section="outreach" />} />
      <Route path="integracoes/groq" element={<GroqPage />} />
      <Route path="configuracoes" element={<SettingsPage pageKey="settings" section="general" />} />
      {resourceRoutes.map(([path, key]) => <Route key={path} path={path} element={<ResourcePage pageKey={key} />} />)}
    </Route>
    <Route path="/login" element={<LoginPage />} />
    <Route path="*" element={<Navigate to="/dashboard" replace />} />
  </Routes>;
}
