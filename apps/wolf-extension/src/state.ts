export type WolfState = "IDLE" | "ARMED" | "TAB_STARTING" | "TAB_READY" | "MIC_REQUIRED" | "MIC_READY" | "SESSION_STARTING" | "LISTENING" | "PAUSED" | "STOPPING" | "ERROR";
export type MicState = "UNKNOWN" | "REQUIRED" | "OPENING" | "LIVE" | "ERROR";
export type CaptureStatus = "NOT_CAPTURED" | "STARTING" | "LIVE" | "ERROR";
export type CaptureTarget = { tabId: number; windowId: number | null; url: string; status: CaptureStatus; startedAt?: number; frames?: number; rms?: number; captureId?: string; error?: string };
export type WolfSnapshot = { state: WolfState; mic: MicState; captureTarget: CaptureTarget | null; sessionId: string | null; contact: { displayName: string; phone: string | null; businessName?: string | null; chatType?: string } | null; error: string | null; frames: { mic: number; tab: number }; rms: { mic: number; tab: number } };
export const initialWolfSnapshot = (): WolfSnapshot => ({ state: "IDLE", mic: "UNKNOWN", captureTarget: null, sessionId: null, contact: null, error: null, frames: { mic: 0, tab: 0 }, rms: { mic: 0, tab: 0 } });
export function canStartSession(snapshot: WolfSnapshot) { return snapshot.captureTarget?.status === "LIVE" && snapshot.mic === "LIVE" && Boolean(snapshot.contact); }
export function transition(snapshot: WolfSnapshot, next: WolfState, error: string | null = null): WolfSnapshot {
  if (next === "LISTENING" && !canStartSession(snapshot)) throw new Error("TAB, MIC e CONTATO precisam estar prontos.");
  return { ...snapshot, state: next, error };
}
