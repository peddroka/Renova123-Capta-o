export const PAIRING_POLL_INTERVAL_MS = 4_000;
export const DIAGNOSTICS_POLL_INTERVAL_MS = 15_000;

export type WhatsAppPollState = "not_created" | "close" | "connecting" | "open" | "unavailable";

export function shouldPollWhatsApp(state: WhatsAppPollState | null, visible: boolean) {
  return visible && state !== "open";
}

export type WhatsAppPollerOptions = {
  readPairing: () => Promise<{ state: WhatsAppPollState }>;
  readDiagnostics: () => Promise<void>;
  onPairing: (value: { state: WhatsAppPollState }) => void;
  onDiagnostics: () => void;
  isVisible?: () => boolean;
  setTimer?: (callback: () => void, delay: number) => number;
  clearTimer?: (timer: number) => void;
};

export function createWhatsAppPoller(options: WhatsAppPollerOptions) {
  const isVisible = options.isVisible ?? (() => true);
  const setTimer = options.setTimer ?? ((callback, delay) => window.setTimeout(callback, delay));
  const clearTimer = options.clearTimer ?? ((timer) => window.clearTimeout(timer));
  let active = false;
  let timer: number | null = null;
  let diagnosticsAt = 0;
  let state: WhatsAppPollState | null = null;
  let inFlight: Promise<void> | null = null;

  const schedule = (delay: number) => {
    if (!active || timer !== null) return;
    timer = setTimer(() => {
      timer = null;
      void poll();
    }, delay);
  };

  const poll = async () => {
    if (!active || !shouldPollWhatsApp(state, isVisible())) return;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const pairing = await options.readPairing();
        if (!active) return;
        state = pairing.state;
        options.onPairing(pairing);
        const now = Date.now();
        if (now >= diagnosticsAt && shouldPollWhatsApp(state, isVisible())) {
          diagnosticsAt = now + DIAGNOSTICS_POLL_INTERVAL_MS;
          await options.readDiagnostics();
          if (active) options.onDiagnostics();
        }
      } catch {
        // Keep one bounded polling chain alive through transient API failures.
      }
    })().finally(() => {
      inFlight = null;
      if (active && shouldPollWhatsApp(state, isVisible())) schedule(PAIRING_POLL_INTERVAL_MS);
    });
    return inFlight;
  };

  return {
    start() {
      if (active) return;
      active = true;
      diagnosticsAt = 0;
      void poll();
    },
    stop() {
      active = false;
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
    refresh() {
      void poll();
    },
  };
}
