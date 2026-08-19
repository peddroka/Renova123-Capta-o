import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ChevronLeft, ChevronRight, Filter, MessageCircle, MessageSquareText, Pencil, Plus, RefreshCw, RotateCcw, Search, Trash2, X } from "lucide-react";
import { Link } from "react-router-dom";
import type { PageKey } from "@renova123/shared";
import { EmptyState } from "@renova123/ui";
import { api } from "../api";
import { Feedback, SkeletonTable } from "../components/Feedback";
import { PageHeader } from "../components/PageHeader";

type PageResult = { rows: Array<Record<string, unknown>>; total: number; page: number; pageSize: number };
type Field = { key: string; label: string; type?: "text" | "textarea" | "number" | "datetime-local" | "boolean" | "select"; required?: boolean; options?: Array<[string, string]>; full?: boolean };
type ResourceConfig = { resource: string; fields: Field[]; create?: boolean; remove?: boolean; edit?: boolean };

const stages: Array<[string, string]> = [["new", "Novo"], ["queued", "Na fila"], ["contacted", "Abordado"], ["engaged", "Em conversa"], ["interested", "Interessado"], ["demo_scheduled", "Demo agendada"], ["human_handoff", "Atendimento humano"], ["won", "Ganho"], ["lost", "Perdido"], ["opted_out", "Opt-out"]];
const configs: Partial<Record<PageKey, ResourceConfig>> = {
  leads: { resource: "leads", create: true, edit: true, fields: [{ key: "phone", label: "Telefone normalizado", required: true }, { key: "name", label: "Nome" }, { key: "company", label: "Empresa" }, { key: "source", label: "Origem", required: true }, { key: "stage", label: "Estágio", type: "select", options: stages }] },
  batches: { resource: "batches", edit: true, fields: [{ key: "name", label: "Nome" }, { key: "source", label: "Origem" }, { key: "status", label: "Status", type: "select", options: [["scheduled", "Agendado"], ["active", "Ativo"], ["paused", "Pausado"], ["completed", "Concluído"], ["cancelled", "Cancelado"]] }, { key: "priority", label: "Prioridade", type: "number" }, { key: "dailyLimit", label: "Limite diário", type: "number" }] },
  queue: { resource: "queue", fields: [] },
  conversations: { resource: "conversations", edit: true, fields: [{ key: "status", label: "Status", type: "select", options: [["active", "Ativa"], ["paused", "Pausada"], ["closed", "Encerrada"]] }, { key: "stage", label: "Estágio", type: "select", options: stages }, { key: "humanActive", label: "Atendimento humano ativo", type: "boolean" }, { key: "summary", label: "Resumo", type: "textarea", full: true }] },
  demos: { resource: "demos", create: true, edit: true, remove: true, fields: [{ key: "leadId", label: "ID do lead", required: true }, { key: "startsAt", label: "Início", type: "datetime-local", required: true }, { key: "endsAt", label: "Fim", type: "datetime-local", required: true }, { key: "status", label: "Status", type: "select", options: [["pending", "Pendente"], ["scheduled", "Agendada"], ["completed", "Concluída"], ["cancelled", "Cancelada"], ["no_show", "Não compareceu"]] }, { key: "assignee", label: "Responsável" }, { key: "notes", label: "Observações", type: "textarea", full: true }] },
  followups: { resource: "followups", create: true, edit: true, remove: true, fields: [{ key: "leadId", label: "ID do lead", required: true }, { key: "scheduledAt", label: "Agendado para", type: "datetime-local", required: true }, { key: "status", label: "Status", type: "select", options: [["scheduled", "Agendado"], ["processing", "Processando"], ["completed", "Concluído"], ["cancelled", "Cancelado"], ["failed", "Falhou"]] }, { key: "attemptNumber", label: "Número da tentativa", type: "number" }, { key: "reason", label: "Motivo", type: "textarea", required: true, full: true }] },
  handoffs: { resource: "handoffs", create: true, edit: true, remove: true, fields: [{ key: "leadId", label: "ID do lead", required: true }, { key: "reason", label: "Motivo", type: "textarea", required: true, full: true }, { key: "status", label: "Status", type: "select", options: [["pending", "Aguardando"], ["active", "Assumido"], ["returned", "Devolvido ao Francisco"], ["closed", "Encerrado"]] }, { key: "assignedTo", label: "Responsável" }, { key: "result", label: "Resultado", type: "textarea", full: true }] },
  optouts: { resource: "optouts", create: true, edit: true, remove: true, fields: [{ key: "phone", label: "Telefone normalizado", required: true }, { key: "reason", label: "Motivo", required: true }, { key: "source", label: "Origem" }, { key: "active", label: "Bloqueio ativo", type: "boolean" }] },
  openers: { resource: "openers", create: true, edit: true, remove: true, fields: [{ key: "name", label: "Nome", required: true }, { key: "content", label: "Mensagem", type: "textarea", required: true, full: true }, { key: "active", label: "Ativa", type: "boolean" }] },
};

