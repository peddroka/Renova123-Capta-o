import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  ArrowLeft,
  BarChart3,
  CalendarClock,
  ClipboardList,
  Mic,
  PhoneIncoming,
  PhoneOutgoing,
  Radio,
  Settings2,
  Square,
  Volume2,
  WandSparkles,
} from "lucide-react";
import { API_URL, api } from "../api";
import { getValidAccessToken } from "../supabase";
import { Feedback } from "../components/Feedback";
import { PageHeader } from "../components/PageHeader";
import { resampleFloat32ToPcm16 } from "../audio";

type Lead = {
  id: string;
  name?: string | null;
  company?: string | null;
  phone: string;
  source?: string | null;
  batchId?: string | null;
  batchName?: string | null;
  batchSource?: string | null;
  wolfState?: { status?: string; nextCallAt?: string | null; lastCallAt?: string | null; totalAttempts?: number };
};
type Turn = { id?: string; speaker: "operator" | "client"; text: string; createdAt?: string };
type Call = {
  id: string;
  leadId?: string | null;
  status: string;
  direction: "inbound" | "outbound";
  result?: string | null;
  summary?: string | null;
  startedAt?: string | null;
};
type LeadEvent = { id: string; eventType: string; occurredAt?: string; metadata?: Record<string, unknown> };
type AudioStatus = {
  provider?: string;
  helper: {
    available: boolean;
    state: string;
    gatewayConnected?: boolean;
    audioFrames?: number;
    audioBytes?: number;
    audioReceiving?: boolean;
    device?: string;
    lastRms?: number;
    lastPeak?: number;
    lastFrameAgeMs?: number | null;
  };
  transcription: { model: string; provider?: string; delay: string };
};
type OutputDevice = { id: string; name: string; state?: string };
type Readiness = {
  ready: boolean;
  helperConnected: boolean;
  reasons: string[];
  checks: Record<string, boolean>;
  mode: string;
};
type Capture = { stop: () => void };
type MicTrackInfo = {
  label: string;
  readyState: string;
  enabled: boolean;
  muted: boolean;
  sampleRate: number;
  channelCount: number;
  deviceId: string;
};
const AUDIO_SIGNAL_THRESHOLD = 0.003;
const LOCAL_PEAK_THRESHOLD = 0.01;

