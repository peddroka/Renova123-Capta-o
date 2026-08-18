import { useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, FileSpreadsheet, ShieldCheck, UploadCloud } from "lucide-react";
import { api } from "../api";
import { Feedback } from "../components/Feedback";
import { PageHeader } from "../components/PageHeader";

type PreviewStatus = "valid" | "invalid" | "duplicate_file" | "duplicate_existing" | "blocked" | "already_approached" | "in_conversation";
type PreviewRow = { line: number; input: string; phone: string | null; status: PreviewStatus; reason: string | null };
type Preview = { rows: PreviewRow[]; summary: { total: number; valid: number; invalid: number; duplicateFile: number; duplicateExisting: number; blocked: number; alreadyApproached: number; inConversation: number } };

export function ImportPage() {
  const [step, setStep] = useState(1);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [form, setForm] = useState({ name: "", source: "", context: "", notes: "", initialStrategy: "", authorized: false, priority: 5, startDate: new Date().toISOString().slice(0, 10), dailyLimit: "" });
  const validPhones = useMemo(() => preview?.rows.filter((row) => row.status === "valid" && row.phone).map((row) => row.phone!) ?? [], [preview]);

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    if (file.size > 2_000_000) { setError("O CSV deve ter no máximo 2 MB."); return; }
    setFileName(file.name); setLoading(true); setError("");
    try { const content = await file.text(); const result = await api<Preview>("/imports/preview", { method: "POST", body: JSON.stringify({ content }) }); setPreview(result); setStep(2); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Falha ao ler o arquivo."); }
    finally { setLoading(false); }
  }

  async function commit(event: FormEvent) {
    event.preventDefault(); if (!preview || !form.authorized) return;
    setLoading(true); setError("");
    try {
      const result = await api<{ imported: number; skipped: number }>("/imports/commit", { method: "POST", body: JSON.stringify({ batch: { ...form, priority: Number(form.priority), dailyLimit: form.dailyLimit ? Number(form.dailyLimit) : null }, phones: validPhones }) });
      setSuccess(`${result.imported} contatos importados no lote. ${result.skipped} foram ignorados com segurança.`); setStep(4);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Falha ao importar."); }
    finally { setLoading(false); }
  }

  return <div className="page-stack">
    <PageHeader pageKey="imports" />
    <div className="stepper">{["Arquivo", "Validação", "Contexto", "Concluído"].map((label, index) => <div className={step >= index + 1 ? "active" : ""} key={label}><span>{step > index + 1 ? <CheckCircle2 /> : index + 1}</span><b>{label}</b></div>)}</div>
    {error ? <Feedback kind="error" message={error} onClose={() => setError("")} /> : null}
    {success ? <Feedback kind="success" message={success} /> : null}
    {step === 1 ? <section className="card import-card"><label className="dropzone"><UploadCloud /><strong>{loading ? "Lendo arquivo..." : "Selecione sua lista autorizada"}</strong><span>CSV ou TXT com telefone, numero, phone, whatsapp — ou um número por linha.</span><input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={(event) => void chooseFile(event)} disabled={loading} /><em>Escolher arquivo</em></label><div className="consent-note"><ShieldCheck /><p><strong>Uso responsável</strong><span>Importe somente contatos cuja abordagem comercial esteja autorizada. Opt-outs e bloqueios sempre prevalecem.</span></p></div></section> : null}
    {step === 2 && preview ? <section className="card import-card"><div className="preview-summary"><Summary label="Total" value={preview.summary.total} /><Summary label="Prontos" value={preview.summary.valid} tone="good" /><Summary label="Inválidos" value={preview.summary.invalid} tone="warn" /><Summary label="Repetidos no arquivo" value={preview.summary.duplicateFile} /><Summary label="Já cadastrados" value={preview.summary.duplicateExisting} /><Summary label="Já abordados" value={preview.summary.alreadyApproached} /><Summary label="Em conversa" value={preview.summary.inConversation} /><Summary label="Bloqueados" value={preview.summary.blocked} tone="warn" /></div><div className="file-chip"><FileSpreadsheet /><div><strong>{fileName}</strong><span>{preview.summary.valid} contatos realmente disponíveis para importação</span></div></div><div className="table-scroll preview-table"><table><thead><tr><th>Linha</th><th>Entrada</th><th>Normalizado</th><th>Resultado</th></tr></thead><tbody>{preview.rows.slice(0, 50).map((row) => <tr key={`${row.line}-${row.input}`}><td>{row.line}</td><td>{row.input}</td><td>{row.phone ?? "—"}</td><td><span className={`status-pill ${row.status === "valid" ? "positive" : ["invalid", "blocked"].includes(row.status) ? "failed" : "neutral"}`}>{row.status === "valid" ? "Pronto para importar" : row.reason}</span></td></tr>)}</tbody></table></div>{preview.rows.length > 50 ? <p className="table-note">Prévia limitada às primeiras 50 linhas. Todas serão processadas.</p> : null}<div className="form-actions"><button className="secondary-button" onClick={() => { setStep(1); setPreview(null); }}><ArrowLeft /> Trocar arquivo</button><button className="primary-button" disabled={!preview.summary.valid} onClick={() => setStep(3)}>Informar contexto <ArrowRight /></button></div></section> : null}
    {step === 3 ? <form className="card settings-form" onSubmit={(event) => void commit(event)}><div className="form-grid"><Field label="Nome do lote" required value={form.name} onChange={(value) => setForm({ ...form, name: value })} placeholder="Ex.: Feira Óptica Agosto" /><Field label="Origem dos contatos" required value={form.source} onChange={(value) => setForm({ ...form, source: value })} placeholder="Como a lista foi obtida" /><Field area label="Contexto do lote" required value={form.context} onChange={(value) => setForm({ ...form, context: value })} placeholder="O que Francisco precisa saber sobre estes contatos" /><Field area label="Observações" value={form.notes} onChange={(value) => setForm({ ...form, notes: value })} /><Field area label="Mensagem ou estratégia inicial (opcional)" value={form.initialStrategy} onChange={(value) => setForm({ ...form, initialStrategy: value })} /><label>Prioridade<select value={form.priority} onChange={(event) => setForm({ ...form, priority: Number(event.target.value) })}>{Array.from({ length: 10 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></label><label>Data de início<input type="date" required value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} /></label><label>Limite diário específico<input type="number" min="1" max="10000" placeholder="Usar limite geral" value={form.dailyLimit} onChange={(event) => setForm({ ...form, dailyLimit: event.target.value })} /></label></div><label className="check-row"><input type="checkbox" checked={form.authorized} onChange={(event) => setForm({ ...form, authorized: event.target.checked })} /><span><strong>Confirmo que estes contatos podem ser abordados</strong><small>Declaro que a lista tem origem autorizada e respeita as regras aplicáveis.</small></span></label><div className="form-actions"><button type="button" className="secondary-button" onClick={() => setStep(2)}><ArrowLeft /> Voltar</button><button className="primary-button" disabled={loading || !form.authorized}>{loading ? "Importando..." : `Importar ${validPhones.length} contatos`} <ArrowRight /></button></div></form> : null}
    {step === 4 ? <section className="card completion-card"><span><CheckCircle2 /></span><h2>Lote preparado com sucesso</h2><p>Os contatos válidos foram registrados. A captação respeitará a data, a prioridade, os limites e o modo de simulação.</p><button className="primary-button" onClick={() => { setStep(1); setPreview(null); setSuccess(""); setFileName(""); }}>Importar outra lista</button></section> : null}
  </div>;
}

function Field({ label, value, onChange, placeholder = "", required = false, area = false }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; required?: boolean; area?: boolean }) { return <label className={area ? "full" : ""}>{label}{area ? <textarea rows={4} required={required} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /> : <input required={required} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />}</label>; }
function Summary({ label, value, tone = "" }: { label: string; value: number; tone?: string }) { return <div className={tone}><span>{label}</span><strong>{value}</strong></div>; }
