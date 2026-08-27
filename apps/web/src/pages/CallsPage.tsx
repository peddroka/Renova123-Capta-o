import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Clipboard,
  Clock3,
  FileUp,
  PhoneCall,
  PhoneMissed,
  RotateCcw,
  Save,
  Target,
  UserRoundCheck,
  X,
} from "lucide-react";
import { DataCard, EmptyState, ErrorState, LoadingSkeleton, StatusBadge } from "@renova123/ui";
import { api } from "../api";
import { PageHeader } from "../components/PageHeader";

type CallOutcome = "no_answer" | "busy" | "voicemail" | "wrong_number" | "no_interest" | "interested" | "qualified" | "callback" | "other";
type CallTask = {
  id: string;
  sequence_no: number;
  phone: string;
  name?: string | null;
  company?: string | null;
  source?: string | null;
  status: string;
  outcome?: CallOutcome | null;
  notes?: string;
  attempt_count?: number;
  callback_at?: string | null;
};
type CallHistory = { id?: string; task_id?: string; outcome: CallOutcome; notes?: string; called_at: string; task?: CallTask | null };
type CallDesk = {
  timezone: string;
  goal: number;
  callsToday: number;
  remainingGoal: number;
  progressPct: number;
  interestedToday: number;
  qualifiedToday: number;
  pending: number;
  next: CallTask | null;
  history: CallHistory[];
  chart: Array<{ date: string; calls: number }>;
};

const outcomes: Array<{ value: CallOutcome; label: string; icon: typeof PhoneCall; tone?: string }> = [
  { value: "no_answer", label: "Não atendeu", icon: PhoneMissed },
  { value: "busy", label: "Ocupado", icon: Clock3 },
  { value: "voicemail", label: "Caixa postal", icon: PhoneMissed },
  { value: "wrong_number", label: "Número errado", icon: X },
  { value: "no_interest", label: "Sem interesse", icon: X },
  { value: "interested", label: "Interessado", icon: UserRoundCheck },
  { value: "qualified", label: "Qualificado", icon: CheckCircle2 },
  { value: "callback", label: "Retornar", icon: RotateCcw },
];

const outcomeLabels = new Map(outcomes.map((item) => [item.value, item.label]));

function phoneLabel(phone: string) {
  const digits = phone.replace(/\D/g, "").replace(/^55/, "");
  if (digits.length < 10) return phone;
  const ddd = digits.slice(0, 2);
  const rest = digits.slice(2);
  return `(${ddd}) ${rest.length === 9 ? rest.slice(0, 5) : rest.slice(0, 4)}-${rest.length === 9 ? rest.slice(5) : rest.slice(4)}`;
}

