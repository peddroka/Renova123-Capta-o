import { Link } from "react-router-dom";
import {
  AlertTriangle, ArrowRight, Ban, Bot, CalendarCheck2, Gauge, HeartHandshake,
  Import, ListChecks, MessageCircle, PhoneCall, Settings2, UsersRound, Wifi,
  type LucideIcon,
} from "lucide-react";
import type { DashboardStats, OutreachAnalytics, OutreachHourMetric } from "@renova123/shared";
import {
  DataCard, EmptyState, ErrorState, LoadingSkeleton, MetricCard, StatusBadge,
  SystemStatusIndicator,
} from "@renova123/ui";
import { api } from "../api";
import { PageHeader } from "../components/PageHeader";
import { useAppQuery } from "../services/query-client";

type PageResult<T> = { rows: T[]; total: number };
type Health = {
  services: Record<string, string | { status: string }>;
  simulationMode: boolean;
  automationActive: boolean;
};
type LogRow = { id: string; action?: string; eventType?: string; service?: string; createdAt?: string };
type Appointment = { id: string; lead?: string; leadId?: string; company?: string; startsAt?: string; assignee?: string };
type Lead = { id: string; name?: string | null; company?: string | null; phone?: string; source?: string };
type DashboardData = {
  stats: DashboardStats;
  outreachAnalytics: OutreachAnalytics;
  health: Health;
  logs: LogRow[];
  appointments: Appointment[];
  hotLeads: Lead[];
};

type Metric = { id: string; label: string; value: string | number; note: string; icon: LucideIcon; tone?: "positive" | "warning" | "danger" | "info" };

async function loadDashboard(): Promise<DashboardData> {
  const [stats, outreachAnalytics, health, logs, appointments, hotLeads] = await Promise.all([
    api<DashboardStats>("/dashboard"),
    api<OutreachAnalytics>("/analytics/outreach-hours"),
    api<Health>("/health"),
    api<PageResult<LogRow>>("/logs?page=1&pageSize=5"),
    api<PageResult<Appointment>>("/appointments?page=1&pageSize=5"),
    api<PageResult<Lead>>("/pages/interested?page=1&pageSize=5"),
  ]);
  return { stats, outreachAnalytics, health, logs: logs.rows, appointments: appointments.rows, hotLeads: hotLeads.rows };
}

function serviceState(value: Health["services"][string]) {
  return typeof value === "string" ? value : value.status;
}

