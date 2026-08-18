import base64
import os
import time
import sys
import wave
from collections import defaultdict
from threading import Lock

import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

MODEL = os.getenv("WOLF_LOCAL_TRANSCRIPTION_MODEL", "small")
LANGUAGE = os.getenv("WOLF_LOCAL_TRANSCRIPTION_LANGUAGE", "pt")
INITIAL_PROMPT = os.getenv("WOLF_LOCAL_TRANSCRIPTION_INITIAL_PROMPT", "IA, inteligência artificial, CRM, WhatsApp, SaaS, Renova123")
DEFAULT_DEVICE = "cuda" if sys.platform == "win32" else "cpu"
DEFAULT_COMPUTE = "int8_float16" if DEFAULT_DEVICE == "cuda" else "int8"
DEVICE = os.getenv("WOLF_LOCAL_TRANSCRIPTION_DEVICE", DEFAULT_DEVICE)
COMPUTE = os.getenv("WOLF_LOCAL_TRANSCRIPTION_COMPUTE_TYPE", DEFAULT_COMPUTE)
BEAM_SIZE = int(os.getenv("WOLF_LOCAL_TRANSCRIPTION_BEAM_SIZE", "1"))
CPU_THREADS = int(os.getenv("WOLF_LOCAL_TRANSCRIPTION_CPU_THREADS", "0"))
ROLLING_WINDOW_SECONDS = float(os.getenv("WOLF_LOCAL_TRANSCRIPTION_ROLLING_WINDOW_SECONDS", "5.0"))
PARTIAL_INTERVAL_SECONDS = float(os.getenv("WOLF_LOCAL_TRANSCRIPTION_PARTIAL_INTERVAL_SECONDS", "0.45"))
AUDIO_DEBUG = os.getenv("WOLF_AUDIO_DEBUG", "false").lower() == "true"
AUDIO_DEBUG_DIR = os.getenv("WOLF_AUDIO_DEBUG_DIR", ".runtime/wolf-diagnostics")
AUDIO_DEBUG_SECONDS = float(os.getenv("WOLF_AUDIO_DEBUG_SECONDS", "10"))
MODEL_LOAD_STARTED = time.perf_counter()
try:
    from faster_whisper import WhisperModel
    whisper = WhisperModel(MODEL, device=DEVICE, compute_type=COMPUTE, cpu_threads=CPU_THREADS or 0)
except Exception:
    DEVICE = "cpu"
    COMPUTE = "int8"
    from faster_whisper import WhisperModel
    whisper = WhisperModel(MODEL, device=DEVICE, compute_type=COMPUTE, cpu_threads=CPU_THREADS or 0)
MODEL_LOAD_MS = round((time.perf_counter() - MODEL_LOAD_STARTED) * 1000)

try:
    from silero_vad import load_silero_vad, get_speech_timestamps
    vad_model = load_silero_vad(onnx=True)
    VAD = "silero-onnx"
except Exception:
    vad_model = None
    VAD = "energy-fallback"

print(f"[WHISPER_CONFIG] model={MODEL} device={DEVICE} compute={COMPUTE} language={LANGUAGE} vad={VAD} beam={BEAM_SIZE} cpu_threads={CPU_THREADS or 'auto'} model_load_ms={MODEL_LOAD_MS}", flush=True)

app = FastAPI(title="THE WOLF local transcription")
buffers: dict[str, bytearray] = defaultdict(bytearray)
rolling_buffers: dict[str, bytearray] = defaultdict(bytearray)
partial_history: dict[str, list[str]] = defaultdict(list)
stable_prefixes: dict[str, str] = defaultdict(str)
last_voice: dict[str, float] = defaultdict(float)
locks: dict[str, Lock] = defaultdict(Lock)
speech_bytes: dict[str, int] = defaultdict(int)
frames_received: dict[str, int] = defaultdict(int)
bytes_received: dict[str, int] = defaultdict(int)
last_partial: dict[str, float] = defaultdict(float)
noise_floor: dict[str, float] = defaultdict(float)
noise_calibration_frames: dict[str, int] = defaultdict(int)
segment_peak: dict[str, float] = defaultdict(float)
segment_sequence: dict[str, int] = defaultdict(int)
speech_started_at: dict[str, float] = defaultdict(float)
last_speech_frame_at: dict[str, float] = defaultdict(float)
vad_silence_started_at: dict[str, float] = defaultdict(float)
pre_roll: dict[str, bytearray] = defaultdict(bytearray)
debug_buffers: dict[str, bytearray] = defaultdict(bytearray)