function shortDate(value: string) {
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function CallsPage() {
  const [data, setData] = useState<CallDesk | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState("");
  const [callbackAt, setCallbackAt] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importFeedback, setImportFeedback] = useState("");
  const [goal, setGoal] = useState(100);

  async function load() {
    setLoading(true);
    try {
      const result = await api<CallDesk>("/calls/desk");
      setData(result);
      setGoal(result.goal);
      setNotes(result.next?.notes ?? "");
      setCallbackAt(result.next?.callback_at ? new Date(result.next.callback_at).toISOString().slice(0, 16) : "");
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível abrir a mesa de ligações.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const chartMax = useMemo(() => Math.max(goal, ...((data?.chart ?? []).map((item) => item.calls)), 1), [data?.chart, goal]);

  async function startCall() {
    if (!data?.next) return;
    setBusy(true);
    try {
      await api(`/calls/${data.next.id}/start`, { method: "POST" });
      window.location.href = `tel:+${data.next.phone}`;
      await load();
    } finally { setBusy(false); }
  }

  async function complete(outcome: CallOutcome) {
    if (!data?.next) return;
    if (outcome === "callback" && !callbackAt) {
      setError("Escolha a data e o horário do retorno antes de salvar.");
      return;
    }
    setBusy(true);
    try {
      await api(`/calls/${data.next.id}/complete`, {
        method: "POST",
        body: JSON.stringify({ outcome, notes, callbackAt: outcome === "callback" ? new Date(callbackAt).toISOString() : null }),
      });
      setNotes("");
      setCallbackAt("");
      setError("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao salvar o resultado da ligação.");
    } finally { setBusy(false); }
  }

  async function importCalls() {
    if (!importText.trim()) return;
    setBusy(true);
    try {
      const result = await api<{ inserted: number; skipped: number; invalid: string[] }>("/calls/import", {
        method: "POST", body: JSON.stringify({ text: importText }),
      });
      setImportFeedback(`${result.inserted} adicionados · ${result.skipped} ignorados · ${result.invalid.length} inválidos`);
      setImportText("");
      await load();
    } catch (cause) {
      setImportFeedback(cause instanceof Error ? cause.message : "Falha ao importar números.");
    } finally { setBusy(false); }
  }

  async function saveGoal() {
    setBusy(true);
    try {
      await api("/calls/settings", { method: "PATCH", body: JSON.stringify({ dailyGoal: goal }) });
      await load();
    } finally { setBusy(false); }
  }

  return <div className="page-stack calls-page">
    <PageHeader
      pageKey="calls"
      actions={<button className="hero-button" onClick={() => setImportOpen(true)}><FileUp /> Importar números</button>}
    />
    {error ? <ErrorState description={error} retry={load} /> : null}
    {loading && !data ? <LoadingSkeleton lines={5} /> : null}

    {data ? <>
      <section className="calls-summary-grid">
        <DataCard className="calls-goal-card" eyebrow="Meta diária" title={`${data.callsToday} de ${data.goal} ligações`} description={`${data.remainingGoal} restantes hoje`}>
          <div className="calls-goal-progress"><i style={{ width: `${data.progressPct}%` }} /></div>
          <div className="calls-goal-foot"><strong>{data.progressPct}%</strong><span>Seu ritmo de hoje</span></div>
        </DataCard>
        <DataCard eyebrow="Fila" title={`${data.pending} números aguardando`} description="A ordem fica preservada até você registrar cada ligação.">
          <div className="calls-mini-stats"><span><strong>{data.interestedToday}</strong> interessados</span><span><strong>{data.qualifiedToday}</strong> qualificados</span></div>
        </DataCard>
        <DataCard eyebrow="Últimos 7 dias" title="Consistência" description="Tentativas registradas por dia.">
          <div className="calls-chart" aria-label="Ligações nos últimos sete dias">
            {data.chart.map((item) => <div key={item.date} title={`${item.date}: ${item.calls}`}><i style={{ height: `${Math.max(4, (item.calls / chartMax) * 100)}%` }} /><small>{new Date(`${item.date}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "narrow" })}</small></div>)}
          </div>
        </DataCard>
      </section>

      <section className="calls-workbench-grid">
        <DataCard className="calls-next-card" eyebrow="Caderno de ligações" title="Próxima ligação" description="Ligue, escreva o que aconteceu e registre um resultado. O próximo número aparece automaticamente.">
          {data.next ? <div className="calls-next">
            <div className="calls-next__top">
              <span className="calls-sequence">#{data.next.sequence_no}</span>
              <StatusBadge tone={data.next.status === "callback" ? "warning" : "info"}>{data.next.status === "callback" ? "Retorno" : "Na fila"}</StatusBadge>
            </div>
            <div className="calls-contact">
              <strong>{data.next.name || data.next.company || "Contato sem nome"}</strong>
              <a href={`tel:+${data.next.phone}`}>{phoneLabel(data.next.phone)}</a>
              {data.next.company && data.next.name ? <span>{data.next.company}</span> : null}
            </div>
            <div className="calls-primary-actions">
              <button className="hero-button" disabled={busy} onClick={() => void startCall()}><PhoneCall /> Ligar agora</button>
              <button className="secondary-button" onClick={() => void navigator.clipboard.writeText(data.next!.phone)}><Clipboard /> Copiar número</button>
            </div>
            <label className="calls-notes"><span>Anotações da ligação</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Ex.: falou com a gerente, pediu retorno amanhã, quer ver uma demonstração..." /></label>
            <div className="calls-callback"><label><span>Se precisar retornar</span><input type="datetime-local" value={callbackAt} onChange={(event) => setCallbackAt(event.target.value)} /></label></div>
            <div className="calls-outcomes" aria-label="Resultado rápido da ligação">
              {outcomes.map((item) => { const Icon = item.icon; return <button key={item.value} disabled={busy} data-outcome={item.value} onClick={() => void complete(item.value)}><Icon /><span>{item.label}</span></button>; })}
            </div>
          </div> : <EmptyState title="Fila concluída" description="Não há nenhum número pendente agora. Importe uma nova lista quando quiser continuar." />}
        </DataCard>

        <div className="calls-side-stack">
          <DataCard eyebrow="Meta" title={`${data.goal} ligações por dia`} description="Você pode ajustar a meta sem alterar a fila.">
            <div className="calls-goal-editor"><input type="number" min="1" max="1000" value={goal} onChange={(event) => setGoal(Math.max(1, Number(event.target.value) || 1))} /><button className="secondary-button" disabled={busy || goal === data.goal} onClick={() => void saveGoal()}><Save /> Salvar</button></div>
          </DataCard>
          <DataCard eyebrow="Histórico" title="Últimas ligações" description="O que você fez continua salvo para consulta.">
            <div className="calls-history">
              {data.history.length ? data.history.map((event, index) => <article key={event.id ?? `${event.task_id}-${index}`}>
                <div><strong>{event.task?.name || event.task?.company || (event.task?.phone ? phoneLabel(event.task.phone) : "Ligação")}</strong><StatusBadge tone={event.outcome === "qualified" ? "positive" : event.outcome === "interested" ? "info" : "neutral"}>{outcomeLabels.get(event.outcome) ?? event.outcome}</StatusBadge></div>
                <small>{shortDate(event.called_at)}</small>
                {event.notes ? <p>{event.notes}</p> : null}
              </article>) : <p className="muted-copy">Nenhuma ligação registrada ainda.</p>}
            </div>
          </DataCard>
        </div>
      </section>
    </> : null}

    {importOpen ? <div className="calls-modal-backdrop" role="presentation" onMouseDown={() => setImportOpen(false)}>
      <section className="calls-import-modal" role="dialog" aria-modal="true" aria-label="Importar números" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span>Nova lista</span><h2>Importar números para ligação</h2></div><button className="icon-button" onClick={() => setImportOpen(false)}><X /></button></header>
        <p>Um número por linha. Você também pode usar <code>telefone;nome;empresa</code>. A sequência é adicionada ao fim da fila atual.</p>
        <textarea autoFocus value={importText} onChange={(event) => setImportText(event.target.value)} placeholder={"5582999999999;João;Ótica Exemplo\n5582988888888;Maria;Loja Exemplo"} />
        {importFeedback ? <div className="calls-import-feedback">{importFeedback}</div> : null}
        <footer><button className="secondary-button" onClick={() => setImportOpen(false)}>Cancelar</button><button className="hero-button" disabled={busy || !importText.trim()} onClick={() => void importCalls()}>Adicionar à fila <ArrowRight /></button></footer>
      </section>
    </div> : null}
  </div>;
}
