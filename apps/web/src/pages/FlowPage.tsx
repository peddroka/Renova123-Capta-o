import { useEffect, useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  Heart,
  PauseCircle,
  PlayCircle,
  Reply,
  RotateCcw,
  Search,
  XCircle,
} from "lucide-react";
import { EmptyState } from "@renova123/ui";
import { api } from "../api";
import { Feedback, SkeletonTable } from "../components/Feedback";
import { PageHeader } from "../components/PageHeader";

type FlowRow = {
  id: string;
  lead?: { id?: string; name?: string; phone?: string; company?: string; source?: string };
  status: string;
  flow_step?: number;
  attempt_count?: number;
  next_attempt_at?: string | null;
};
type FlowStep = {
  step: number;
  delayDays: number;
  count: number;
  currentLeads: number;
  dueToday: number;
  overdue: number;
  processedToday: number;
  awaiting: number;
  quota: number;
  remaining: number;
  responseRate: number;
};
type FlowData = {
  summary: Record<string, number>;
  steps: FlowStep[];
  exits: Array<{ status: string; count: number }>;
  rows: FlowRow[];
  rowsTotal: number;
  page: number;
  pageSize: number;
  budget: {
    dailyBudget: number;
    usedBudget: number;
    remainingBudget: number;
    dueFollowups: number;
    followUpPolicy: string;
    stageLimits: number[];
  };
  settings: { newLeadsDailyLimit: number; stageDailyLimits: number[]; cadenceDelaysDays: number[] };
};
const exitLabels: Record<string, string> = {
  responded: "Responderam",
  qualified: "Qualificados / entregues",
  demo_requested: "Demonstração solicitada",
  uses_system: "Já usam sistema",
  no_interest: "Sem interesse",
  opted_out: "Opt-out / não contatar",
  paused: "Pausados",
  handed_off: "Entregues ao Pedro",
};