function formatDate(value?: string) {
  if (!value) return "Sem data";
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function percentage(value: number) { return `${Math.round(value * 100)}%`; }

function bestHourLabel(hour: number | null, analytics: OutreachAnalytics) {
  if (hour === null) return `Dados insuficientes (mínimo ${analytics.minimumSampleSize} contatos por horário)`;
  return `${String(hour).padStart(2, "0")}:00`;
}

function PerformanceChart({ hours }: { hours: OutreachHourMetric[] }) {
  const width = 720; const height = 190; const left = 34; const right = 12; const top = 14; const bottom = 30;
  const x = (index: number) => left + (index * (width - left - right)) / Math.max(1, hours.length - 1);
  const y = (value: number) => top + (1 - value) * (height - top - bottom);
  const points = (field: "responseRate" | "qualificationRate") => hours.map((item, index) => `${x(index)},${y(item[field])}`).join(" ");
  return <div className="performance-chart" aria-label="Gráfico de taxa de resposta e qualificação por hora">
    <svg viewBox={`0 0 ${width} ${height}`} role="img">
      <title>Taxa de resposta e taxa de qualificação por horário de primeira abordagem</title>
      {[0, 0.5, 1].map((value) => <g key={value}><line x1={left} x2={width - right} y1={y(value)} y2={y(value)} className="performance-grid-line" /><text x={2} y={y(value) + 3} className="performance-axis-label">{percentage(value)}</text></g>)}
      <polyline points={points("responseRate")} className="performance-line performance-line--response" />
      <polyline points={points("qualificationRate")} className="performance-line performance-line--qualification" />
      {hours.map((item, index) => <g key={item.hour}><circle cx={x(index)} cy={y(item.responseRate)} r="3" className="performance-dot performance-dot--response"><title>{item.label}: resposta {percentage(item.responseRate)}, {item.responded}/{item.sent}</title></circle><circle cx={x(index)} cy={y(item.qualificationRate)} r="3" className="performance-dot performance-dot--qualification"><title>{item.label}: qualificação {percentage(item.qualificationRate)}, {item.qualified}/{item.sent}</title></circle>{index % 2 === 0 ? <text x={x(index)} y={height - 8} textAnchor="middle" className="performance-axis-label">{item.label}</text> : null}</g>)}
    </svg>
    <div className="performance-legend"><span><i className="performance-key performance-key--response" />Resposta</span><span><i className="performance-key performance-key--qualification" />Qualificação</span></div>
  </div>;
}

function OutreachPerformance({ analytics }: { analytics: OutreachAnalytics }) {
  return <DataCard eyebrow="Analytics" title="Desempenho por horário" description={`Primeira abordagem em ${analytics.timezone}. Respostas são atribuídas ao horário do envio inicial.`}>
    <PerformanceChart hours={analytics.hours} />
    <div className="performance-highlights"><div><span>Melhor horário por resposta</span><strong>{bestHourLabel(analytics.bestResponseHour, analytics)}</strong></div><div><span>Melhor horário por qualificação</span><strong>{bestHourLabel(analytics.bestQualificationHour, analytics)}</strong></div><div><span>Tamanho da amostra</span><strong>{analytics.totalSample} contatos</strong></div></div>
    <div className="performance-table-wrap"><table className="performance-table"><thead><tr><th>Hora</th><th>Enviados</th><th>Responderam</th><th>Resposta</th><th>Qualificados</th><th>Qualificação</th><th>Mediana resposta</th></tr></thead><tbody>{analytics.hours.map((item) => <tr key={item.hour}><td>{item.label}</td><td>{item.sent}</td><td>{item.responded}</td><td>{percentage(item.responseRate)}</td><td>{item.qualified}</td><td>{percentage(item.qualificationRate)}</td><td>{item.medianMinutesToFirstResponse === null ? "—" : `${item.medianMinutesToFirstResponse} min`}</td></tr>)}</tbody></table></div>
  </DataCard>;
}

export function DashboardPage() {
  const { data, error, loading, reload } = useAppQuery("dashboard-real", loadDashboard);
  const stats = data?.stats;
  const metrics: Metric[] = stats ? [
    { id: "leads", label: "Leads totais", value: stats.totalLeads, note: "contatos cadastrados", icon: UsersRound },
    { id: "today", label: "Contatados hoje", value: stats.contactedToday, note: "abordagens registradas", icon: PhoneCall },
    { id: "limit", label: "Contatados hoje / limite", value: `${stats.contactedToday}/${stats.dailyLimit}`, note: "disparos proativos", icon: Gauge },
    { id: "queue", label: "Fila pendente", value: stats.queuePending, note: "tarefas aguardando", icon: ListChecks, tone: stats.queuePending ? "warning" : "positive" },
    { id: "active", label: "Conversas ativas", value: stats.activeConversations, note: "em andamento", icon: MessageCircle },
    { id: "interested", label: "Interessados", value: stats.interested, note: "oportunidades", icon: HeartHandshake },
    { id: "demos", label: "Demonstrações", value: stats.scheduledDemos, note: "agendadas", icon: CalendarCheck2 },
    { id: "handoffs", label: "Transferências", value: stats.handoffs, note: "atendimento humano", icon: Bot, tone: stats.handoffs ? "warning" : "positive" },
    { id: "optouts", label: "Opt-outs", value: stats.optOuts, note: "bloqueios ativos", icon: Ban },
    { id: "mode", label: "Modo de envio", value: stats.simulationMode ? "MOCK / BLOQUEADO" : "REAL / LIBERADO", note: stats.simulationMode ? "nenhuma mensagem real" : "autorização explícita ativa", icon: AlertTriangle, tone: stats.simulationMode ? "warning" : "positive" },
  ] : [];

  return <div className="page-stack dashboard-page">
    <PageHeader pageKey="overview" actions={<div className="hero-actions"><Link className="secondary-button" to="/importacoes"><Import /> Importar leads</Link><Link className="hero-button" to="/conversas">Abrir conversas <ArrowRight /></Link></div>} />
    {error ? <ErrorState description={error} retry={reload} /> : null}

    <section className="dashboard-metrics" aria-label="Indicadores reais da operação">
      {loading ? Array.from({ length: 10 }, (_, index) => <MetricCard key={index} label="Carregando" value="" note="" icon={<UsersRound />} loading />) : metrics.map((metric) => {
        const Icon = metric.icon;
        return <MetricCard key={metric.id} label={metric.label} value={metric.value} note={metric.note} {...(metric.tone ? { tone: metric.tone } : {})} icon={<Icon />} />;
      })}
    </section>

    <section className="dashboard-primary-grid">
      <DataCard eyebrow="Configuração" title="Comece por aqui" description="Prepare a operação antes de conectar e testar o WhatsApp.">
        <div className="setup-links">
          <Link to="/mente-da-ia"><Settings2 /><span><strong>1. Configure a Mente da IA</strong><small>Empresa, produto, regras e limites comerciais.</small></span><ArrowRight /></Link>
          <Link to="/mensagens-iniciais"><MessageCircle /><span><strong>2. Cadastre mensagens iniciais</strong><small>Crie aberturas aprovadas para o primeiro contato.</small></span><ArrowRight /></Link>
          <Link to="/horarios-limites"><Gauge /><span><strong>3. Revise horários e limites</strong><small>Defina a cadência segura da operação.</small></span><ArrowRight /></Link>
          <Link to="/integracoes/whatsapp"><Wifi /><span><strong>4. Conecte o WhatsApp</strong><small>Crie a instância e leia o QR Code.</small></span><ArrowRight /></Link>
        </div>
      </DataCard>

      <DataCard eyebrow="Serviços" title="Saúde das integrações" action={<Link className="inline-link" to="/saude">Diagnóstico</Link>}>
        {loading ? <LoadingSkeleton lines={5} /> : <div className="integration-health">{Object.entries(data?.health.services ?? {}).map(([name, value]) => {
          const state = serviceState(value);
          const good = ["healthy", "configured", "connected", "open", "reachable"].includes(state);
          return <SystemStatusIndicator key={name} label={name} status={state} tone={good ? "positive" : state === "mock" || state === "simulation" || state === "not_created" ? "warning" : "danger"} />;
        })}</div>}
      </DataCard>
    </section>

    {!loading && data ? <section className="dashboard-analytics"><OutreachPerformance analytics={data.outreachAnalytics} /></section> : null}

    <section className="dashboard-triple-grid">
      <DataCard eyebrow="Auditoria" title="Atividade recente" action={<Link className="inline-link" to="/logs">Ver logs</Link>}>
        {loading ? <LoadingSkeleton lines={3} /> : data?.logs.length ? <div className="simple-list">{data.logs.map((item) => <div key={item.id}><span><strong>{item.action ?? item.eventType ?? "Evento"}</strong><small>{item.service ?? "sistema"}</small></span><time>{formatDate(item.createdAt)}</time></div>)}</div> : <EmptyState title="Sem atividade recente" description="Os eventos reais aparecerão aqui." />}
      </DataCard>
      <DataCard eyebrow="Agenda" title="Próximas demonstrações" action={<Link className="inline-link" to="/demonstracoes">Abrir agenda</Link>}>
        {loading ? <LoadingSkeleton lines={3} /> : data?.appointments.length ? <div className="simple-list">{data.appointments.map((item) => <div key={item.id}><span><strong>{item.lead ?? item.leadId ?? "Lead"}</strong><small>{item.company ?? item.assignee ?? "Sem responsável"}</small></span><time>{formatDate(item.startsAt)}</time></div>)}</div> : <EmptyState title="Agenda livre" description="Nenhuma demonstração real agendada." />}
      </DataCard>
      <DataCard eyebrow="Oportunidades" title="Leads interessados" action={<Link className="inline-link" to="/interessados">Ver todos</Link>}>
        {loading ? <LoadingSkeleton lines={3} /> : data?.hotLeads.length ? <div className="simple-list">{data.hotLeads.map((lead) => <div key={lead.id}><span><strong>{lead.name ?? lead.phone ?? "Lead sem nome"}</strong><small>{lead.company ?? lead.source ?? "Sem empresa"}</small></span><StatusBadge tone="positive">Interessado</StatusBadge></div>)}</div> : <EmptyState title="Nenhum interessado" description="As oportunidades reais aparecerão após as conversas." />}
      </DataCard>
    </section>
  </div>;
}