const labels: Record<string, string> = { name: "Nome", phone: "Telefone", company: "Empresa", stage: "Estágio", source: "Origem", status: "Status", priority: "Prioridade", total: "Total", totalCount: "Total", processed: "Processados", processedCount: "Processados", type: "Tipo", attempts: "Tentativas", availableAt: "Disponível em", presenceStatus: "Presença", queueName: "Fila", lead: "Lead", leadId: "Lead", lastMessage: "Última mensagem", updatedAt: "Atualizado", startsAt: "Início", assignee: "Responsável", assignedTo: "Responsável", reason: "Motivo", scheduledAt: "Agendado", attempt: "Tentativa", attemptNumber: "Tentativa", category: "Categoria", mimeType: "Tipo MIME", active: "Ativo", autoSendAllowed: "Envio automático", size: "Tamanho", sizeBytes: "Tamanho", content: "Conteúdo", useCount: "Usos", action: "Ação", entityType: "Entidade", actor: "Ator", createdAt: "Criado em", lastContactAt: "Último contato", startDate: "Início", humanActive: "Humano ativo" };

export function ResourcePage({ pageKey }: { pageKey: PageKey }) {
  const config = configs[pageKey];
  const [result, setResult] = useState<PageResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Record<string, unknown> | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const pageSize = 10;

  const load = useCallback(async () => { setLoading(true); setError(""); try { setResult(await api<PageResult>(`/pages/${pageKey}?page=${page}&pageSize=${pageSize}&search=${encodeURIComponent(query)}&stage=${encodeURIComponent(stage)}`)); } catch (reason) { setError(reason instanceof Error ? reason.message : "Falha ao carregar."); } finally { setLoading(false); } }, [pageKey, page, query, stage]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const timer = window.setTimeout(() => { setPage(1); setQuery(search); }, 350); return () => window.clearTimeout(timer); }, [search]);
  const columns = useMemo(() => pageKey === "queue" ? ["type", "status", "presenceStatus", "priority", "availableAt", "attempts", "queueName"].filter((key) => Object.prototype.hasOwnProperty.call(result?.rows[0] ?? {}, key)) : Object.keys(result?.rows[0] ?? {}).filter((key) => key !== "id" && !["lastError", "details"].includes(key)).slice(0, pageKey === "openers" ? 5 : pageKey === "qualified" ? 7 : 7), [result, pageKey]);
  const pages = Math.max(1, Math.ceil((result?.total ?? 0) / pageSize));

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!config) return;
    const values = formValues(new FormData(event.currentTarget), config.fields);
    setSaving(true); setError("");
    try {
      if (editing?.id) await api(`/resources/${config.resource}/${String(editing.id)}`, { method: "PATCH", body: JSON.stringify(values) });
      else await api(`/resources/${config.resource}`, { method: "POST", body: JSON.stringify(values) });
      setSuccess(editing?.id ? "Alterações salvas e registradas na auditoria." : "Registro criado com sucesso.");
      setEditing(undefined); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Falha ao salvar."); }
    finally { setSaving(false); }
  }

  async function remove(row: Record<string, unknown>) {
    if (!config?.remove || !window.confirm(`Excluir ${String(row.name ?? row.phone ?? row.id ?? "este registro")}? Esta ação será auditada.`)) return;
    try { await api(`/resources/${config.resource}/${String(row.id)}`, { method: "DELETE" }); setSuccess("Registro excluído com sucesso."); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Falha ao excluir."); }
  }

  async function retry(row: Record<string, unknown>) {
    if (!config || pageKey !== "queue") return;
    try { await api(`/queue/${String(row.queueName ?? "jobs")}/${String(row.id)}`, { method: "PATCH", body: JSON.stringify({ status: "pending", availableAt: new Date().toISOString() }) }); setSuccess("Item devolvido à fila para nova tentativa."); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Falha ao recolocar na fila."); }
  }

  async function cancelQueueItem(row: Record<string, unknown>) {
    if (pageKey !== "queue" || !window.confirm("Cancelar este item da fila?")) return;
    try { await api(`/queue/${String(row.queueName ?? "jobs")}/${String(row.id)}/cancel`, { method: "POST" }); setSuccess("Item cancelado com sucesso."); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Falha ao cancelar o item."); }
  }

  async function manualMessage(row: Record<string, unknown>) {
    const leadId = String(row.leadId ?? "");
    if (!leadId) { setError("Esta conversa ainda não está vinculada a um lead."); return; }
    const text = window.prompt("Mensagem manual para o lead. Ao enviar, Francisco será pausado nesta conversa:");
    if (!text?.trim()) return;
    try { await api(`/conversations/${leadId}/manual-message`, { method: "POST", body: JSON.stringify({ text: text.trim() }) }); setSuccess("Mensagem manual processada; o atendimento humano ficou ativo."); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Falha ao enviar mensagem manual."); }
  }

  return <div className="page-stack">
    <PageHeader pageKey={pageKey} actions={config?.create ? <button className="hero-button" onClick={() => setEditing(null)}><Plus /> Novo</button> : undefined} />
    {error ? <Feedback kind="error" message={error} onClose={() => setError("")} /> : null}
    {success ? <Feedback kind="success" message={success} onClose={() => setSuccess("")} /> : null}
    <section className="card data-card">
      <div className="data-toolbar"><div className="search-field"><Search /><input id="page-search" placeholder={`Pesquisar em ${friendly(pageKey)}...`} value={search} onChange={(event) => setSearch(event.target.value)} /></div>{pageKey === "leads" ? <label className="inline-filter"><Filter /><select aria-label="Filtrar por estágio" value={stage} onChange={(event) => { setPage(1); setStage(event.target.value); }}><option value="">Todos os estágios</option>{stages.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label> : <span className="toolbar-caption"><Filter /> Filtros aplicados na pesquisa</span>}<button className="icon-button light" aria-label="Atualizar" onClick={() => void load()}><RefreshCw /></button></div>
      {loading ? <SkeletonTable /> : !result?.rows.length ? <EmptyState title="Nada por aqui ainda" description="Quando a operação gerar registros, eles aparecerão nesta área com os filtros aplicados." /> : <div className="table-scroll"><table><thead><tr>{columns.map((column) => <th key={column}>{labels[column] ?? titleCase(column)}</th>)}{config || pageKey === "qualified" ? <th aria-label="Ações" /> : null}</tr></thead><tbody>{result.rows.map((row, index) => <tr key={String(row.id ?? index)}>{columns.map((column) => <td key={column}>{formatCell(column, row[column])}</td>)}{config || pageKey === "qualified" ? <td className="row-actions">{pageKey === "qualified" && row.phone ? <Link className="row-action-link" aria-label="Abrir conversa do lead qualificado" title="Abrir conversa" to={`/conversas?search=${encodeURIComponent(String(row.phone))}`}><MessageCircle /></Link> : null}{config && pageKey === "queue" ? <><button aria-label="Tentar novamente" title="Tentar novamente" onClick={() => void retry(row)}><RotateCcw /></button><button aria-label="Cancelar item" title="Cancelar item" onClick={() => void cancelQueueItem(row)}><X /></button></> : null}{config && pageKey === "conversations" ? <button aria-label="Enviar mensagem manual" title="Enviar mensagem manual" onClick={() => void manualMessage(row)}><MessageSquareText /></button> : null}{config && pageKey === "leads" ? <WhatsAppLink phone={row.phone} /> : null}{config?.edit ? <button aria-label="Editar" title="Editar" onClick={() => setEditing(row)}><Pencil /></button> : null}{config?.remove ? <button aria-label="Excluir" title="Excluir" onClick={() => void remove(row)}><Trash2 /></button> : null}</td> : null}</tr>)}</tbody></table></div>}
      <footer className="pagination"><span>{result?.total ?? 0} registros</span><div><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft /> Anterior</button><span>Página {page} de {pages}</span><button disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>Próxima <ChevronRight /></button></div></footer>
    </section>
    {editing !== undefined && config ? <div className="modal-backdrop"><form className="modal" onSubmit={(event) => void save(event)}><header><div><h2>{editing?.id ? "Editar registro" : "Novo registro"}</h2><p>As alterações são persistidas e registradas na auditoria.</p></div><button type="button" aria-label="Fechar" onClick={() => setEditing(undefined)}><X /></button></header><div className="form-grid compact">{config.fields.map((field) => <ResourceField key={field.key} field={field} value={editing?.[field.key]} creating={!editing?.id} />)}</div><footer><button type="button" className="secondary-button" onClick={() => setEditing(undefined)}>Cancelar</button><button className="primary-button" disabled={saving}>{saving ? "Salvando..." : "Salvar"}</button></footer></form></div> : null}
  </div>;
}

function ResourceField({ field, value, creating }: { field: Field; value: unknown; creating: boolean }) {
  const required = creating && field.required;
  const className = field.full ? "full" : "";
  if (field.type === "boolean") return <label className={`toggle-field ${className}`}><span><strong>{field.label}</strong></span><input name={field.key} type="checkbox" defaultChecked={value === undefined ? true : Boolean(value)} /></label>;
  if (field.type === "textarea") return <label className={className}>{field.label}<textarea name={field.key} rows={4} required={required} defaultValue={stringValue(value)} /></label>;
  if (field.type === "select") return <label className={className}>{field.label}<select name={field.key} required={required} defaultValue={stringValue(value)}><option value="">Selecione</option>{field.options?.map(([option, label]) => <option value={option} key={option}>{label}</option>)}</select></label>;
  return <label className={className}>{field.label}<input name={field.key} type={field.type ?? "text"} required={required} defaultValue={field.type === "datetime-local" ? localDateTime(value) : stringValue(value)} /></label>;
}

function formValues(data: FormData, fields: Field[]) {
  const values: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.type === "boolean") { values[field.key] = data.has(field.key); continue; }
    const raw = String(data.get(field.key) ?? "").trim();
    if (!raw) continue;
    values[field.key] = field.type === "number" ? Number(raw) : field.type === "datetime-local" ? new Date(raw).toISOString() : raw;
  }
  return values;
}

function friendly(key: PageKey) { return ({ leads: "leads", batches: "lotes", queue: "fila", conversations: "conversas", interested: "interessados", qualified: "qualificados", demos: "demonstrações", unanswered: "não responderam", followups: "follow-ups", handoffs: "transferidos", lost: "perdidos", optouts: "bloqueios", openers: "mensagens", logs: "auditoria", health: "serviços" } as Partial<Record<PageKey, string>>)[key] ?? "registros"; }
function titleCase(value: string) { return value.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase()); }
function stringValue(value: unknown) { return value === null || value === undefined ? "" : String(value); }
function localDateTime(value: unknown) { if (!value || Number.isNaN(Date.parse(String(value)))) return ""; const date = new Date(String(value)); return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); }
function WhatsAppLink({ phone }: { phone: unknown }) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  const normalized = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
  if (!normalized) return <button aria-label="WhatsApp indisponível" title="Telefone não informado" disabled><MessageCircle /></button>;
  return <a className="row-action-link" aria-label="Abrir WhatsApp" title="Abrir WhatsApp" href={`https://wa.me/${normalized}`} target="_blank" rel="noreferrer"><MessageCircle /></a>;
}
function formatCell(column: string, value: unknown): React.ReactNode {
  if (value === null || value === undefined || value === "") return <span className="muted-cell">—</span>;
  if (typeof value === "boolean") return <span className={`status-pill ${value ? "positive" : "neutral"}`}>{value ? "Sim" : "Não"}</span>;
  if (column === "stage" || column === "status") return <span className={`status-pill ${String(value)}`}>{translateStatus(String(value))}</span>;
  if (/At$|Date$/.test(column) && !Number.isNaN(Date.parse(String(value)))) return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(String(value)));
  if (column === "phone") return `+${String(value).slice(0, 2)} ${String(value).slice(2, 4)} ${String(value).slice(4)}`;
  if (column === "sizeBytes") return new Intl.NumberFormat("pt-BR", { style: "unit", unit: "megabyte", maximumFractionDigits: 1 }).format(Number(value) / 1024 / 1024);
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return text.length > 72 ? `${text.slice(0, 72)}…` : text;
}
function translateStatus(value: string) { return ({ new: "Novo", queued: "Na fila", contacted: "Abordado", engaged: "Em conversa", interested: "Interessado", demo_scheduled: "Demo agendada", human_handoff: "Humano", won: "Ganho", lost: "Perdido", opted_out: "Opt-out", active: "Ativo", paused: "Pausado", closed: "Encerrado", scheduled: "Agendado", pending: "Pendente", processing: "Processando", completed: "Concluído", simulated: "Simulado", cancelled: "Cancelado", dead: "Falha definitiva", failed: "Falhou", returned: "Devolvido", healthy: "Saudável", not_configured: "Não configurado", online: "Online detectado", offline: "Offline", unknown: "Aguardando online", unavailable_to_detect: "Presença indisponível" } as Record<string, string>)[value] ?? value.replaceAll("_", " "); }