AUDIO_SIGNAL_THRESHOLD = 0.003
SPEECH_RMS_THRESHOLD = 0.012
ENDPOINT_SILENCE_SECONDS = 0.55
MAX_TURN_SECONDS = 8.0

class AudioFrame(BaseModel):
    stream_id: str
    speaker: str
    audio: str

def save_debug_wav(stream_id: str, speaker: str, audio: bytes):
    os.makedirs(AUDIO_DEBUG_DIR, exist_ok=True)
    safe_stream = "".join(char if char.isalnum() or char in "-_" else "_" for char in stream_id)[-80:]
    path = os.path.join(AUDIO_DEBUG_DIR, f"{speaker}-{safe_stream}-{int(time.time())}.wav")
    with wave.open(path, "wb") as output:
        output.setnchannels(1); output.setsampwidth(2); output.setframerate(24000); output.writeframes(audio)
    print(f"[AUDIO_DEBUG_CAPTURED] speaker={speaker} seconds={len(audio) / (24000 * 2):.2f} path={path}", flush=True)

def common_prefix(left: list[str], right: list[str]) -> list[str]:
    result: list[str] = []
    for one, two in zip(left, right):
        if one != two: break
        result.append(one)
    return result

def reconcile_partial(stream_id: str, text: str) -> tuple[str, str]:
    words = text.lower().split()
    history = partial_history[stream_id]
    previous = history[-1].split() if history else []
    stable = common_prefix(previous, words) if previous else []
    if stable:
        stable_prefixes[stream_id] = " ".join(stable)
    history.append(text)
    if len(history) > 3: del history[:-3]
    stable_text = stable_prefixes[stream_id]
    unstable = " ".join(words[len(stable_text.split()):]) if stable_text else text
    print(f"[ASR_ROLLING_DECODE] stream={stream_id} text_length={len(text)} window_seconds={ROLLING_WINDOW_SECONDS}", flush=True)
    return stable_text, unstable

