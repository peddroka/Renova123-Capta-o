import { useEffect, useState } from "react";
import { Activity, Database, Gauge, PlayCircle, RefreshCw, Server } from "lucide-react";
import { Button, DataCard, MetricCard, StatusBadge, SystemStatusIndicator } from "@renova123/ui";
import { api } from "../api";
import { Feedback } from "../components/Feedback";
import { PageHeader } from "../components/PageHeader";

type Health = {
  status: string;
  time: string;
  mode: string;
  latencyMs: number;
  simulationMode: boolean;
  outreachEnabled: boolean;
  automationActive: boolean;
  queue: { pending: number; failed: number };
  messages: { lastInboundAt: string | null; lastOutboundAt: string | null };
  usage: { dailyLimit: number; today: number };
  proactive: {
    state: string;
    lastProactiveSendAt: string | null;
    nextProactiveSendAt: string | null;
    intervalCurrentMinutes: number | null;
    blockReason: string;
    eligibleLeads: number;
  };
  services: Record<string, string | { status: string; lastHeartbeatAt?: string }>;
};

export function HealthPage() {
  const [data, setData] = useState<Health | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true);
    try {
      setData(await api<Health>("/health"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Diagnóstico indisponível.");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, []);
  const status = (value: Health["services"][string]) => (typeof value === "string" ? value : value.status);
  return (
    <div className="page-stack">
      <PageHeader
        pageKey="health"
        actions={
          <Button variant="secondary" disabled={busy} onClick={() => void load()}>
            <RefreshCw /> Diagnóstico seguro
          </Button>
        }
      />
      {error ? <Feedback kind="error" message={error} onClose={() => setError("")} /> : null}
      <section className="health-metrics">
        <MetricCard label="Latência API" value={`${data?.latencyMs ?? "—"} ms`} icon={<Gauge />} />
        <MetricCard
          label="Jobs pendentes"
          value={data?.queue.pending ?? "—"}
          icon={<Activity />}
          tone={data?.queue.pending ? "warning" : "positive"}
        />
        <MetricCard
          label="Jobs falhos"
          value={data?.queue.failed ?? "—"}
          icon={<Server />}
          tone={data?.queue.failed ? "danger" : "positive"}
        />
        <MetricCard
          label="Consumo diário"
          value={`${data?.usage.today ?? 0}/${data?.usage.dailyLimit ?? "—"}`}
          icon={<PlayCircle />}
        />
      </section>
      <div className="operational-grid">
        <DataCard eyebrow="Componentes" title="Saúde dos serviços">
          <div className="health-list">
            {data
              ? Object.entries(data.services).map(([name, value]) => (
                  <SystemStatusIndicator
                    key={name}
                    label={serviceLabel(name)}
                    status={status(value)}
                    tone={
                      ["healthy", "configured", "open", "mock", "reachable"].includes(status(value))
                        ? "positive"
                        : status(value) === "unavailable" || status(value) === "stale"
                          ? "danger"
                          : "warning"
                    }
                    {...(typeof value === "object" && value.lastHeartbeatAt
                      ? { detail: value.lastHeartbeatAt }
                      : {})}
                  />
                ))
              : null}
          </div>
        </DataCard>
        <DataCard eyebrow="Pacing proativo" title={data?.proactive.blockReason ?? "—"}>
          <dl className="health-details">
            <div>
              <dt>Último envio proativo</dt>
              <dd>{format(data?.proactive.lastProactiveSendAt)}</dd>
            </div>
            <div>
              <dt>Próximo envio proativo</dt>
              <dd>{format(data?.proactive.nextProactiveSendAt)}</dd>
            </div>
            <div>
              <dt>Intervalo atual</dt>
              <dd>{data?.proactive.intervalCurrentMinutes ? `${data.proactive.intervalCurrentMinutes} min` : "—"}</dd>
            </div>
            <div>
              <dt>Leads elegíveis</dt>
              <dd>{data?.proactive.eligibleLeads ?? "—"}</dd>
            </div>
          </dl>
        </DataCard>
        <DataCard eyebrow="Operação" title="Estado e eventos">
          <dl className="health-details">
            <div>
              <dt>Modo</dt>
              <dd>
                <StatusBadge tone={data?.simulationMode ? "warning" : "positive"}>
                  {data?.simulationMode ? "Simulação" : "Real"}
                </StatusBadge>
              </dd>
            </div>
            <div>
              <dt>Automação</dt>
              <dd>{data?.automationActive ? "Ativa" : "Pausada"}</dd>
            </div>
            <div>
              <dt>Último recebimento</dt>
              <dd>{format(data?.messages.lastInboundAt)}</dd>
            </div>
            <div>
              <dt>Último envio</dt>
              <dd>{format(data?.messages.lastOutboundAt)}</dd>
            </div>
            <div>
              <dt>Atualizado</dt>
              <dd>{format(data?.time)}</dd>
            </div>
          </dl>
          <p className="safe-diagnostic">
            <Database /> O diagnóstico consulta apenas estado e contadores; não exibe segredos e não envia mensagens.
          </p>
        </DataCard>
      </div>
    </div>
  );
}

function serviceLabel(value: string) {
  return (
    {
      frontend: "Frontend",
      api: "API",
      database: "Supabase",
      storage: "Storage",
      groq: "Groq",
      evolution: "Evolution API",
      whatsapp: "WhatsApp",
      worker: "Worker",
      scheduler: "Scheduler",
    } as Record<string, string>
  )[value] ?? value;
}

function format(value?: string | null) {
  return value ? new Date(value).toLocaleString("pt-BR") : "Sem registro";
}