export function WolfPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [history, setHistory] = useState<Call[]>([]);
  const [selected, setSelected] = useState<Lead | null>(null);
  const [attendanceLead, setAttendanceLead] = useState<Lead | null>(null);
  const [attendanceHistory, setAttendanceHistory] = useState<LeadEvent[]>([]);
  const [attendanceSession, setAttendanceSession] = useState<Call | null>(null);
  const [callbackDraft, setCallbackDraft] = useState("");
  const [queueSearch, setQueueSearch] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [call, setCall] = useState<Call | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [suggestion, setSuggestion] = useState("");
  const [manual, setManual] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [audio, setAudio] = useState<AudioStatus | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [recovery, setRecovery] = useState<Call | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [micTest, setMicTest] = useState<"idle" | "testing" | "ok" | "failed">("idle");
  const [micTranscript, setMicTranscript] = useState("");
  const [clientTest, setClientTest] = useState<"idle" | "testing" | "ok" | "failed">("idle");
  const [clientAudioState, setClientAudioState] = useState("AGUARDANDO ÁUDIO");
  const [clientTranscript, setClientTranscript] = useState("");
  const [clientFrames, setClientFrames] = useState(0);
  const [clientBytes, setClientBytes] = useState(0);
  const [clientRms, setClientRms] = useState(0);
  const [clientPeak, setClientPeak] = useState(0);
  const [clientVad, setClientVad] = useState("aguardando");
  const [clientSignal, setClientSignal] = useState(false);
  const [clientWhisper, setClientWhisper] = useState("aguardando");
  const [clientPartial, setClientPartial] = useState("");
  const [clientLatency, setClientLatency] = useState(0);
  const [outputDevices, setOutputDevices] = useState<OutputDevice[]>([]);
  const [outputDevice, setOutputDevice] = useState(() => localStorage.getItem("wolf-output-device") ?? "");
  const [suggestionState, setSuggestionState] = useState<"idle" | "client" | "analyzing" | "ready" | "error">(
    "idle",
  );
  const [review, setReview] = useState({
    summary: "",
    result: "Interessado",
    nextAction: "",
    followUpDate: "",
  });
  const [wolfView, setWolfView] = useState<
    "today" | "leads" | "returns" | "history" | "results" | "performance" | "prep" | "no_answer" | "has_system" | "interested" | "no_interest" | "converted" | "all"
  >("today");
  const [micDevice, setMicDevice] = useState("");
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
  const [micFrames, setMicFrames] = useState(0);
  const [micBackendFrames, setMicBackendFrames] = useState(0);
  const [micRms, setMicRms] = useState(0);
  const [micVad, setMicVad] = useState("aguardando");
  const [micWhisper, setMicWhisper] = useState("aguardando");
  const [micPeak, setMicPeak] = useState(0);
  const [micInputRate, setMicInputRate] = useState(0);
  const [micLocalStatus, setMicLocalStatus] = useState("não testado");
  const [micTrackInfo, setMicTrackInfo] = useState<MicTrackInfo | null>(null);
  const [micRecordingUrl, setMicRecordingUrl] = useState("");
  const [micBytesSent, setMicBytesSent] = useState(0);
  const [wolfImporting, setWolfImporting] = useState(false);
  const [wolfImportMessage, setWolfImportMessage] = useState("");
  const stream = useRef<MediaStream | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const worklet = useRef<AudioWorkletNode | null>(null);
  const sockets = useRef<WebSocket[]>([]);
  const capture = useRef<Capture | null>(null);
  const preflightSocket = useRef<WebSocket | null>(null);
  const preflightInFlight = useRef(false);
  const preflightTimer = useRef<number | null>(null);
  const preflightAbort = useRef<AbortController | null>(null);
  const clientPreflightInFlight = useRef(false);
  const micDiagnostic = useRef({ frames: 0, backendFrames: 0, rms: 0, peak: 0, vad: "aguardando", whisper: "aguardando" });
  const preflightRun = useRef(0);
  const micTestRef = useRef(micTest);
  micTestRef.current = micTest;

  const load = (search = queueSearch) => {
    void Promise.all([
      api<{ rows: Lead[] }>(`/wolf/worklist?page=1&pageSize=50${search ? `&search=${encodeURIComponent(search)}` : ""}`),
      api<{ rows: Call[] }>("/wolf/calls?page=1&pageSize=20"),
      api<AudioStatus>("/wolf/audio/capabilities"),
      api<Readiness>("/wolf/readiness", { signal: AbortSignal.timeout(45_000) }),
    ])
      .then(([l, h, a, r]) => {
        setLeads(l.rows);
        setHistory(h.rows);
        setAudio(a);
        setReadiness(r);
        const active = h.rows.find((item) => item.status === "listening");
        if (active && localStorage.getItem("wolf-active-call")) setRecovery(active);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Falha ao carregar THE WOLF."));
  };
  async function refreshMicrophones() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
      (device) => device.kind === "audioinput",
    );
    setMicDevices(devices);
    const saved = localStorage.getItem("wolf-mic-device") ?? "";
    setMicDevice((current) => current || saved || devices[0]?.deviceId || "");
  }
  async function importWolfLeads(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setWolfImporting(true);
    setWolfImportMessage("");
    setError("");
    try {
      const content = await file.text();
      const preview = await api<{
        rows: Array<{ phone: string | null; status: string }>;
        summary: { valid: number; invalid: number };
      }>("/imports/preview", { method: "POST", body: JSON.stringify({ content }) });
      const phones = [
        ...new Set(
          preview.rows
            .filter((row) => (row.status === "valid" || row.status === "duplicate_existing") && row.phone)
            .map((row) => row.phone!),
        ),
      ];
      if (!phones.length) throw new Error("Nenhum telefone válido foi encontrado no arquivo.");
      if (!window.confirm(`Adicionar ${phones.length} leads à fila do THE WOLF?`)) return;
      const result = await api<{ imported: number; skipped: number; existing?: number }>("/imports/commit", {
        method: "POST",
        body: JSON.stringify({
          batch: {
            name: `THE WOLF — ${file.name}`.slice(0, 120),
            source: `THE WOLF — ${file.name}`.slice(0, 200),
            context: "Leads enviados explicitamente para ligações.",
            notes: "Importação operacional THE WOLF",
            initialStrategy: "",
            authorized: true,
            priority: 5,
            startDate: new Date().toISOString().slice(0, 10),
            dailyLimit: null,
          },
          phones,
        }),
      });
      setWolfImportMessage(
        `Importação concluída: ${result.imported} novos, ${result.existing ?? result.skipped} já existentes vinculados, ${preview.summary.invalid} inválidos.`,
      );
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao importar leads para o THE WOLF.");
    } finally {
      setWolfImporting(false);
    }
  }
  useEffect(() => {
    load();
    void refreshMicrophones();
    void api<{ devices?: OutputDevice[]; defaultMultimedia?: { id?: string } }>("/wolf/audio/devices")
      .then((result) => {
        setOutputDevices(result.devices ?? []);
        setOutputDevice((current) => current || result.defaultMultimedia?.id || result.devices?.[0]?.id || "");
      }).catch(() => undefined);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => load(queueSearch), 250);
    return () => window.clearTimeout(timer);
  }, [queueSearch]);

  function downsample(input: Float32Array, from: number, to: number) {
    return resampleFloat32ToPcm16(input, from, to);
  }
  function stopCapture() {
    capture.current?.stop();
    capture.current = null;
  }
  function encodeWav(samples: Float32Array, sampleRate: number) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const write = (offset: number, value: string) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
    write(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); write(8, "WAVE"); write(12, "fmt ");
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, "data"); view.setUint32(40, samples.length * 2, true);
    for (let index = 0; index < samples.length; index++) {
      const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
      view.setInt16(44 + index * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
    }
    return new Blob([buffer], { type: "audio/wav" });
  }
  function micFailureReason() {
    const diagnostic = micDiagnostic.current;
    if (diagnostic.frames === 0) return "Stream abriu, mas o AudioWorklet não recebeu frames.";
    if (diagnostic.rms < AUDIO_SIGNAL_THRESHOLD) return "Microfone aberto, porém sem sinal detectável.";
    if (diagnostic.backendFrames === 0) return "Frontend capturou voz, mas o backend não recebeu frames.";
    if (diagnostic.vad !== "voice") return `Backend recebeu áudio, mas o VAD não detectou voz (RMS ${diagnostic.rms.toFixed(4)}).`;
    if (diagnostic.whisper !== "transcribing") return "VAD detectou voz, mas o Whisper não iniciou a transcrição.";
    const track = stream.current?.getAudioTracks()[0];
    if (!track) return "Whisper retornou vazio ou rejeitou o áudio.";
    if (!track) return "Nenhuma faixa de áudio foi criada.";
    if (track.readyState !== "live") return `A faixa abriu, mas está ${track.readyState}.`;
    if (track.muted) return "Microfone aberto, porém a faixa está muted pelo sistema.";
    return "Whisper retornou vazio ou rejeitou o áudio.";
  }
  function cleanupPreflight() {
    preflightRun.current += 1;
    if (preflightTimer.current !== null) {
      window.clearTimeout(preflightTimer.current);
      preflightTimer.current = null;
    }
    preflightAbort.current?.abort();
    preflightAbort.current = null;
    preflightSocket.current?.close();
    preflightSocket.current = null;
    stopCapture();
    preflightInFlight.current = false;
    setMicLevel(0);
  }
  useEffect(
    () => () => {
      cleanupPreflight();
      sockets.current.forEach((socket) => socket.close());
      sockets.current = [];
    },
    [],
  );
  async function createCapture(
    onSamples: (samples: Float32Array, sampleRate: number) => void,
  ): Promise<Capture> {
    stopCapture();
    const media = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(micDevice ? { deviceId: { exact: micDevice } } : {}),
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    void refreshMicrophones();
    stream.current = media;
    const context = new AudioContext();
    audioContext.current = context;
    await context.audioWorklet.addModule("/wolf-audio-worklet.js");
    const source = context.createMediaStreamSource(media);
    const node = new AudioWorkletNode(context, "wolf-capture");
    worklet.current = node;
    node.port.onmessage = (event: MessageEvent<{ samples: Float32Array }>) => {
      setMicFrames((current) => {
        micDiagnostic.current.frames = current + 1;
        return current + 1;
      });
      onSamples(event.data.samples, context.sampleRate);
    };
    source.connect(node);
    const silentGain = context.createGain();
    silentGain.gain.value = 0;
    node.connect(silentGain);
    silentGain.connect(context.destination);
    const track = media.getAudioTracks()[0];
    const settings = track?.getSettings();
    setMicInputRate(context.sampleRate);
    setMicTrackInfo({
      label: track?.label ?? "desconhecido",
      readyState: track?.readyState ?? "unknown",
      enabled: track?.enabled ?? false,
      muted: track?.muted ?? false,
      sampleRate: settings?.sampleRate ?? context.sampleRate,
      channelCount: settings?.channelCount ?? 1,
      deviceId: settings?.deviceId ? `…${settings.deviceId.slice(-4)}` : "não informado",
    });
    return {
      stop: () => {
        node.port.onmessage = null;
        node.disconnect();
        silentGain.disconnect();
        source.disconnect();
        media.getTracks().forEach((track) => track.stop());
        void context.close();
        if (worklet.current === node) worklet.current = null;
        if (audioContext.current === context) audioContext.current = null;
        stream.current = null;
      },
    };
  }
  async function testMicrophone() {
    if (preflightInFlight.current) return;
    preflightInFlight.current = true;
    const runId = ++preflightRun.current;
    micDiagnostic.current = { frames: 0, backendFrames: 0, rms: 0, peak: 0, vad: "aguardando", whisper: "aguardando" };
    setError("");
    setMicTest("testing");
    setMicTranscript("");
    setMicFrames(0);
    setMicBackendFrames(0);
    setMicRms(0);
    setMicVad("aguardando");
    setMicWhisper("aguardando");
    setMicPeak(0);
    setMicBytesSent(0);
    setMicLocalStatus("gravando localmente");
    if (micRecordingUrl) URL.revokeObjectURL(micRecordingUrl);
    setMicRecordingUrl("");
    const localSamples: number[] = [];
    let localSampleRate = 0;
    let localRms = 0;
    let localPeak = 0;
    let token: string | null;
    try {
      token = await getValidAccessToken();
    } catch (e) {
      setMicTest("failed");
      setError(e instanceof Error ? e.message : "Sessão indisponível para testar o microfone.");
      cleanupPreflight();
      return;
    }
    const protocol = API_URL.startsWith("https") ? "wss" : "ws";
    const socket = new WebSocket(
      `${protocol}://${API_URL.replace(/^https?:\/\//, "")}/wolf/preflight/audio?speaker=operator&token=${encodeURIComponent(token ?? "")}`,
    );
    preflightSocket.current = socket;
    const abort = new AbortController();
    preflightAbort.current = abort;
    const fail = (message: string) => {
      if (!preflightInFlight.current || preflightRun.current !== runId) return;
      setMicTest("failed");
      if (localSamples.length > 0) {
        setMicLocalStatus(`CAPTURA LOCAL OK · ${message}`);
        setError("");
      } else setError(message);
      cleanupPreflight();
    };
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as {
          type?: string;
          kind?: string;
          text?: string;
          message?: string;
          backendFrames?: number;
          rms?: number;
          vad?: string;
          whisper?: string;
          bytesReceived?: number;
        };
        if (message.backendFrames !== undefined) { setMicBackendFrames(message.backendFrames); micDiagnostic.current.backendFrames = message.backendFrames; }
        if (message.rms !== undefined) { setMicRms(message.rms); micDiagnostic.current.rms = message.rms; }
        if (message.vad) { setMicVad(message.vad); micDiagnostic.current.vad = message.vad; }
        if (message.whisper) { setMicWhisper(message.whisper); micDiagnostic.current.whisper = message.whisper; }
        if (message.bytesReceived) setMicBytesSent(message.bytesReceived);
        if (message.type === "transcript" && message.kind === "final" && message.text?.trim()) {
          setMicTranscript(message.text.trim());
          setMicTest("ok");
          setMicLocalStatus("MICROFONE PRONTO · captura, backend, VAD e Whisper OK");
          setError("");
          cleanupPreflight();
        } else if (message.type === "error") fail(message.message ?? "Falha no teste de microfone.");
      } catch {
        fail("Resposta inválida do teste de microfone.");
      }
    };
    socket.onerror = () => fail("Não foi possível abrir o teste de microfone.");
    socket.onclose = () => {
      if (preflightInFlight.current) fail(localSamples.length ? micFailureReason() : "O WebSocket do microfone foi encerrado antes da captura.");
    };
    try {
      preflightTimer.current = window.setTimeout(() => {
        if (micTestRef.current === "testing") fail(micFailureReason());
      }, 20_000);
      await new Promise<void>((resolve, reject) => {
        let timer: number | null = null;
        const onAbort = () => finish(new Error("Teste de microfone cancelado."));
        const finish = (error?: Error) => {
          if (timer !== null) window.clearTimeout(timer);
          abort.signal.removeEventListener("abort", onAbort);
          error ? reject(error) : resolve();
        };
        const check = () =>
          socket.readyState === WebSocket.OPEN
            ? finish()
            : socket.readyState === WebSocket.CLOSED
              ? finish(new Error("WebSocket fechado"))
              : (timer = window.setTimeout(check, 20));
        abort.signal.addEventListener("abort", onAbort, { once: true });
        check();
      });
      capture.current = await createCapture((samples, sampleRate) => {
        localSampleRate = sampleRate;
        const rms = Math.sqrt(
          samples.reduce((sum, value) => sum + value * value, 0) / Math.max(1, samples.length),
        );
        const peak = samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
        localRms = Math.max(localRms, rms);
        localPeak = Math.max(localPeak, peak);
        micDiagnostic.current.rms = rms;
        micDiagnostic.current.peak = peak;
        setMicPeak(peak);
        micDiagnostic.current.peak = peak;
        setMicRms(rms);
        setMicLevel(Math.min(1, rms * 8));
        localSamples.push(...samples);
      });
      await new Promise<void>((resolve) => window.setTimeout(resolve, 5_000));
      stopCapture();
      const recording = Float32Array.from(localSamples);
      setMicRecordingUrl(URL.createObjectURL(encodeWav(recording, localSampleRate || 48000)));
      if (localRms < AUDIO_SIGNAL_THRESHOLD || localPeak < LOCAL_PEAK_THRESHOLD) {
        setMicLocalStatus("Microfone aberto, porém sem sinal.");
        fail("CAPTURA LOCAL DO MICROFONE FALHOU: microfone aberto, porém sem sinal.");
        return;
      }
      setError("");
      setMicLocalStatus("CAPTURA LOCAL OK · enviando o mesmo áudio ao backend");
      if (preflightTimer.current !== null) window.clearTimeout(preflightTimer.current);
      preflightTimer.current = window.setTimeout(() => {
        if (micTestRef.current === "testing") fail(micFailureReason());
      }, 20_000);
      setMicLocalStatus("captura local OK; enviando para Whisper");
      const pcm = new Uint8Array(downsample(recording, localSampleRate || 48000, 24000));
      for (let offset = 0; offset < pcm.byteLength; offset += 4800) {
        const chunk = pcm.slice(offset, Math.min(offset + 4800, pcm.byteLength));
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(chunk);
          setMicBytesSent((current) => current + chunk.byteLength);
        }
      }
      for (let index = 0; index < 10; index++) if (socket.readyState === WebSocket.OPEN) socket.send(new Uint8Array(4800));
      setMicLocalStatus("aguardando VAD/Whisper");
      if (abort.signal.aborted) {
        stopCapture();
        return;
      }
    } catch (e) {
      fail(e instanceof Error ? e.message : "Permissão ou captura de microfone indisponível.");
    }
  }
  async function testClientAudio() {
    if (clientPreflightInFlight.current) return;
    clientPreflightInFlight.current = true;
    setClientTest("testing");
    setClientAudioState("AGUARDANDO ÁUDIO DO COMPUTADOR...");
    setClientTranscript("");
    setClientPartial(""); setClientSignal(false); setClientWhisper("aguardando"); setClientRms(0); setClientPeak(0); setClientFrames(0); setClientBytes(0);
    try {
      const token = await getValidAccessToken();
      const protocol = API_URL.startsWith("https") ? "wss" : "ws";
      const socket = new WebSocket(
        `${protocol}://${API_URL.replace(/^https?:\/\//, "")}/wolf/preflight/client-audio?token=${encodeURIComponent(token ?? "")}`,
      );
      const clientSocketTimeout = window.setTimeout(() => socket.close(), 15_000);
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(
          () =>
            reject(new Error("Helper conectado, mas nenhum áudio do Windows foi detectado em 15 segundos.")),
          15_000,
        );
        socket.onopen = () => resolve();
        socket.onclose = () => reject(new Error("O teste de áudio do cliente foi encerrado antes do resultado."));
        socket.onerror = () => {
          window.clearTimeout(timer);
          reject(new Error("Não foi possível conectar ao teste de áudio do cliente."));
        };
        socket.onmessage = (event) => {
          try {
            const message = JSON.parse(String(event.data)) as {
              type?: string;
              kind?: string;
              text?: string;
              backendFrames?: number;
              bytesReceived?: number;
              rms?: number;
              peak?: number;
              vad?: string;
              audioBytes?: number;
              frames?: number;
              speechDetected?: boolean;
              final?: boolean;
              partialText?: string;
              transcriptionMs?: number;
              whisper?: string;
              message?: string;
            };
            if (message.backendFrames !== undefined) setClientFrames(message.backendFrames);
            if (message.bytesReceived !== undefined) setClientBytes(message.bytesReceived);
            if (message.audioBytes !== undefined) setClientBytes((current) => current + message.audioBytes!);
            if (message.rms !== undefined) setClientRms(message.rms);
            if (message.peak !== undefined) setClientPeak(message.peak);
            if (message.vad) setClientVad(message.vad);
            if (message.rms !== undefined && message.rms > AUDIO_SIGNAL_THRESHOLD) { setClientSignal(true); setClientAudioState("SINAL DETECTADO"); }
            if (message.type === "gateway_diagnostic") setClientAudioState("SINAL DETECTADO");
            if (message.type === "diagnostic" && message.speechDetected) { setClientAudioState("VOZ DETECTADA"); setClientWhisper(message.whisper ?? "aguardando"); }
            if (message.type === "diagnostic" && message.whisper === "transcribing") setClientAudioState("TRANSCREVENDO...");
            if (message.type === "transcript" && message.kind === "partial" && message.text?.trim()) { setClientPartial(message.text.trim()); setClientAudioState(`OUVINDO: ${message.text.trim()}`); }
            if (message.type === "transcript" && message.kind === "final" && message.text?.trim()) {
              setClientTranscript(message.text.trim());
              setClientPartial(""); setClientWhisper("final"); if (message.transcriptionMs) setClientLatency(message.transcriptionMs);
              setClientTest("ok");
              setClientAudioState("✅ ÁUDIO DO CLIENTE PRONTO");
              window.clearTimeout(timer);
              socket.close();
            }
            if (message.type === "error") {
              window.clearTimeout(timer);
              reject(new Error(message.message ?? "Falha na transcrição do áudio do cliente."));
            }
          } catch {
            /* ignore malformed diagnostics */
          }
        };
      });
      window.clearTimeout(clientSocketTimeout);
      const status = await api<AudioStatus>("/wolf/audio/capabilities");
      setAudio(status);
    } catch (e) {
      setClientTest("failed");
      setError(e instanceof Error ? e.message : "Falha ao testar áudio do cliente.");
      setClientAudioState(e instanceof Error ? e.message : "Áudio do cliente não detectado.");
    } finally {
      clientPreflightInFlight.current = false;
    }
  }
  async function enableMic(callId: string) {
    const token = await getValidAccessToken();
    const protocol = API_URL.startsWith("https") ? "wss" : "ws";
    const socket = new WebSocket(
      `${protocol}://${API_URL.replace(/^https?:\/\//, "")}/wolf/calls/${callId}/audio?channel=operator&token=${encodeURIComponent(token ?? "")}`,
    );
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as {
        type?: string;
        kind?: string;
        text?: string;
        message?: string;
        faleAgora?: string;
        speaker?: string;
      };
      if (message.type === "transcript" && message.kind === "partial" && message.text)
        setSuggestionState("client");
      if (message.type === "transcript" && message.kind === "final" && message.text)
        setTurns((current) => [
          ...current,
          { speaker: (message.speaker === "client" ? "client" : "operator"), text: message.text!, createdAt: new Date().toISOString() },
        ]);
      if (message.type === "suggestion" && message.faleAgora) {
        setSuggestion(message.faleAgora);
        setSuggestionState("ready");
      }
      if (message.type === "error") {
        setSuggestionState("error");
        setError(message.message ?? "Falha na transcrição em tempo real.");
      }
    };
    sockets.current.push(socket);
    const clientSocket = new WebSocket(
      `${protocol}://${API_URL.replace(/^https?:\/\//, "")}/wolf/calls/${callId}/audio?channel=client&token=${encodeURIComponent(token ?? "")}`,
    );
    clientSocket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as { type?: string; kind?: string; text?: string; speaker?: string; faleAgora?: string; strategy?: string; rms?: number; peak?: number; vad?: string; speechDetected?: boolean };
        if (message.type === "diagnostic") {
          if (message.rms !== undefined) setClientRms(message.rms);
          if (message.peak !== undefined) setClientPeak(message.peak);
          if (message.vad) setClientVad(message.vad);
          if (message.speechDetected) setClientAudioState("CLIENTE falando · sinal real detectado");
        }
        if (message.type === "transcript" && message.kind === "partial") setSuggestionState("client");
        if (message.type === "transcript" && message.kind === "final" && message.text)
          setTurns((current) => [...current, { speaker: "client", text: message.text!, createdAt: new Date().toISOString() }]);
        if (message.type === "suggestion" && message.faleAgora) { setSuggestion(message.faleAgora); setSuggestionState("ready"); }
        if (message.type === "error") setError(message.text ?? "Falha no áudio do cliente.");
      } catch { /* ignore malformed realtime event */ }
    };
    sockets.current.push(clientSocket);
    capture.current = await createCapture((samples, sampleRate) => {
      const rms = Math.sqrt(
        samples.reduce((sum, value) => sum + value * value, 0) / Math.max(1, samples.length),
      );
      setMicLevel(Math.min(1, rms * 8));
      if (socket.readyState === WebSocket.OPEN) socket.send(downsample(samples, sampleRate, 24000));
    });
  }
  function stopMic() {
    cleanupPreflight();
    sockets.current.forEach((socket) => socket.close());
    sockets.current = [];
    setMicLevel(0);
  }
  async function start(direction: Call["direction"]) {
    if (direction === "outbound" && !selected) return;
    setBusy(true);
    setError("");
    try {
      await api("/wolf/ai/start", { method: "POST" });
      const current = readiness ?? (await api<Readiness>("/wolf/readiness"));
      setReadiness(current);
      if (!current.ready || micTest !== "ok" || clientTest !== "ok")
        throw new Error("Conclua os testes reais de microfone e áudio do cliente antes de iniciar.");
      const testSession = selected?.id === "";
      const created = await api<Call>("/wolf/calls", {
        method: "POST",
        body: JSON.stringify({ leadId: testSession ? null : selected?.id ?? null, direction, testSession, phone: testSession ? selected?.phone : undefined }),
      });
      localStorage.setItem(
        "wolf-active-call",
        JSON.stringify({ callId: created.id, leadId: created.leadId }),
      );
      setCall(created);
      setAttendanceLead(null);
      setRecovery(null);
      setTurns([]);
      setSuggestion(
        selected?.name
          ? `Oi ${selected.name.split(" ")[0]}, aqui é o Pedro da Renova123. Posso falar com você rapidinho?`
          : "Oi, tudo bem? Aqui é o Pedro da Renova123. Posso falar com você rapidinho?",
      );
      setSuggestionState("ready");
      await enableMic(created.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao iniciar.");
    } finally {
      setBusy(false);
    }
  }
  async function suggest(alternative: boolean) {
    if (!call) return;
    setBusy(true);
    setSuggestionState("analyzing");
    try {
      const result = await api<{ faleAgora?: string }>(`/wolf/calls/${call.id}/suggest`, {
        method: "POST",
        body: JSON.stringify({ alternative }),
        signal: AbortSignal.timeout(12_000),
      });
      if (result.faleAgora) {
        setSuggestion(result.faleAgora);
        setSuggestionState("ready");
      } else setSuggestionState("error");
    } catch (e) {
      setSuggestionState("error");
      setError(e instanceof Error ? e.message : "Erro ao gerar FALE AGORA.");
    } finally {
      setBusy(false);
    }
  }
  async function finish() {
    if (!call) return;
    setBusy(true);
    stopMic();
    try {
      const result = await api<Call>(`/wolf/calls/${call.id}/finish`, { method: "POST" });
      setCall(result);
      setReview({
        summary: result.summary ?? "",
        result: result.result ?? "Interessado",
        nextAction: "",
        followUpDate: "",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao encerrar.");
    } finally {
      setBusy(false);
    }
  }
  async function saveReview() {
    if (!call) return;
    if (review.result === "Retornar depois" && !review.followUpDate) {
      setError("Informe a data e hora do retorno.");
      return;
    }
    setBusy(true);
    try {
      const followUpDate = review.followUpDate ? new Date(review.followUpDate).toISOString() : null;
      if (!call.leadId) {
        await api(`/wolf/calls/${call.id}/discard`, { method: "POST" });
        await api("/wolf/ai/stop", { method: "POST" }).catch(() => undefined);
        localStorage.removeItem("wolf-active-call");
        setCall(null);
        setSelected(null);
        load();
        return;
      }
      await api(`/wolf/calls/${call.id}/review`, {
        method: "PATCH",
        body: JSON.stringify({ ...review, followUpDate }),
      });
      if (call.leadId) {
        const map: Record<string, string> = {
          Interessado: "interested",
          "Demo agendada": "interested",
          "Sem interesse": "not_interested",
          "Já tem sistema": "has_system",
          Convertido: "converted",
          "Não atendeu": "no_answer",
          "Retornar depois": "callback",
        };
        await api(`/wolf/leads/${call.leadId}/result`, {
          method: "POST",
          body: JSON.stringify({
            status: map[review.result] ?? "answered",
            callId: call.id,
            nextCallAt: followUpDate,
          }),
        });
      }
      await api("/wolf/ai/stop", { method: "POST" }).catch(() => undefined);
      localStorage.removeItem("wolf-active-call");
      setSelected(
        leads.find((lead) => lead.id !== call.leadId && !["interested", "converted", "not_interested", "no_interest", "has_system", "closed"].includes(String(lead.wolfState?.status)) && !lead.wolfState?.nextCallAt) ?? null,
      );
      setCall(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao salvar revisão.");
    } finally {
      setBusy(false);
    }
  }
  const readyToCall = readiness?.ready === true && micTest === "ok" && clientTest === "ok";
  const status = readyToCall ? "READY" : readiness?.ready ? "PREPARANDO" : "OFF";
  const leadCounts = leads.reduce<Record<string, number>>((acc, lead) => {
    const key = String(lead.wolfState?.status ?? "not_called");
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const returnLeads = leads.filter((lead) => Boolean(lead.wolfState?.nextCallAt));
  const activeQueue = leads.filter((lead) => !["interested", "converted", "not_interested", "no_interest", "has_system", "closed"].includes(String(lead.wolfState?.status)) && !lead.wolfState?.nextCallAt);
  const hasSystemLeads = leads.filter((lead) => String(lead.wolfState?.status) === "has_system");
  const noInterestLeads = leads.filter((lead) => ["not_interested", "no_interest"].includes(String(lead.wolfState?.status)));
  const noAnswerLeads = leads.filter((lead) => String(lead.wolfState?.status) === "no_answer");
  const interestedLeads = leads.filter((lead) => String(lead.wolfState?.status) === "interested");
  const convertedLeads = leads.filter((lead) => String(lead.wolfState?.status) === "converted");
  const todayLeads = activeQueue;
  const nextLead = todayLeads[0] ?? null;
  const baseQueue = wolfView === "returns" ? returnLeads : wolfView === "no_answer" ? noAnswerLeads : wolfView === "has_system" ? hasSystemLeads : wolfView === "interested" ? interestedLeads : wolfView === "no_interest" ? noInterestLeads : wolfView === "converted" ? convertedLeads : wolfView === "all" ? leads : wolfView === "leads" ? leads : activeQueue;
  const visibleQueue = baseQueue.filter((lead) => `${lead.name ?? ""} ${lead.company ?? ""} ${lead.phone}`.toLocaleLowerCase().includes(queueSearch.toLocaleLowerCase()));
  const isQueueView = ["today", "leads", "returns", "no_answer", "has_system", "interested", "no_interest", "converted", "all"].includes(wolfView);
  async function loadLeadHistory(leadId: string) {
    try {
      const result = await api<{ rows: LeadEvent[] }>(`/wolf/leads/${leadId}/history`);
      setAttendanceHistory(result.rows);
    } catch {
      setAttendanceHistory([]);
    }
  }
  async function openAttendance(lead: Lead) {
    setSelected(lead);
    setAttendanceLead(lead);
    setCallbackDraft("");
    void loadLeadHistory(lead.id);
    try {
      const session = await api<Call>("/wolf/calls", { method: "POST", body: JSON.stringify({ leadId: lead.id, direction: "outbound", status: "preparing" }) });
      setAttendanceSession(session);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível abrir o atendimento.");
    }
  }
  async function openTestSession() {
    const phone = testPhone.trim();
    if (phone.length < 8) {
      setError("Informe um telefone válido para o modo teste.");
      return;
    }
    setBusy(true);
    try {
      const session = await api<Call>("/wolf/test-sessions", { method: "POST", body: JSON.stringify({ phone }) });
      setAttendanceSession(session);
      setAttendanceLead({ id: "", name: "MODO TESTE", company: "Sessão isolada", phone });
      setSelected({ id: "", name: "MODO TESTE", company: "Sessão isolada", phone });
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível abrir o modo teste.");
    } finally {
      setBusy(false);
    }
  }
  async function closeAttendance() {
    if (attendanceSession?.id) await api(`/wolf/calls/${attendanceSession.id}/discard`, { method: "POST" }).catch(() => undefined);
    setAttendanceSession(null);
    setAttendanceLead(null);
  }
  async function saveDirectResult(status: string, nextCallAt: string | null = null) {
    if (!attendanceLead) return;
    if (attendanceLead.id === "") {
      if (attendanceSession?.id) await api(`/wolf/calls/${attendanceSession.id}/discard`, { method: "POST" }).catch(() => undefined);
      setAttendanceHistory([]);
      setAttendanceLead(null);
      setAttendanceSession(null);
      setSelected(null);
      setError("");
      return;
    }
    if (status === "callback" && !nextCallAt) {
      setError("Escolha a data e hora do retorno.");
      return;
    }
    setBusy(true);
    try {
      await api(`/wolf/leads/${attendanceLead.id}/result`, {
        method: "POST",
        body: JSON.stringify({ status, nextCallAt: nextCallAt ? new Date(nextCallAt).toISOString() : null }),
      });
      if (attendanceSession?.id) await api(`/wolf/calls/${attendanceSession.id}/discard`, { method: "POST" }).catch(() => undefined);
      setError("");
      setAttendanceHistory([]);
      setAttendanceLead(null);
      setAttendanceSession(null);
      setSelected(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível salvar o resultado.");
    } finally {
      setBusy(false);
    }
  }
  function selectLead(lead: Lead) {
    if (selected?.id === lead.id) openAttendance(lead);
    else setSelected(lead);
  }
  function openWhatsApp(lead: Lead) {
    const phone = lead.phone.replace(/\D/g, "");
    window.open(`https://web.whatsapp.com/send?phone=${phone}`, "_blank", "noopener,noreferrer");
  }
  const answered = history.filter((item) =>
    ["answered", "interested", "converted"].includes(String(item.result)),
  ).length;
  const interested = history.filter((item) =>
    ["interested", "converted"].includes(String(item.result)),
  ).length;
  const converted = history.filter((item) => String(item.result) === "converted").length;
  if (call?.status === "review")
    return (
      <div className="page-stack wolf-page">
        <PageHeader pageKey="wolfCalls" />
        <section className="card wolf-review">
          <span>REVISAR LIGAÇÃO</span>
          <h1>Confirme o resultado antes de salvar</h1>
          <label>
            Resumo
            <textarea
              value={review.summary}
              onChange={(e) => setReview({ ...review, summary: e.target.value })}
              rows={5}
            />
          </label>
          <label>
            Próximo passo
            <input
              value={review.nextAction}
              onChange={(e) => setReview({ ...review, nextAction: e.target.value })}
            />
          </label>
          <label>
            Resultado
            <select value={review.result} onChange={(e) => setReview({ ...review, result: e.target.value })}>
              <option>Interessado</option>
              <option>Já tem sistema</option>
              <option>Convertido</option>
              <option>Retornar depois</option>
              <option>Demo agendada</option>
              <option>Sem interesse</option>
              <option>Não atendeu</option>
            </select>
          </label>
          {review.result === "Retornar depois" ? (
            <label>
              Data e hora do retorno
              <input
                type="datetime-local"
                value={review.followUpDate}
                onChange={(e) => setReview({ ...review, followUpDate: e.target.value })}
              />
            </label>
          ) : null}
          <footer>
            <button className="primary-button" disabled={busy} onClick={() => void saveReview()}>
              SALVAR E IR PARA PRÓXIMO
            </button>
          </footer>
        </section>
      </div>
    );
  if (attendanceLead && !call)
    return (
      <div className="page-stack wolf-page">
        <header className="wolf-top">
          <button className="wolf-back-button" onClick={() => void closeAttendance()}><ArrowLeft /> VOLTAR PARA A FILA</button>
          <div className="wolf-status"><i /> ATENDIMENTO ATIVO</div>
        </header>
        <section className="wolf-attendance-shell">
          <div className="wolf-attendance-main">
            <span className="wolf-eyebrow">ATENDIMENTO</span>
            <h1>{attendanceLead.name || attendanceLead.phone}</h1>
            <p>{attendanceLead.company || "Empresa não informada"} · {attendanceLead.phone}</p>
            <div className="wolf-attendance-facts">
              <span><b>Telefone</b>{attendanceLead.phone}</span>
              <span><b>Origem</b>{attendanceLead.source || attendanceLead.batchSource || "Não informada"}</span>
              <span><b>Tentativas</b>{attendanceLead.wolfState?.totalAttempts ?? 0}</span>
              <span><b>Último resultado</b>{attendanceLead.wolfState?.status || "Não trabalhado"}</span>
              <span><b>Último contato</b>{attendanceLead.wolfState?.lastCallAt ? new Date(attendanceLead.wolfState.lastCallAt).toLocaleString("pt-BR") : "Ainda não"}</span>
              <span><b>Próximo retorno</b>{attendanceLead.wolfState?.nextCallAt ? new Date(attendanceLead.wolfState.nextCallAt).toLocaleString("pt-BR") : "—"}</span>
            </div>
            <div className="wolf-attendance-actions">
              <button className="secondary-button" onClick={() => openWhatsApp(attendanceLead)}>ABRIR WHATSAPP WEB</button>
              <button className="wolf-back-button" onClick={() => void closeAttendance()}>FECHAR ATENDIMENTO</button>
            </div>
            <h2 className="wolf-attendance-section-title">HISTÓRICO DE TENTATIVAS</h2>
            <div className="wolf-lead-history">{attendanceHistory.length ? attendanceHistory.map((event, index) => <article key={event.id}><time>{event.occurredAt ? new Date(event.occurredAt).toLocaleString("pt-BR") : "—"}</time><strong>Tentativa {attendanceHistory.length - index}</strong><span>{({ NO_ANSWER: "Não atendeu", CALLBACK: "Pediu para ligar depois", HAS_SYSTEM: "Já tem sistema", NO_INTEREST: "Sem interesse", INTERESTED: "Interessado", CONVERTED: "Convertido" } as Record<string, string>)[event.eventType] || event.eventType}</span></article>) : <p>Nenhuma tentativa registrada para este lead.</p>}</div>
            <button className="primary-button wolf-begin-button" disabled={busy || !readyToCall} onClick={() => void start("outbound")}>
              <Radio /> COMEÇAR ACOMPANHAMENTO
            </button>
            {!readyToCall ? <small className="wolf-attendance-warning">Abra “Preparar THE WOLF” e conclua os testes reais antes de começar.</small> : null}
          </div>
          <aside className="wolf-now wolf-attendance-script">
            <span>FALE AGORA</span>
            <p>{attendanceLead.name ? `Oi ${attendanceLead.name.split(" ")[0]}, aqui é o Pedro da Renova123. Posso falar com você rapidinho?` : "Oi, tudo bem? Aqui é o Pedro da Renova123. Posso falar com você rapidinho?"}</p>
            <small>Frase inicial sugerida com os dados reais do lead.</small>
            <h2 className="wolf-attendance-section-title">RESULTADO DA LIGAÇÃO</h2>
            <div className="wolf-result-actions">
              <button onClick={() => void saveDirectResult("no_answer")} disabled={busy}>NÃO ATENDEU</button>
              <button onClick={() => setCallbackDraft((current) => current || new Date(Date.now() + 86400000).toISOString().slice(0, 16))} disabled={busy}>PEDIU PARA LIGAR DEPOIS</button>
              <button onClick={() => void saveDirectResult("has_system")} disabled={busy}>JÁ TEM SISTEMA</button>
              <button onClick={() => void saveDirectResult("no_interest")} disabled={busy}>SEM INTERESSE</button>
              <button onClick={() => void saveDirectResult("interested")} disabled={busy}>INTERESSADO</button>
              <button onClick={() => void saveDirectResult("converted")} disabled={busy}>CONVERTIDO</button>
            </div>
            {callbackDraft ? <div className="wolf-callback-box"><label>Data e hora do retorno<input type="datetime-local" value={callbackDraft} onChange={(event) => setCallbackDraft(event.target.value)} /></label><button className="primary-button" onClick={() => void saveDirectResult("callback", callbackDraft)} disabled={busy}>CONFIRMAR RETORNO</button></div> : null}
          </aside>
        </section>
      </div>
    );
  if (call)
    return (
      <div className="page-stack wolf-page">
        <header className="wolf-top">
          <div>
            <span>THE WOLF</span>
            <h1>{selected?.name || selected?.phone || "Ligação sem lead"}</h1>
            <p>{selected?.company || selected?.batchSource || "Origem não informada"}</p>
          </div>
          <div className="wolf-status">
            <i /> CALL ACTIVE
          </div>
        </header>
        {error ? <Feedback kind="error" message={error} onClose={() => setError("")} /> : null}
        <main className="wolf-grid">
          <section className="card wolf-conversation">
            <header>
              <strong>CONVERSA</strong>
              <span>{micRms > AUDIO_SIGNAL_THRESHOLD || micVad === "voice" ? "MICROFONE RECEBENDO" : "MICROFONE AGUARDANDO"}</span>
            </header>
            <div className="wolf-live-meters">
              <small>MINHA VOZ {micRms > AUDIO_SIGNAL_THRESHOLD || micVad === "voice" ? "· OUVINDO" : "· AGUARDANDO"}</small>
              <div className="mic-meter"><i style={{ width: `${Math.round(micLevel * 100)}%` }} /></div>
              <small>CLIENTE {clientRms > AUDIO_SIGNAL_THRESHOLD ? "· SINAL PRESENTE" : "· AGUARDANDO"}</small>
              <div className="mic-meter"><i style={{ width: `${Math.min(100, Math.round(clientRms * 400))}%` }} /></div>
            </div>
            <div className="wolf-turns">
              {turns.map((turn, i) => (
                <article key={turn.id ?? i} className={turn.speaker}>
                  <small>{turn.speaker === "operator" ? "EU" : "CLIENTE"}</small>
                  <p>{turn.text}</p>
                </article>
              ))}
            </div>
            <details>
              <summary>DEV / TESTE</summary>
              <form className="wolf-test-form" onSubmit={(e) => e.preventDefault()}>
                <input
                  value={manual}
                  onChange={(e) => setManual(e.target.value)}
                  placeholder="Texto manual somente para debug"
                />
                <span>Modo manual não valida áudio.</span>
              </form>
            </details>
          </section>
          <aside className="wolf-side">
            <section className="wolf-now">
              <span>FALE AGORA</span>
              <p>
                {suggestionState === "analyzing"
                  ? "ANALISANDO..."
                  : suggestionState === "error"
                    ? "ERRO AO GERAR"
                    : suggestion || "AGUARDANDO CLIENTE"}
              </p>
              <button
                onClick={() => void suggest(true)}
                disabled={busy || !turns.some((turn) => turn.speaker === "client")}
              >
                <WandSparkles /> GERAR OUTRA
              </button>
            </section>
            <section className="card wolf-controls">
              <div>Microfone ● {micLevel > 0.02 ? "RECEBENDO" : "AGUARDANDO"}</div>
              <div>Cliente ● {clientAudioState}</div>
              <div>
                <Volume2 /> Whisper ● {audio?.transcription.model ?? "não configurado"}
              </div>
              <div>Qwen ● {readiness?.checks.qwenWarm ? "AQUECIDO" : "AGUARDANDO"}</div>
              <button className="danger-button" onClick={() => void finish()} disabled={busy}>
                <Square /> ENCERRAR LIGAÇÃO
              </button>
            </section>
          </aside>
        </main>
      </div>
    );
  return (
    <div className="page-stack">
      <PageHeader pageKey="wolfCalls" />
      {error ? <Feedback kind="error" message={error} onClose={() => setError("")} /> : null}
      <nav className="wolf-tabs" aria-label="Áreas de ligações">
        {(
          [
            ["today", `FILA ATIVA · ${activeQueue.length}`],
            ["returns", `RETORNOS · ${returnLeads.length}`],
            ["no_answer", `NÃO ATENDEU · ${noAnswerLeads.length}`],
            ["has_system", `JÁ TEM SISTEMA · ${hasSystemLeads.length}`],
            ["interested", `INTERESSADOS · ${interestedLeads.length}`],
            ["no_interest", `SEM INTERESSE · ${noInterestLeads.length}`],
            ["converted", `CONVERTIDOS · ${convertedLeads.length}`],
            ["all", `TODOS · ${leads.length}`],
            ["performance", "Desempenho"],
            ["prep", "Preparar THE WOLF"],
          ] as const
        ).map(([key, label]) => (
          <button key={key} className={wolfView === key ? "active" : ""} onClick={() => setWolfView(key)}>
            {label}
          </button>
        ))}
      </nav>
      {wolfImportMessage ? <Feedback kind="success" message={wolfImportMessage} /> : null}
      {recovery ? (
        <section className="card">
          <strong>RECUPERAÇÃO DE LIGAÇÃO</strong>
          <p>Existe uma ligação em andamento salva nesta sessão.</p>
          <button
            className="primary-button"
            onClick={() => {
              setCall(recovery);
              setRecovery(null);
              void enableMic(recovery.id);
            }}
          >
            RETOMAR LIGAÇÃO
          </button>
          <button
            className="secondary-button"
            onClick={() => {
              localStorage.removeItem("wolf-active-call");
              setRecovery(null);
            }}
          >
            DESCARTAR RECUPERAÇÃO
          </button>
        </section>
      ) : null}
      <section className="card wolf-landing">
        <div className="wolf-hero">
          <Radio />
          <div>
            <span>THE WOLF</span>
            <h2>PREPARAÇÃO DA LIGAÇÃO</h2>
            <p>
              Estado atual: <strong>{status}</strong>
            </p>
            {readiness && !readiness.ready ? <small>{readiness.reasons.join(" ")}</small> : null}
          </div>
        </div>
        {isQueueView ? (
          <>
          <div className="wolf-today-layout">
            {[["FILA", activeQueue.length, "today"], ["RETORNOS", returnLeads.length, "returns"], ["JÁ TEM SISTEMA", hasSystemLeads.length, "results"], ["INTERESSADOS", interestedLeads.length, "results"], ["CONVERTIDOS", convertedLeads.length, "results"]].map(([label, count, view]) => <button key={String(label)} className={`wolf-today-stat ${wolfView === view ? "selected" : ""}`} onClick={() => setWolfView(view as typeof wolfView)}><span>{label}</span><strong>{count}</strong></button>)}
            <section className="wolf-next-card">
              <span className="wolf-eyebrow">PRÓXIMO DA FILA</span>
              {nextLead ? <><strong>{nextLead.name || nextLead.phone}</strong><p>{nextLead.company || "Empresa não informada"} · {nextLead.phone}</p><small>{nextLead.wolfState?.totalAttempts ?? 0} tentativa(s) · último resultado: {nextLead.wolfState?.status || "não trabalhado"}</small><button className="primary-button" onClick={() => openAttendance(nextLead)}>ABRIR ATENDIMENTO</button></> : <p>Nenhum lead pendente agora.</p>}
            </section>
            <section className="wolf-today-queue">
              <header><strong>{wolfView === "today" ? "FILA ÚNICA DE LIGAÇÕES" : "LEADS"}</strong><label className="wolf-queue-search"><input value={queueSearch} onChange={(event) => setQueueSearch(event.target.value)} placeholder="Buscar nome, empresa ou telefone" aria-label="Buscar na fila" /><span>{visibleQueue.length} leads</span></label></header>
              {visibleQueue.slice(0, 50).map((lead, index) => <article key={lead.id} className={`wolf-queue-row ${selected?.id === lead.id ? "selected" : ""}`}><span className="wolf-queue-index">#{String(index + 1).padStart(3, "0")}</span><span><strong>{lead.name || lead.phone}</strong><small>{lead.company || "Empresa não informada"} · {lead.phone}</small><small>{lead.wolfState?.totalAttempts ?? 0} tentativa(s) · {lead.wolfState?.status || "não trabalhado"}</small></span><span className="wolf-queue-actions"><button onClick={() => selectLead(lead)}>SELECIONAR</button><button onClick={() => openAttendance(lead)}>ABRIR ATENDIMENTO</button><button onClick={() => openWhatsApp(lead)}>WHATSAPP WEB</button></span></article>)}
              {visibleQueue.length > 50 ? <small className="wolf-list-note">Mostrando os primeiros 50. Use a busca/paginação para continuar.</small> : null}
            </section>
          </div>
          </>
        ) : null}
        {wolfView === "prep" ? (
          <>
            <section className="card wolf-test-session">
              <strong>MODO TESTE ISOLADO</strong>
              <p>Use um telefone arbitrário para testar a ligação. Esta sessão não entra na fila, nos resultados ou nas métricas comerciais.</p>
              <div className="wolf-device-row"><label>Telefone de teste<input value={testPhone} onChange={(event) => setTestPhone(event.target.value)} placeholder="5511999999999" /></label><button onClick={() => void openTestSession()} disabled={busy}>ABRIR TESTE</button></div>
            </section>
            <div className="wolf-preflight">
            <div className="wolf-preflight-card wolf-mic-card">
              <header><div><strong>Microfone</strong><small>{micTrackInfo?.label || "Dispositivo não testado"}</small></div><span className={`wolf-status-badge ${micTest === "ok" ? "ok" : micTest === "failed" ? "failed" : micTest === "testing" ? "testing" : "idle"}`}>{micTest === "ok" ? "PRONTO" : micTest === "failed" ? "TRANSCRIÇÃO NÃO CONFIRMADA" : micTest === "testing" ? "TESTANDO" : "NÃO TESTADO"}</span></header>
              <p>{micTest === "ok" ? `Ouvi: “${micTranscript}”` : micTest === "failed" && micRecordingUrl ? "Sua voz foi capturada com sucesso, mas a transcrição ainda não foi confirmada." : micTest === "testing" ? "Gravando 5 segundos. Fale uma frase." : "Capture e confirme sua voz antes da ligação."}</p>
              <div className="mic-meter">
                <i style={{ width: `${Math.round(micLevel * 100)}%` }} />
              </div>
              <small className="wolf-diagnostic">
                {micLocalStatus} · RMS: {micRms.toFixed(4)} · Peak: {micPeak.toFixed(4)} · Input: {micInputRate || "—"} Hz
              </small>
              {micRecordingUrl ? <audio controls src={micRecordingUrl} /> : null}
              {micRecordingUrl ? <small className="wolf-stage-ok">✓ CAPTURA LOCAL · ✓ PLAYBACK DISPONÍVEL</small> : null}
              <button onClick={() => void testMicrophone()} disabled={micTest === "testing"}>
                TESTAR MICROFONE
              </button>
              {micTest === "failed" && micRecordingUrl ? <small className="wolf-stage-warning">⚠️ Captura local OK; falha posterior: {micLocalStatus.replace("CAPTURA LOCAL OK · ", "")}</small> : null}
              {clientTest === "testing" ? (
                <small className="wolf-diagnostic">
                  Frames gateway/backend: {audio?.helper.audioFrames || clientFrames || "aguardando"} · Bytes gateway: {audio?.helper.audioBytes || "aguardando"} · Reproduza uma voz no computador.
                </small>
              ) : null}
              {clientTest === "ok" ? (
                <small className="wolf-diagnostic">Ouvi: “{clientTranscript}”</small>
              ) : null}
            </div>
            <div className="wolf-preflight-card">
              <header><div><strong>Áudio do cliente</strong><small>WASAPI / helper independente</small></div><span className={`wolf-status-badge ${clientTest === "ok" ? "ok" : clientTest === "failed" ? "failed" : clientTest === "testing" ? "testing" : "idle"}`}>{clientTest === "ok" ? "PRONTO" : clientTest === "failed" ? "FALHOU" : clientTest === "testing" ? "TESTANDO" : "NÃO TESTADO"}</span></header>
              <p>
                {clientTest === "ok"
                  ? "Áudio do computador recebido."
                  : clientTest === "testing"
                    ? "Reproduza uma voz no computador."
                    : clientTest === "failed"
                      ? clientAudioState
                    : "Teste separado do microfone."}
              </p>
              <div className="mic-meter"><i style={{ width: `${Math.min(100, Math.round(clientRms * 400))}%` }} /></div>
              <small className="wolf-diagnostic">
                {clientSignal ? "SINAL DETECTADO" : "sem sinal"} · RMS {clientRms.toFixed(4)} · Peak {clientPeak.toFixed(4)} · VAD {clientVad} · Whisper {clientWhisper}
                {clientPartial ? ` · Partial: ${clientPartial}` : ""}{clientTranscript ? ` · Final: ${clientTranscript}` : ""}{clientLatency ? ` · ${clientLatency} ms` : ""}
              </small>
              <label className="wolf-device-row">Áudio do computador
                <select value={outputDevice} disabled={clientTest === "testing"} onChange={(event) => {
                  const id = event.target.value; setOutputDevice(id); localStorage.setItem("wolf-output-device", id);
                  void api("/wolf/audio/device", { method: "POST", body: JSON.stringify({ deviceId: id }) })
                    .then(() => setClientAudioState("HELPER REINICIANDO NO DISPOSITIVO SELECIONADO..."))
                    .catch((error) => setClientAudioState(error instanceof Error ? error.message : "Falha ao trocar dispositivo."));
                }}>
                  {outputDevices.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}
                  {!outputDevices.length ? <option value={outputDevice}>Dispositivo padrão</option> : null}
                </select>
              </label>
              <button onClick={() => void testClientAudio()} disabled={clientTest === "testing"}>
                TESTAR ÁUDIO DO CLIENTE
              </button>
            </div>
            <div className="wolf-preflight-services"><strong>Serviços</strong><div><span className="wolf-service-row"><i className={readiness?.checks.whisper && readiness?.checks.vad ? "ok" : "bad"} />Whisper / VAD <b>{readiness?.checks.whisper && readiness?.checks.vad ? "PRONTO" : "VERIFICANDO"}</b></span><span className="wolf-service-row"><i className={readiness?.checks.qwenWarm ? "ok" : "bad"} />Qwen <b>{readiness?.checks.qwenWarm ? "AQUECIDO" : "VERIFICANDO"}</b></span><span className="wolf-service-row"><i className={readiness?.checks.audioGateway ? "ok" : "bad"} />Gateway <b>{readiness?.checks.audioGateway ? "OK" : "OFF"}</b></span><span className="wolf-service-row"><i className={readiness?.checks.helperConnected ? "ok" : "bad"} />Helper WASAPI <b>{readiness?.checks.helperConnected ? "CONECTADO" : "DESCONECTADO"}</b></span></div></div>
            <div className="wolf-device-row">
              <label>
                Microfone
                <select
                  value={micDevice}
                  onChange={(event) => {
                    setMicDevice(event.target.value);
                    localStorage.setItem("wolf-mic-device", event.target.value);
                  }}
                  disabled={micTest === "testing"}
                >
                  {micDevices.length ? (
                    micDevices.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label || `Microfone ${device.deviceId.slice(-4)}`}
                      </option>
                    ))
                  ) : (
                    <option value="">Dispositivo padrão</option>
                  )}
                </select>
              </label>
            </div>
            {micTest !== "idle" ? (
              <details className="wolf-debug"><summary>Diagnóstico técnico</summary><small className="wolf-diagnostic">
                Dispositivo: {micDevices.find((device) => device.deviceId === micDevice)?.label || "padrão"} ·
                Frames: {micFrames > 0 ? `${micFrames} recebendo` : "aguardando"} · Sinal:{" "}
                {micLevel > 0.02 ? "presente" : "sem sinal"} · Backend:{" "}
                {micBackendFrames ? `${micBackendFrames} recebendo` : "aguardando"} · RMS: {micRms.toFixed(4)}{" "}
                · VAD: {micVad} · Whisper: {micWhisper}
                {micTrackInfo ? ` · Track: ${micTrackInfo.readyState}/${micTrackInfo.enabled ? "enabled" : "disabled"}/${micTrackInfo.muted ? "muted" : "unmuted"} · ${micTrackInfo.channelCount} canal(is) · ${micTrackInfo.sampleRate} Hz · device ${micTrackInfo.deviceId}` : ""}
                {` · Bytes enviados: ${micBytesSent}`}
              </small></details>
            ) : null}
            </div>
          </>
        ) : null}
        {wolfView === "leads" ? (
          <div className="wolf-import-action">
            <label className="primary-button">
              <ClipboardList /> {wolfImporting ? "IMPORTANDO..." : "IMPORTAR LEADS"}
              <input
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                onChange={(event) => void importWolfLeads(event)}
                disabled={wolfImporting}
              />
            </label>
            <small>Somente os contatos importados aqui entram na fila do THE WOLF.</small>
          </div>
        ) : null}
        {wolfView === "today" || wolfView === "leads" ? (
          <div className="wolf-lead-grid">
            {leads.map((lead) => (
              <button
                className={`wolf-lead ${selected?.id === lead.id ? "selected" : ""}`}
                key={lead.id}
                onClick={() => selectLead(lead)}
              >
                <strong>{lead.name || lead.phone}</strong>
                <span>{lead.company || "Empresa não informada"}</span>
                <small>
                  {lead.phone} · {lead.batchName || lead.batchSource || lead.source || "Origem não informada"}
                </small>
              </button>
            ))}
          </div>
        ) : null}
        {wolfView === "returns" ? (
          <div className="wolf-operational-list">
            {returnLeads.length ? (
              returnLeads.map((lead) => (
                <article key={lead.id}>
                  <div>
                    <strong>{lead.name || lead.phone}</strong>
                    <small>
                      {lead.company || "Empresa não informada"} · {lead.phone}
                    </small>
                  </div>
                  <time>
                    {lead.wolfState?.nextCallAt
                      ? new Date(lead.wolfState.nextCallAt).toLocaleString("pt-BR")
                      : "—"}
                  </time>
                  <button
                    onClick={() => {
                      setSelected(lead);
                      setWolfView("leads");
                    }}
                  >
                    LIGAR
                  </button>
                </article>
              ))
            ) : (
              <p>Nenhum retorno agendado.</p>
            )}
          </div>
        ) : null}
        {wolfView === "results" ? (
          <div className="wolf-summary-grid">
            <div>
              <span>LIGAÇÕES</span>
              <strong>{history.length}</strong>
            </div>
            <div>
              <span>ATENDIDOS</span>
              <strong>{answered}</strong>
            </div>
            <div>
              <span>NÃO ATENDERAM</span>
              <strong>{history.filter((item) => String(item.result) === "no_answer").length}</strong>
            </div>
            <div>
              <span>RETORNOS</span>
              <strong>{returnLeads.length}</strong>
            </div>
            <div>
              <span>CONVERSÃO</span>
              <strong>{history.length ? `${Math.round((converted / history.length) * 100)}%` : "0%"}</strong>
            </div>
          </div>
        ) : null}
        {wolfView === "performance" ? (
          <div className="wolf-performance">
            <BarChart3 />
            <div>
              <strong>Desempenho por volume</strong>
              <p>
                {history.length} ligações registradas · {answered} atendidos · {converted} convertidos.
              </p>
              <small>As taxas são exibidas junto do volume para evitar conclusões com amostra pequena.</small>
            </div>
          </div>
        ) : null}
        {wolfView === "today" || wolfView === "leads" ? (
          <footer className="wolf-start-actions">
            <button
              className="primary-button"
              disabled={!selected || busy || !readyToCall}
              onClick={() => void start("outbound")}
            >
              <PhoneOutgoing /> ABRIR ATENDIMENTO
            </button>
            <button
              className="secondary-button"
              disabled={busy || !readyToCall}
              onClick={() => void start("inbound")}
            >
              <PhoneIncoming /> NOVA LIGAÇÃO RECEBIDA
            </button>
          </footer>
        ) : null}
      </section>
      {wolfView === "today" || wolfView === "history" ? (
        <section className="card wolf-history">
          <header>
            <strong>HISTÓRICO DE LIGAÇÕES</strong>
            <span>{history.length} registros</span>
          </header>
          {history.map((item) => (
            <article key={item.id}>
              <div>
                <strong>
                  {item.direction === "inbound" ? "Entrada" : "Saída"} · {item.result ?? item.status}
                </strong>
                <small>{item.summary || "Sem resumo salvo"}</small>
              </div>
              <time>{item.startedAt ? new Date(item.startedAt).toLocaleString("pt-BR") : "—"}</time>
            </article>
          ))}
        </section>
      ) : null}
    </div>
  );
}