def process_audio(stream_id: str, speaker: str, raw: bytes, captured_at: float | None = None, transcribe_now: bool = True):
    partial_audio = None
    now = captured_at or time.time()
    with locks[stream_id]:
        frames_received[stream_id] += 1
        bytes_received[stream_id] += len(raw)
        pre_roll[stream_id].extend(raw)
        max_pre_roll_bytes = int(24000 * 2 * 0.4)
        if len(pre_roll[stream_id]) > max_pre_roll_bytes:
            del pre_roll[stream_id][:-max_pre_roll_bytes]
        if AUDIO_DEBUG:
            debug_buffers[stream_id].extend(raw)
            debug_limit = int(24000 * 2 * AUDIO_DEBUG_SECONDS)
            if len(debug_buffers[stream_id]) >= debug_limit:
                save_debug_wav(stream_id, speaker, bytes(debug_buffers[stream_id][:debug_limit]))
                debug_buffers.pop(stream_id, None)
        speaking, rms = speech_metrics(raw)
        audio_signal = rms >= AUDIO_SIGNAL_THRESHOLD
        if not speaking and rms < SPEECH_RMS_THRESHOLD:
            noise_calibration_frames[stream_id] += 1
            noise_floor[stream_id] = rms if not noise_floor[stream_id] else (noise_floor[stream_id] * 0.9 + rms * 0.1)
        segment_peak[stream_id] = max(segment_peak[stream_id], rms)
        relative_speech_threshold = max(SPEECH_RMS_THRESHOLD, segment_peak[stream_id] * 0.18, noise_floor[stream_id] * 1.8)
        speech_now = speaking and rms >= relative_speech_threshold
        base = {"speaker": speaker, "framesReceived": frames_received[stream_id], "backendFrames": frames_received[stream_id], "bytesReceived": bytes_received[stream_id], "sampleRate": 24000, "speechDetected": speaking, "audioSignal": audio_signal, "rms": round(rms, 5), "vad": "voice" if speaking else "silence", "speechProbability": 1.0 if speaking else 0.0, "whisper": "awaiting"}
        if not audio_signal and not speech_bytes[stream_id]:
            return {"final": False, **base, "discarded": True, "reason": "no_speech"}
        newly_started = bool(speech_now and not speech_started_at[stream_id])
        if newly_started: speech_started_at[stream_id] = now
        if speech_now: last_speech_frame_at[stream_id] = now; vad_silence_started_at[stream_id] = 0
        elif speech_bytes[stream_id] and not vad_silence_started_at[stream_id]: vad_silence_started_at[stream_id] = now
        if newly_started:
            # Include the bounded ring immediately preceding VAD confirmation.
            buffers[stream_id].extend(pre_roll[stream_id])
        else:
            buffers[stream_id].extend(raw)
        rolling_buffers[stream_id].extend(raw)
        rolling_limit = int(24000 * 2 * ROLLING_WINDOW_SECONDS)
        if len(rolling_buffers[stream_id]) > rolling_limit:
            del rolling_buffers[stream_id][:-rolling_limit]
        if speech_now:
            speech_bytes[stream_id] += len(raw)
            last_voice[stream_id] = now
            if len(buffers[stream_id]) < 24000 * 2 * MAX_TURN_SECONDS and speech_bytes[stream_id] >= 24000 * 2 and now - last_partial[stream_id] > PARTIAL_INTERVAL_SECONDS:
                partial_audio = bytes(rolling_buffers[stream_id])
                last_partial[stream_id] = now
        if speech_bytes[stream_id] < 24000 * 2 * 0.25:
            return {"final": False, **base}
        silent = bool(vad_silence_started_at[stream_id] and now - last_speech_frame_at[stream_id] >= ENDPOINT_SILENCE_SECONDS)
        max_turn = bool(speech_started_at[stream_id] and now - speech_started_at[stream_id] >= MAX_TURN_SECONDS)
        if not silent and not max_turn and len(buffers[stream_id]) < 24000 * 2 * MAX_TURN_SECONDS:
            if partial_audio is None:
                return {"final": False, **base}
    if transcribe_now and partial_audio is not None:
        partial_text, partial_latency, quality = transcribe(partial_audio)
        if partial_text:
            stable_text, unstable_text = reconcile_partial(stream_id, partial_text)
            return {"final": False, "partial": True, "partialText": stable_text or partial_text, "unstableText": unstable_text, "stablePrefix": stable_text, "asrQuality": quality, "transcriptionMs": partial_latency, **base}
    if not silent and not max_turn and len(buffers[stream_id]) < 24000 * 2 * MAX_TURN_SECONDS:
        return {"final": False, **base}
    with locks[stream_id]:
        if not buffers[stream_id] or speech_bytes[stream_id] < 24000 * 2 * 0.25:
            return {"final": False, **base}
        endpoint_speech_started_at = speech_started_at[stream_id]; endpoint_last_speech_frame_at = last_speech_frame_at[stream_id]; endpoint_vad_silence_started_at = vad_silence_started_at[stream_id]
        audio_bytes = bytes(buffers[stream_id]); buffers[stream_id].clear(); last_voice[stream_id] = 0; speech_bytes[stream_id] = 0; speech_started_at[stream_id] = 0; last_speech_frame_at[stream_id] = 0; vad_silence_started_at[stream_id] = 0; last_partial[stream_id] = 0; noise_calibration_frames[stream_id] = 0; noise_floor[stream_id] = 0; segment_peak[stream_id] = 0
    if not transcribe_now:
        segment_ended_at = now
        segment_sequence[stream_id] += 1
        final_reason = "SILENCE" if endpoint_vad_silence_started_at else "MAX_DURATION"
        return {"final": False, "segmentReady": True, "segmentId": f"{speaker}-{segment_sequence[stream_id]:05d}", "segmentSequence": segment_sequence[stream_id], "segmentPcm": audio_bytes, "speaker": speaker, "segmentEndedAt": segment_ended_at, "speechStartedAt": endpoint_speech_started_at, "lastSpeechFrameAt": endpoint_last_speech_frame_at, "vadSilenceStartedAt": endpoint_vad_silence_started_at, "finalReason": final_reason, **base}
    result, latency, quality = transcribe(audio_bytes)
    final_at = time.time()
    rolling_buffers.pop(stream_id, None); partial_history.pop(stream_id, None); stable_prefixes.pop(stream_id, None)
    return {"final": bool(result), "text": result, "asrQuality": quality, "transcriptionMs": latency, "framesReceived": frames_received[stream_id], "backendFrames": frames_received[stream_id], "bytesReceived": bytes_received[stream_id], "sampleRate": 24000, "speechDetected": True, "audioSignal": True, "vad": "voice", "speechProbability": 1.0, "whisper": "transcribing", "discarded": not bool(result), "reason": "empty_or_rejected" if not result else "accepted", "speechStartedAt": endpoint_speech_started_at, "lastSpeechFrameAt": endpoint_last_speech_frame_at, "vadSilenceStartedAt": endpoint_vad_silence_started_at, "finalCreatedAt": final_at, "endpointLatencyMs": round((final_at - endpoint_last_speech_frame_at) * 1000)}

