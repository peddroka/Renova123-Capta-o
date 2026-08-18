const API = "http://127.0.0.1:3333";
const OFFSCREEN_STATES = { NONE: "NONE", CREATING: "CREATING", READY: "READY", FAILED: "FAILED" };
let offscreenState = OFFSCREEN_STATES.NONE;
let offscreenReadyPromise = null;
let resolveOffscreenReady = null;
let rejectOffscreenReady = null;
let pendingCapture = null;
let captureTarget = null;
let debugWrite = Promise.resolve();
const debugEvents = [];

void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => undefined);

function emit(action, details = {}) {
  const event = { at: new Date().toISOString(), action, ...details };
  debugEvents.push(event); if (debugEvents.length > 100) debugEvents.shift();
  debugWrite = debugWrite.then(async () => { const stored = await chrome.storage.session.get("wolfDebugEvents"); const events = Array.isArray(stored.wolfDebugEvents) ? stored.wolfDebugEvents : []; events.push(event); await chrome.storage.session.set({ wolfDebugEvents: events.slice(-100) }); }).catch(() => undefined);
}
function isWhatsApp(url) { return Boolean(url && /^https:\/\/web\.whatsapp\.com\//.test(url)); }
function resetOffscreenReadiness() { offscreenState = OFFSCREEN_STATES.NONE; offscreenReadyPromise = null; resolveOffscreenReady = null; rejectOffscreenReady = null; }
async function ensureOffscreen() {
  if (offscreenState === OFFSCREEN_STATES.READY && offscreenReadyPromise) return offscreenReadyPromise;
  if (offscreenState === OFFSCREEN_STATES.CREATING && offscreenReadyPromise) return offscreenReadyPromise;
  offscreenState = OFFSCREEN_STATES.CREATING;
  offscreenReadyPromise = new Promise((resolve, reject) => { resolveOffscreenReady = resolve; rejectOffscreenReady = reject; setTimeout(() => { if (offscreenState === OFFSCREEN_STATES.CREATING) { offscreenState = OFFSCREEN_STATES.FAILED; reject(new Error("OFFSCREEN_READY_TIMEOUT")); offscreenReadyPromise = null; resolveOffscreenReady = null; rejectOffscreenReady = null; } }, 5000); });
  try { await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["USER_MEDIA"], justification: "Capturar o áudio da aba WhatsApp para transcrição local." }); emit("OFFSCREEN_READY", { phase: "created" }); } catch (error) { if (!String(error?.message || error).toLowerCase().includes("single offscreen")) { offscreenState = OFFSCREEN_STATES.FAILED; rejectOffscreenReady?.(error); resetOffscreenReadiness(); throw error; } }
  void chrome.runtime.sendMessage({ type: "OFFSCREEN_PING" }).catch(() => undefined);
  return offscreenReadyPromise;
}
function waitForCapture(captureId) { return new Promise((resolve, reject) => { const timeout = setTimeout(() => { if (pendingCapture?.captureId === captureId) pendingCapture = null; reject(new Error("TAB_STREAM_OPEN_TIMEOUT")); }, 7000); pendingCapture = { captureId, resolve: (value) => { clearTimeout(timeout); resolve(value); }, reject: (error) => { clearTimeout(timeout); reject(error); } }; }); }
const captureStartInFlight = new Map();
async function capturedTabs() { try { return typeof chrome.tabCapture.getCapturedTabs === "function" ? await chrome.tabCapture.getCapturedTabs() : []; } catch { return []; } }
async function stopCaptureForSwitch() { await chrome.runtime.sendMessage({ type: "STOP_TAB_CAPTURE" }).catch(() => undefined); await chrome.storage.session.remove("wolfCaptureTarget").catch(() => undefined); captureTarget = null; }
async function startTabCapture(tab) { const existingFlight = captureStartInFlight.get(tab.id); if (existingFlight) return existingFlight; const task = startTabCaptureOnce(tab); captureStartInFlight.set(tab.id, task); try { return await task; } catch (error) { const active = (await capturedTabs()).find((entry) => Number(entry.tabId) === tab.id); if (active && /active stream|already capturing/i.test(String(error?.message || error))) { captureTarget = { ...(captureTarget || {}), tabId: tab.id, windowId: tab.windowId ?? null, url: tab.url || "", status: "LIVE" }; await chrome.storage.session.set({ wolfCaptureTarget: captureTarget }); emit("TAB_CAPTURE_REUSED", { tabId: tab.id, recovered: true }); return; } throw error; } finally { captureStartInFlight.delete(tab.id); } }
async function startTabCaptureOnce(tab) {
  const internal = captureTarget?.tabId === tab.id ? captureTarget : null;
  const active = (await capturedTabs()).find((entry) => Number(entry.tabId) === tab.id);
  if ((internal?.status === "STARTING" || internal?.status === "LIVE") || active) {
    if (internal?.status === "LIVE" || active) { captureTarget = { ...(internal || {}), tabId: tab.id, windowId: tab.windowId ?? null, url: tab.url || "", status: "LIVE", frames: internal?.frames ?? 0, rms: internal?.rms ?? 0 }; await chrome.storage.session.set({ wolfCaptureTarget: captureTarget }); emit("TAB_CAPTURE_REUSED", { tabId: tab.id, active: Boolean(active) }); return; }
  }
  if (captureTarget && captureTarget.tabId !== tab.id && ["STARTING", "LIVE"].includes(captureTarget.status)) await stopCaptureForSwitch();
  const captureId = crypto.randomUUID();
  captureTarget = { tabId: tab.id, windowId: tab.windowId ?? null, url: tab.url, status: "STARTING", startedAt: Date.now(), captureId, frames: 0, rms: 0 };
  await chrome.storage.session.set({ wolfCaptureTarget: captureTarget });
  emit("TAB_CAPTURE_REQUEST", { captureId, targetTabId: tab.id, targetUrl: tab.url });
  await ensureOffscreen();
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  emit("TAB_STREAM_ID_CREATED", { captureId, targetTabId: tab.id });
  const opened = waitForCapture(captureId);
  void chrome.runtime.sendMessage({ type: "START_TAB_CAPTURE", captureId, streamId, api: API }).catch((error) => pendingCapture?.reject(error));
  const event = await opened;
  captureTarget = { tabId: tab.id, windowId: tab.windowId ?? null, url: tab.url, status: "LIVE", startedAt: Date.now(), captureId, frames: event.frames ?? 0, rms: event.rms ?? 0 };
  await chrome.storage.session.set({ wolfCaptureTarget: captureTarget });
  emit("TAB_STREAM_OPEN", { captureId, tabId: tab.id });
}
chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id || !isWhatsApp(tab.url)) return;
  emit("ACTION_CLICK", { tabId: tab.id, url: tab.url });
  emit("SIDEPANEL_OPEN_REQUEST", { tabId: tab.id });
  const panelPromise = chrome.sidePanel.open({ tabId: tab.id });
  void startTabCapture(tab).catch(async (error) => {
    captureTarget = { tabId: tab.id, windowId: tab.windowId ?? null, url: tab.url || "", status: "ERROR", captureId: captureTarget?.captureId, error: error?.message || String(error) };
    await chrome.storage.session.set({ wolfCaptureTarget: captureTarget });
    emit("TAB_CAPTURE_ERROR", { source: "TAB_CAPTURE", captureId: captureTarget.captureId, error: captureTarget.error });
  });
  panelPromise.then(() => emit("SIDEPANEL_OPENED", { tabId: tab.id })).catch((error) => emit("SIDEPANEL_OPEN_ERROR", { tabId: tab.id, name: error?.name, message: error?.message || String(error) }));
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "WOLF_OPEN_MIC_PERMISSION") { chrome.tabs.create({ url: chrome.runtime.getURL("mic-permission.html") }).then((tab) => sendResponse({ ok: true, tabId: tab.id })).catch((error) => sendResponse({ ok: false, message: error?.message || String(error) })); return true; }
  if (message?.type === "WOLF_OPEN_MIC_SETTINGS") { chrome.tabs.create({ url: "chrome://settings/content/microphone" }).then((tab) => sendResponse({ ok: true, tabId: tab.id })).catch((error) => sendResponse({ ok: false, message: error?.message || String(error) })); return true; }
  if (message?.type === "WOLF_GET_CAPTURE_STATE") { chrome.storage.session.get(["wolfCaptureTarget", "wolfDebugEvents"]).then((stored) => sendResponse({ target: stored.wolfCaptureTarget || captureTarget, events: Array.isArray(stored.wolfDebugEvents) ? stored.wolfDebugEvents : debugEvents })); return true; }
  if (["MIC_PERMISSION_GRANTED", "MIC_PERMISSION_CANCELLED", "MIC_PERMISSION_ERROR", "MIC_PERMISSION_DENIED"].includes(message?.type)) { emit(message.type, { method: message.method, name: message.name }); void chrome.runtime.sendMessage({ type: "WOLF_MIC_PERMISSION_EVENT", event: message }).catch(() => undefined); return false; }
  if (message?.type === "ATTACH_CLIENT_SESSION") { void chrome.runtime.sendMessage({ type: "ATTACH_CLIENT_SESSION", callId: message.callId, token: message.token, api: message.api }).catch(() => undefined); return false; }
  if (message?.type === "PAUSE_CAPTURE") { void chrome.runtime.sendMessage({ type: "PAUSE_CAPTURE", paused: Boolean(message.paused) }).catch(() => undefined); return false; }
  if (message?.type === "STOP_TAB_CAPTURE") { void chrome.runtime.sendMessage({ type: "STOP_TAB_CAPTURE" }).catch(() => undefined); captureTarget = null; void chrome.storage.session.remove("wolfCaptureTarget"); void chrome.offscreen.closeDocument().catch(() => undefined).finally(resetOffscreenReadiness); return false; }
  if (message?.type === "OFFSCREEN_EVENT" && sender.url?.endsWith("offscreen.html")) {
    const event = message.event || {};
    if (event.kind === "ready") { offscreenState = OFFSCREEN_STATES.READY; resolveOffscreenReady?.(true); resolveOffscreenReady = null; rejectOffscreenReady = null; emit("OFFSCREEN_READY", { phase: "confirmed" }); }
    if (event.kind === "tab-open" && pendingCapture?.captureId === event.captureId) { pendingCapture.resolve(event); pendingCapture = null; emit("TAB_STREAM_OPEN", { captureId: event.captureId }); }
    if (event.kind === "meter") { if (captureTarget) { captureTarget = { ...captureTarget, frames: event.frames, rms: event.rms, status: "LIVE" }; void chrome.storage.session.set({ wolfCaptureTarget: captureTarget }); } emit(Number(event.frames) === 1 ? "TAB_FRAME_FIRST" : "TAB_METER", { frames: event.frames, rms: event.rms }); }
    if (event.kind === "error") { emit("ERROR", { source: "TAB_CAPTURE", captureId: event.captureId, error: event.message }); if (pendingCapture?.captureId === event.captureId) { pendingCapture.reject(new Error(event.message || "TAB_CAPTURE_ERROR")); pendingCapture = null; } }
    void chrome.runtime.sendMessage({ type: "WOLF_CAPTURE_EVENT", event }).catch(() => undefined);
  }
});
