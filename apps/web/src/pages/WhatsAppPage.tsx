import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Link2, LogOut, MessageSquareText, PlugZap, RefreshCw, RotateCw, Smartphone, Trash2, Webhook, WifiOff } from "lucide-react";
import { api } from "../api";
import { Feedback } from "../components/Feedback";
import { PageHeader } from "../components/PageHeader";

type ConnectionState = "not_created" | "close" | "connecting" | "open" | "unavailable";
type PairingStatus = {
  evolution: "online" | "offline";
  instanceName: string;
  state: ConnectionState;
  number: string | null;
  available: boolean;
  circuit: string;
  simulation: boolean;
  webhook: "ok" | "error";
  qr: string | null;
  pairingCode: string | null;
  qrCount: number | null;
  qrExpiresAt: string | null;
  updatedAt: string;
  lastConnectionAt: string | null;
  lastEventAt: string | null;
};
type Diagnostics = { connectionMode: "evolution" | "not_configured"; webhookConfigured: boolean; apiKeyConfigured: boolean; apiKeyExposed: boolean };

export function WhatsAppPage() {
  const [pairing, setPairing] = useState<PairingStatus | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState("");
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);

  const refresh = useCallback(async () => {
    try {
      setPairing(await api<PairingStatus>("/whatsapp/pairing"));
      setError("");
    } catch (reason) {
      setError(message(reason, "Falha ao consultar a Evolution API."));
    }
  }, []);

  useEffect(() => {
    let active = true;
    let timer = 0;
    const poll = async () => {
      await refresh();
      if (active) timer = window.setTimeout(() => void poll(), 3_000);
    };
    void poll();
    void api<Diagnostics>("/whatsapp/diagnostics").then(setDiagnostics).catch(() => undefined);
    return () => { active = false; window.clearTimeout(timer); };
  }, [refresh]);

  async function action(name: string, path: string, method = "POST", success = "Operação concluída.") {
    setLoading(name); setError(""); setNotice("");
    try { await api(path, { method }); setNotice(success); await refresh(); }
    catch (reason) { setError(message(reason, "Falha na operação.")); }
    finally { setLoading(""); }
  }

  async function connect() {
    setLoading("connect"); setError(""); setNotice("");
    try {
      await api("/whatsapp/connect", { method: "POST" });
      setNotice("Pairing iniciado. Escaneie o QR atual abaixo.");
      await refresh();
    } catch (reason) {
      setError(message(reason, "Falha ao iniciar o pairing."));
    } finally { setLoading(""); }
  }

  async function testMessage() {
    const phone = window.prompt("Número brasileiro no formato 55 + DDD + número:", "5511999999999");
    if (!phone) return;
    setLoading("test"); setError("");
    try {
      await api("/whatsapp/test", { method: "POST", body: JSON.stringify({ phone, text: "Teste manual da integração Renova123 Captação", confirmation: pairing?.simulation ? undefined : "ENVIAR TESTE MANUAL", idempotencyKey: crypto.randomUUID() }) });
      setNotice(pairing?.simulation ? "Teste simulado com sucesso; nenhuma mensagem real foi enviada." : "Teste manual enviado.");
    } catch (reason) { setError(message(reason, "Falha no teste manual.")); }
    finally { setLoading(""); }
  }

  async function remove() {
    if (window.confirm("Excluir a instância e encerrar a sessão atual?")) await action("delete", "/whatsapp/instance", "DELETE", "Instância excluída.");
  }

  const setupBlocked = diagnostics?.connectionMode !== "evolution" || !diagnostics?.apiKeyConfigured || !diagnostics.webhookConfigured;
  const state = setupBlocked ? "unavailable" : pairing?.state ?? "unavailable";
  const connected = state === "open";
  const connecting = state === "connecting";
  const canConnect = !setupBlocked && !connected && !connecting;

  return <div className="page-stack">
    <PageHeader pageKey="whatsapp" actions={<button className="hero-button" onClick={() => void refresh()}><RefreshCw /> Atualizar</button>} />
    {error ? <Feedback kind="error" message={error} onClose={() => setError("")} /> : null}
    {notice ? <Feedback kind="success" message={notice} onClose={() => setNotice("")} /> : null}
    <section className="whatsapp-grid">
      <article className="card connection-card">
        <header><span className={connected ? "connected" : ""}>{connected ? <CheckCircle2 /> : <WifiOff />}</span><div><p>Instância Evolution</p><h2>{pairing?.instanceName ?? "renova123-francisco"}</h2></div><b>{labelState(state)}</b></header>
        <div className="connection-details">
          <div><span>Evolution API</span><strong>{pairing?.evolution === "online" ? "Online" : "Offline"}</strong></div>
          <div><span>WhatsApp</span><strong>{connected ? "Conectado" : connecting ? "Conectando" : "Desconectado"}</strong></div>
          <div><span>Webhook</span><strong>{pairing?.webhook === "ok" ? "OK" : "Erro"}</strong></div>
          <div><span>Número conectado</span><strong>{pairing?.number ?? "Não informado"}</strong></div>
          <div><span>Geração do QR</span><strong>{pairing?.qrCount ?? "—"}</strong></div>
          <div><span>Última atualização</span><strong>{formatDate(pairing?.updatedAt)}</strong></div>
          <div><span>Circuit breaker</span><strong>{setupBlocked ? "indisponível" : pairing?.circuit ?? "indisponível"}</strong></div>
          <div><span>Credencial no navegador</span><strong>Nunca exposta</strong></div>
        </div>
        <div className="whatsapp-actions">
          <button className="primary-button" onClick={() => void connect()} disabled={Boolean(loading) || !canConnect} title={setupBlocked ? "Preencha a URL/chave da Evolution e a URL do webhook no servidor." : undefined}><Link2 /> {setupBlocked ? "WhatsApp não configurado" : loading === "connect" ? "Preparando..." : connected ? "WhatsApp conectado" : connecting ? "Aguardando leitura" : "Conectar WhatsApp"}</button>
          <button className="secondary-button" onClick={() => void action("create", "/whatsapp/instance", "POST", "Instância criada.")} disabled={Boolean(loading) || setupBlocked}><PlugZap /> Criar instância</button>
          <button className="secondary-button" onClick={() => void action("webhook", "/whatsapp/webhook/configure", "POST", "Webhook configurado.")} disabled={Boolean(loading) || setupBlocked}><Webhook /> Configurar webhook</button>
          <button className="secondary-button" onClick={() => void action("restart", "/whatsapp/restart", "POST", "Instância reiniciada.")} disabled={Boolean(loading) || setupBlocked}><RotateCw /> Reiniciar</button>
          <button className="secondary-button" onClick={() => void testMessage()} disabled={Boolean(loading)}><MessageSquareText /> Teste manual</button>
          <button className="secondary-button" onClick={() => void action("logout", "/whatsapp/logout", "POST", "Sessão encerrada.")} disabled={Boolean(loading) || setupBlocked}><LogOut /> Desconectar</button>
          <button className="danger-button" onClick={() => void remove()} disabled={Boolean(loading) || setupBlocked}><Trash2 /> Excluir</button>
        </div>
      </article>
      <article className="card qr-card">
        {pairing?.qr && connecting ? <><div className="qr-frame"><img key={pairing.qr} src={pairing.qr} alt="QR Code atual retornado pela Evolution API" /></div><h2>Leia com o WhatsApp Business</h2><p>Esta imagem acompanha automaticamente o QR vigente. Geração {pairing.qrCount ?? "—"}; atualização {formatTime(pairing.updatedAt)}.</p>{pairing.pairingCode ? <span className="pair-code">Código: {pairing.pairingCode}</span> : null}</> : <><span className="phone-illustration"><Smartphone /><MessageSquareText /></span><h2>{connected ? "WhatsApp conectado" : connecting ? "Aguardando QR atual" : setupBlocked ? "Evolution API não configurada" : "Pronto para conectar"}</h2><p>{connected ? "A Evolution confirmou o estado open; o QR foi removido automaticamente." : connecting ? "O backend está acompanhando a sessão sem iniciar conexões concorrentes." : setupBlocked ? "Configure a Evolution real para liberar a conexão." : "Clique em Conectar WhatsApp. O QR será exibido aqui, sem abrir página externa."}</p></>}
      </article>
      <article className="card whatsapp-checklist"><h2>Status da integração</h2><p><CheckCircle2 /> Evolution: {pairing?.evolution === "online" ? "online" : "offline"}</p><p><CheckCircle2 /> Instância: {pairing?.instanceName ?? "renova123-francisco"}</p><p><CheckCircle2 /> Webhook: {pairing?.webhook === "ok" ? "OK" : "erro"}</p><p><CheckCircle2 /> API key: protegida no backend</p></article>
    </section>
  </div>;
}

function labelState(state: ConnectionState) { return ({ not_created: "Não criada", close: "Desconectada", connecting: "Conectando", open: "Conectada", unavailable: "Indisponível" } as const)[state]; }
function formatDate(value: string | null | undefined) { return value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "Sem registro"; }
function formatTime(value: string | null | undefined) { return value ? new Intl.DateTimeFormat("pt-BR", { timeStyle: "medium" }).format(new Date(value)) : "—"; }
function message(reason: unknown, fallback: string) { return reason instanceof Error ? reason.message : fallback; }