def speech_metrics(audio: bytes) -> tuple[bool, float]:
    samples = np.frombuffer(audio, dtype=np.int16).astype(np.float32) / 32768.0
    if not len(samples): return False, 0.0
    rms = float(np.sqrt(np.mean(samples * samples)))
    if vad_model is not None:
        try:
            import torch
            return bool(get_speech_timestamps(torch.from_numpy(samples), vad_model, sampling_rate=24000)), rms
        except Exception:
            pass
    return rms > 0.012, rms

def transcribe(audio: bytes):
    global whisper, DEVICE, COMPUTE
    samples = np.frombuffer(audio, dtype=np.int16).astype(np.float32) / 32768.0
    started = time.perf_counter()
    def run_model(input_samples: np.ndarray):
        # Endpointing already classified and cut the turn. Running Whisper's
        # VAD again could erase valid short Portuguese turns.
        return whisper.transcribe(input_samples, language=LANGUAGE, initial_prompt=INITIAL_PROMPT, beam_size=BEAM_SIZE, vad_filter=False, condition_on_previous_text=True, temperature=0.0, no_speech_threshold=0.6, log_prob_threshold=-1.5, compression_ratio_threshold=2.4)
    try:
        segments, _ = run_model(samples)
        segments = list(segments)
    except RuntimeError as error:
        if DEVICE != "cuda" or "cublas" not in str(error).lower(): raise
        # CTranslate2 may not find CUDA runtime DLLs even when nvidia-smi works.
        # Fall back once to CPU instead of breaking a live call.
        DEVICE, COMPUTE = "cpu", "int8"
        whisper = WhisperModel(MODEL, device=DEVICE, compute_type=COMPUTE)
        segments, _ = run_model(samples)
        segments = list(segments)
    valid_segments = [segment for segment in segments if segment.text.strip() and (getattr(segment, "no_speech_prob", 0.0) or 0.0) < 0.6 and (getattr(segment, "avg_logprob", 0.0) or 0.0) > -1.5 and (getattr(segment, "compression_ratio", 0.0) or 0.0) < 2.4]
    text = " ".join(segment.text.strip() for segment in valid_segments).strip()
    quality = {"noSpeechProb": round(float(max((getattr(segment, "no_speech_prob", 0.0) or 0.0) for segment in segments), default=0.0), 4), "avgLogprob": round(float(min((getattr(segment, "avg_logprob", 0.0) or 0.0) for segment in segments), default=0.0), 4), "compressionRatio": round(float(max((getattr(segment, "compression_ratio", 0.0) or 0.0) for segment in segments), default=0.0), 4)}
    if not text:
        # Bounded recognition cushion for short/quiet tails. The endpointed
        # PCM remains unchanged; only this Whisper input gets 250 ms padding.
        padded = np.pad(samples, (int(0.25 * 24000), int(0.25 * 24000)))
        padded_segments, _ = run_model(padded)
        padded_segments = list(padded_segments)
        fallback = [segment for segment in padded_segments if segment.text.strip() and (getattr(segment, "no_speech_prob", 0.0) or 0.0) < 0.65 and (getattr(segment, "compression_ratio", 0.0) or 0.0) < 2.4]
        text = " ".join(segment.text.strip() for segment in fallback).strip()
    words = [word.lower() for word in text.split()]
    if len(words) >= 4 and len(set(words)) <= max(1, len(words) // 3): text = ""
    return text, round((time.perf_counter() - started) * 1000), quality

@app.get("/health")
def health():
    return {"ok": True, "provider": "local", "model": MODEL, "device": DEVICE, "computeType": COMPUTE, "language": LANGUAGE, "vad": VAD, "beamSize": BEAM_SIZE, "cpuThreads": CPU_THREADS or "auto", "modelLoadMs": MODEL_LOAD_MS, "rollingWindowSeconds": ROLLING_WINDOW_SECONDS, "partialIntervalSeconds": PARTIAL_INTERVAL_SECONDS, "audioDebug": AUDIO_DEBUG, "python": sys.executable, "pid": os.getpid()}

@app.post("/audio")
def audio(frame: AudioFrame):
    raw = base64.b64decode(frame.audio)
    return process_audio(frame.stream_id, frame.speaker, raw)

@app.websocket("/audio/ws")
async def audio_ws(socket: WebSocket):
    import asyncio
    await socket.accept()
    stream_id = socket.query_params.get("stream_id", "wolf-ws")
    speaker = socket.query_params.get("speaker", "operator")
    frame_queue: asyncio.Queue[tuple[bytes, float] | None] = asyncio.Queue(maxsize=300)
    segment_queue: asyncio.Queue[dict | None] = asyncio.Queue(maxsize=32)
    stop = asyncio.Event()
    worker_busy = False
    async def receive_loop():
        try:
            while not stop.is_set():
                raw = await socket.receive_bytes()
                captured_at = time.time()
                if frame_queue.full():
                    try: frame_queue.get_nowait()
                    except asyncio.QueueEmpty: pass
                frame_queue.put_nowait((raw, captured_at))
        except Exception:
            stop.set()
            await frame_queue.put(None)
            await segment_queue.put(None)
    async def ingest_loop():
        while not stop.is_set():
            item = await frame_queue.get()
            if item is None: break
            raw, captured_at = item
            result = await asyncio.to_thread(process_audio, stream_id, speaker, raw, captured_at, False)
            segment = result.pop("segmentPcm", None)
            if segment is not None:
                result["segmentBytes"] = len(segment)
                await segment_queue.put({"pcm": segment, "meta": result})
            result["queueSize"] = segment_queue.qsize()
            result["queueMaxSize"] = segment_queue.maxsize
            result["workerBusy"] = worker_busy
            if socket.client_state.name == "CONNECTED": await socket.send_json(result)
    async def transcription_loop():
        nonlocal worker_busy
        while not stop.is_set():
            item = await segment_queue.get()
            if item is None: break
            started = time.time()
            worker_busy = True
            try:
                text, latency, quality = await asyncio.to_thread(transcribe, item["pcm"])
            except Exception as error:
                print(f"[WHISPER_WORKER_ERROR] {error}", flush=True)
                worker_busy = False
                continue
            worker_busy = False
            meta = item["meta"]
            final_at = time.time()
            if socket.client_state.name == "CONNECTED":
                final_reason = meta.get("finalReason") or ("SILENCE" if meta.get("vadSilenceStartedAt") else "MAX_DURATION")
                await socket.send_json({**meta, "segmentReady": False, "final": bool(text), "text": text, "asrQuality": quality, "whisper": "transcribing", "transcriptionMs": latency, "finalCreatedAt": final_at, "transcriptionQueueLatencyMs": round((started - float(meta.get("segmentEndedAt", started))) * 1000), "endpointLatencyMs": round((final_at - float(meta.get("lastSpeechFrameAt", final_at))) * 1000), "reason": final_reason, "finalReason": final_reason})
    try:
        await asyncio.gather(receive_loop(), ingest_loop(), transcription_loop())
    except WebSocketDisconnect:
        pass
    finally:
        stop.set()
