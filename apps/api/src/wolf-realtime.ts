import WebSocket from "ws";

export type WolfSpeaker = "operator" | "client";
export type WolfTranscriptEvent = {
  kind: "partial" | "final";
  speaker: WolfSpeaker;
  text: string;
  at: string;
  transcriptionMs?: number;
  stablePrefix?: string;
  unstableText?: string;
  asrQuality?: Record<string, unknown>;
};
export type WolfAudioDiagnostic = Record<string, unknown>;

export class WolfRealtimeSession {
  private socket: WebSocket | null = null;
  private localSocket: WebSocket | null = null;
  private opened = false;
  private pending: Buffer[] = [];
  private localAttempts = 0;
  private localRetryTimer: NodeJS.Timeout | null = null;
  constructor(
    private readonly model: string,
    private readonly speaker: WolfSpeaker,
    private readonly onTranscript: (event: WolfTranscriptEvent) => void,
    private readonly onError: (error: Error) => void,
    private readonly localUrl?: string,
    private readonly streamId = "wolf",
    private readonly onDiagnostic?: (diagnostic: WolfAudioDiagnostic) => void,
  ) {}

  open(apiKey?: string) {
    if (this.localUrl) {
      this.openLocal();
      return;
    }
    if (!apiKey) {
      this.onError(new Error("OpenAI API key ausente"));
      return;
    }
    const socket = new WebSocket(
      `wss://api.openai.com/v1/realtime?intent=transcription&model=${encodeURIComponent(this.model)}`,
      { headers: { Authorization: `Bearer ${apiKey}`, "OpenAI-Beta": "realtime=v1" } },
    );
    this.socket = socket;
    socket.on("open", () => {
      this.opened = true;
      socket.send(
        JSON.stringify({
          type: "transcription_session.update",
          session: {
            input_audio_format: "pcm16",
            input_audio_transcription: { model: this.model, language: "pt" },
            turn_detection: { type: "server_vad", prefix_padding_ms: 300, silence_duration_ms: 500 },
          },
        }),
      );
      for (const frame of this.pending.splice(0)) this.append(frame);
    });
    socket.on("message", (raw) => {
      try {
        const event = JSON.parse(String(raw)) as {
          type?: string;
          delta?: string;
          transcript?: string;
          error?: { message?: string };
        };
        if (event.type?.endsWith(".delta") && event.delta)
          this.onTranscript({
            kind: "partial",
            speaker: this.speaker,
            text: event.delta,
            at: new Date().toISOString(),
          });
        if (event.type?.endsWith(".completed") && event.transcript?.trim())
          this.onTranscript({
            kind: "final",
            speaker: this.speaker,
            text: event.transcript.trim(),
            at: new Date().toISOString(),
          });
        if (event.type === "error")
          this.onError(new Error(event.error?.message ?? "OpenAI realtime transcription error"));
      } catch (error) {
        this.onError(error instanceof Error ? error : new Error("Invalid realtime event"));
      }
    });
    socket.on("error", (error) => this.onError(error instanceof Error ? error : new Error(String(error))));
    socket.on("close", () => {
      this.socket = null;
      this.opened = false;
    });
  }

  private openLocal() {
    if (!this.localUrl || this.localRetryTimer) return;
    const local = new WebSocket(
      this.localUrl.replace(/^http/, "ws") +
        `/audio/ws?stream_id=${encodeURIComponent(this.streamId)}&speaker=${this.speaker}`,
    );
    this.localSocket = local;
    local.on("open", () => {
      this.localAttempts = 0;
      this.opened = true;
      for (const frame of this.pending.splice(0)) this.append(frame);
    });
    local.on("message", (raw) => {
      try {
        const result = JSON.parse(String(raw)) as { final?: boolean; partial?: boolean; partialText?: string; text?: string; transcriptionMs?: number; stablePrefix?: string; unstableText?: string; asrQuality?: Record<string, unknown> };
        this.onDiagnostic?.(result as WolfAudioDiagnostic);
        if (result.partial && result.partialText?.trim())
          this.onTranscript({ kind: "partial", speaker: this.speaker, text: result.partialText.trim(), at: new Date().toISOString(), ...(result.transcriptionMs === undefined ? {} : { transcriptionMs: result.transcriptionMs }), ...(result.stablePrefix === undefined ? {} : { stablePrefix: result.stablePrefix }), ...(result.unstableText === undefined ? {} : { unstableText: result.unstableText }), ...(result.asrQuality === undefined ? {} : { asrQuality: result.asrQuality }) });
        if (result.final && result.text?.trim())
          this.onTranscript({ kind: "final", speaker: this.speaker, text: result.text.trim(), at: new Date().toISOString(), ...(result.transcriptionMs === undefined ? {} : { transcriptionMs: result.transcriptionMs }), ...(result.asrQuality === undefined ? {} : { asrQuality: result.asrQuality }) });
      } catch (error) { this.onError(error instanceof Error ? error : new Error("Invalid local realtime event")); }
    });
    local.on("error", () => {
      this.opened = false;
      this.localAttempts += 1;
      if (this.localAttempts >= 3) this.onError(new Error(`Whisper local indisponível em ${this.localUrl}.`));
    });
    local.on("close", () => {
      this.localSocket = null;
      this.opened = false;
      if (this.localAttempts < 3) {
        this.localRetryTimer = setTimeout(() => { this.localRetryTimer = null; this.openLocal(); }, 1000);
      }
    });
  }

  append(frame: Buffer) {
    if (this.localUrl) {
      if (!this.localSocket || !this.opened) {
        if (this.pending.length < 200) this.pending.push(frame);
        return;
      }
      this.localSocket.send(frame);
      return;
    }
    if (!this.socket || !this.opened) {
      if (this.pending.length < 20) this.pending.push(frame);
      return;
    }
    this.socket.send(JSON.stringify({ type: "input_audio_buffer.append", audio: frame.toString("base64") }));
  }
  close() {
    this.pending = [];
    this.socket?.close();
    this.localSocket?.close();
    if (this.localRetryTimer) clearTimeout(this.localRetryTimer);
    this.localRetryTimer = null;
    this.localAttempts = 3;
    this.socket = null;
    this.localSocket = null;
    this.opened = false;
  }
}