export function FlowPage() {
  const [data, setData] = useState<FlowData | null>(null);
  const [filter, setFilter] = useState<{ step?: number; status?: string }>({});
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<FlowRow | null>(null);
  const [saving, setSaving] = useState(false);
  async function load(nextFilter = filter, nextPage = page, nextSearch = search) {
    try {
      const params = new URLSearchParams({ page: String(nextPage), pageSize: "20" });
      if (nextFilter.step) params.set("step", String(nextFilter.step));
      if (nextFilter.status) params.set("status", nextFilter.status);
      if (nextSearch) params.set("search", nextSearch);
      setData(await api<FlowData>(`/flow?${params}`));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao carregar o fluxo.");
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function choose(next: { step?: number; status?: string }) {
    setFilter(next);
    setPage(1);
    await load(next, 1, search);
  }
  async function saveLimits(stageDailyLimits: number[]) {
    if (!data) return;
    setSaving(true);
    try {
      const current = await api<Record<string, unknown>>("/settings/outreach");
      await api("/settings/outreach", {
        method: "PUT",
        body: JSON.stringify({
          ...current,
          newLeadsDailyLimit: data.settings.newLeadsDailyLimit,
          dailyProactiveLimit: data.settings.newLeadsDailyLimit,
          stageDailyLimits,
        }),
      });
      await load();
    } finally {
      setSaving(false);
    }
  }
  async function action(row: FlowRow, kind: "pause" | "resume" | "reschedule") {
    const leadId = row.lead?.id ?? row.id;
    try {
      if (kind === "reschedule") {
        const value = window.prompt("Próxima tentativa em ISO", row.next_attempt_at ?? "");
        if (!value) return;
        await api(`/flow/leads/${leadId}/reschedule`, {
          method: "POST",
          body: JSON.stringify({ nextAttemptAt: new Date(value).toISOString() }),
        });
      } else await api(`/flow/leads/${leadId}/${kind}`, { method: "POST", body: JSON.stringify({}) });
      await load();
      setSelected(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao atualizar a cadência.");
    }
  }
  if (error && !data)
    return (
      <div className="page-stack">
        <Feedback kind="error" message={error} onClose={() => setError("")} />
      </div>
    );
  if (!data)
    return (
      <div className="page-stack">
        <SkeletonTable />
      </div>
    );
  const totalPages = Math.max(1, Math.ceil(data.rowsTotal / data.pageSize));
  return (
    <div className="page-stack flow-page">
      <PageHeader
        pageKey="flow"
        actions={
          <button className="hero-button" onClick={() => void load()}>
            <RotateCcw /> Atualizar
          </button>
        }
      />
      {error ? <Feedback kind="error" message={error} onClose={() => setError("")} /> : null}
      <section className="metrics-grid flow-summary">
        {[
          ["No fluxo", data.summary.inFlow],
          ["Vencem hoje", data.summary.dueToday],
          ["Atrasados", data.summary.overdue],
          ["Responderam", data.summary.responded],
          ["Qualificados", data.summary.qualified],
          ["Sem interesse", data.summary.noInterest],
        ].map(([label, value]) => (
          <article className="metric-card" key={String(label)}>
            <div>
              <p>{label}</p>
              <strong>{value}</strong>
            </div>
          </article>
        ))}
      </section>
      <section className="flow-budget card">
        <div>
          <span>PLANEJADOR DIÁRIO</span>
          <strong>
            {data.budget.usedBudget} / {data.budget.dailyBudget} novos leads
          </strong>
          <small>{data.budget.dueFollowups} follow-ups vencidos · não consomem a cota de novos leads</small>
        </div>
        <CalendarClock />
      </section>
      <section className="flow-grid">
        {data.steps.map((step) => (
          <button className="flow-step card" key={step.step} onClick={() => void choose({ step: step.step })}>
            <span className="flow-step-number">{step.step}</span>
            <div>
              <small>FLUXO {step.step}</small>
              <h2>
                {step.step === 1
                  ? "Novos contatos"
                  : `+${step.delayDays} dia${step.delayDays === 1 ? "" : "s"}`}
              </h2>
              <p>
                {step.currentLeads} leads únicos · {step.responseRate}% resposta
              </p>
              <p>
                Processados {step.processedToday} · aguardando {step.awaiting}
              </p>
            </div>
            <footer>
              <span>
                Hoje <b>{step.dueToday}</b>
              </span>
              <span>{step.step >= 3 ? `Restam ${step.remaining}` : "Sem limite"}</span>
            </footer>
          </button>
        ))}
      </section>
      <StageLimits data={data} saving={saving} onSave={saveLimits} />
      <section className="flow-exits">
        <header>
          <div>
            <span className="section-kicker">SAÍRAM DO FLUXO</span>
            <h2>Classificações</h2>
          </div>
        </header>
        <div className="flow-exit-grid">
          {data.exits.map((exit) => (
            <button
              className="flow-exit card"
              key={exit.status}
              onClick={() => void choose({ status: exit.status })}
            >
              <span>
                {exit.status === "responded" ? (
                  <Reply />
                ) : exit.status === "qualified" || exit.status === "handed_off" ? (
                  <Heart />
                ) : exit.status === "paused" ? (
                  <PauseCircle />
                ) : exit.status === "opted_out" || exit.status === "no_interest" ? (
                  <XCircle />
                ) : (
                  <CheckCircle2 />
                )}
              </span>
              <strong>{exit.count}</strong>
              <small>{exitLabels[exit.status] ?? exit.status}</small>
            </button>
          ))}
        </div>
      </section>
      <section className="card flow-list">
        <header className="flow-list__header">
          <div>
            <span className="section-kicker">LISTA PAGINADA</span>
            <h2>{data.rowsTotal} leads nesta seleção</h2>
          </div>
          <label>
            <Search />
            <input
              value={search}
              placeholder="Buscar nome, telefone ou empresa"
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void load(filter, 1, search);
              }}
            />
          </label>
        </header>
        {data.rows.length ? (
          <div className="simple-list">
            {data.rows.map((row) => (
              <div key={row.id}>
                <span>
                  <strong>{row.lead?.name ?? row.lead?.phone ?? "Lead"}</strong>
                  <small>
                    {row.lead?.company ?? row.lead?.source ?? "Sem empresa"} · tentativa{" "}
                    {row.attempt_count ?? 0}
                  </small>
                </span>
                <span>
                  <b>{row.next_attempt_at ? new Date(row.next_attempt_at).toLocaleString("pt-BR") : "—"}</b>
                  <button className="inline-link" onClick={() => setSelected(row)}>
                    Abrir
                  </button>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="Nenhum contato" description="Esta seleção ainda não possui contatos." />
        )}
        <footer className="flow-pagination">
          <button
            disabled={page <= 1}
            onClick={() => {
              const next = page - 1;
              setPage(next);
              void load(filter, next, search);
            }}
          >
            Anterior
          </button>
          <span>
            Página {page} de {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => {
              const next = page + 1;
              setPage(next);
              void load(filter, next, search);
            }}
          >
            Próxima
          </button>
        </footer>
      </section>
      {selected ? (
        <div className="modal-backdrop" onClick={() => setSelected(null)}>
          <section className="modal" onClick={(event) => event.stopPropagation()}>
            <h2>{selected.lead?.name ?? selected.lead?.phone ?? "Lead"}</h2>
            <p>
              {selected.lead?.phone ?? "Sem telefone"} · {selected.status}
            </p>
            <div className="row-actions">
              <button onClick={() => void action(selected, "pause")}>
                <PauseCircle /> Pausar
              </button>
              <button onClick={() => void action(selected, "resume")}>
                <PlayCircle /> Retomar
              </button>
              <button onClick={() => void action(selected, "reschedule")}>
                <CalendarClock /> Reagendar
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function StageLimits({
  data,
  saving,
  onSave,
}: {
  data: FlowData;
  saving: boolean;
  onSave: (limits: number[]) => Promise<void>;
}) {
  const [limits, setLimits] = useState(data.settings.stageDailyLimits);
  useEffect(() => setLimits(data.settings.stageDailyLimits), [data.settings.stageDailyLimits]);
  return (
    <section className="card flow-limits">
      <header>
        <span className="section-kicker">LIMITES INDEPENDENTES</span>
        <h2>Follow-ups por etapa</h2>
        <p>Fluxo 2 processa todos os vencidos. Fluxos 3–6 possuem limite próprio.</p>
      </header>
      <div className="flow-limit-grid">
        {limits.map((limit, index) => (
          <label key={index}>
            Fluxo {index + 1}
            <input
              type="range"
              min="1"
              max="500"
              value={limit}
              onChange={(event) =>
                setLimits((current) =>
                  current.map((value, item) => (item === index ? Number(event.target.value) : value)),
                )
              }
            />
            <input
              type="number"
              min="1"
              max="500"
              value={limit}
              onChange={(event) =>
                setLimits((current) =>
                  current.map((value, item) =>
                    item === index ? Math.max(1, Math.min(500, Number(event.target.value) || 1)) : value,
                  ),
                )
              }
            />
          </label>
        ))}
      </div>
      <button className="secondary-button" disabled={saving} onClick={() => void onSave(limits)}>
        {saving ? "Salvando…" : "Salvar limites"}
      </button>
    </section>
  );
}
