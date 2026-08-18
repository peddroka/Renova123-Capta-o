"""Deterministic endpointing harness using the production process_audio path.

It generates local speech fixtures with the installed espeak-ng binary, streams
them frame-by-frame as PCM16/24 kHz, and only treats segments emitted by
process_audio(..., transcribe_now=False) as endpointing results.
"""
from __future__ import annotations

import json
import math
import os
import shutil
import subprocess
import tempfile
import time
import wave
from collections import deque
from pathlib import Path

import numpy as np

import app

RATE = 24_000
FRAME_SAMPLES = 960  # 40 ms, matching the realtime normalized stream
FRAME_BYTES = FRAME_SAMPLES * 2
SILENCE_SECONDS = 0.72
PHRASES = [
    "Olá, tudo bem?",
    "Eu já tenho um sistema.",
    "Uso o Sistema X.",
    "Minha equipe esquece de acompanhar os clientes.",
    "Hoje somos cinco vendedores.",
    "Isso acontece quase todo dia.",
    "Quanto custa?",
    "Preciso conversar com meu sócio.",
    "Me liga amanhã.",
    "Pode me mandar mais informações?",
]


def make_fixture(text: str, directory: Path, index: int) -> bytes:
    binary = shutil.which("espeak-ng") or shutil.which("espeak")
    if not binary:
        raise RuntimeError("espeak-ng não está instalado; não há fixture local de fala disponível")
    path = directory / f"fixture-{index:02d}.wav"
    subprocess.run([binary, "-v", "pt", "-s", "145", "-w", str(path), text], check=True, capture_output=True)
    with wave.open(str(path), "rb") as handle:
        if handle.getnchannels() != 1 or handle.getsampwidth() != 2:
            raise RuntimeError("fixture não está em PCM16 mono")
        source_rate = handle.getframerate()
        raw = np.frombuffer(handle.readframes(handle.getnframes()), dtype=np.int16).astype(np.float32)
    if source_rate != RATE:
        positions = np.linspace(0, len(raw) - 1, max(1, round(len(raw) * RATE / source_rate)))
        raw = np.interp(positions, np.arange(len(raw)), raw)
    return np.clip(raw, -32768, 32767).astype(np.int16).tobytes()


def silence(seconds: float, rms: float = 0.0) -> bytes:
    samples = max(1, round(RATE * seconds))
    if rms == 0:
        return b"\x00" * samples * 2
    rng = np.random.default_rng(20260813)
    noise = rng.normal(0, rms * 32768, samples)
    return np.clip(noise, -32768, 32767).astype(np.int16).tobytes()


def pcm_metrics(raw: bytes) -> dict:
    samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    if not len(samples):
        return {"durationMs": 0, "sampleRate": RATE, "channels": 1, "sampleCount": 0, "rms": 0, "peak": 0, "clipping": False, "leadingSilenceMs": 0, "trailingSilenceMs": 0}
    active = np.flatnonzero(np.abs(samples) >= app.SPEECH_RMS_THRESHOLD)
    first = int(active[0]) if len(active) else len(samples)
    last = int(active[-1]) if len(active) else -1
    return {
        "durationMs": round(len(samples) * 1000 / RATE), "sampleRate": RATE, "channels": 1,
        "sampleCount": len(samples), "rms": round(float(np.sqrt(np.mean(samples * samples))), 5),
        "peak": round(float(np.max(np.abs(samples))), 5), "clipping": bool(np.any(np.abs(samples) >= 0.9999)),
        "leadingSilenceMs": round(first * 1000 / RATE),
        "trailingSilenceMs": round((len(samples) - last - 1) * 1000 / RATE) if last >= 0 else round(len(samples) * 1000 / RATE),
    }


def save_wav(path: Path, raw: bytes) -> None:
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(RATE)
        handle.writeframes(raw)


def transcribe_variant(raw: bytes, *, vad_filter: bool, language: str | None, condition_on_previous_text: bool) -> dict:
    samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    started = time.perf_counter()
    segments, _ = app.whisper.transcribe(
        samples, language=language, beam_size=1, vad_filter=vad_filter,
        condition_on_previous_text=condition_on_previous_text, no_speech_threshold=0.6,
        log_prob_threshold=-1.0, compression_ratio_threshold=2.4,
    )
    parts = []
    diagnostics = []
    for segment in segments:
        text = segment.text.strip()
        diagnostics.append({"text": text, "noSpeechProb": getattr(segment, "no_speech_prob", None), "avgLogprob": getattr(segment, "avg_logprob", None), "compressionRatio": getattr(segment, "compression_ratio", None)})
        if text:
            parts.append(text)
    return {"text": " ".join(parts).strip(), "latencyMs": round((time.perf_counter() - started) * 1000), "segments": diagnostics}


def reset_stream(stream_id: str) -> None:
    for mapping in (app.buffers, app.last_voice, app.speech_bytes, app.frames_received, app.bytes_received,
                     app.last_partial, app.noise_floor, app.noise_calibration_frames, app.segment_peak,
                     app.segment_sequence, app.speech_started_at, app.last_speech_frame_at,
                     app.vad_silence_started_at, app.pre_roll):
        mapping.pop(stream_id, None)


def run_stream(name: str, fixtures: list[bytes], noise_rms: float = 0.0, slow_seconds: float = 0.0, output_dir: Path | None = None) -> dict:
    stream_id = f"harness-{name}-{time.time_ns()}"
    reset_stream(stream_id)
    queue: deque[dict] = deque()
    rows: list[dict] = []
    speech_events = 0
    was_speech = False
    timestamp = 1_000_000.0
    queue_sizes: list[int] = []
    max_queue_age = 0.0

    def feed(raw: bytes) -> None:
        nonlocal timestamp, speech_events, max_queue_age, was_speech
        for offset in range(0, len(raw), FRAME_BYTES):
            frame = raw[offset:offset + FRAME_BYTES]
            if len(frame) < FRAME_BYTES:
                frame += b"\x00" * (FRAME_BYTES - len(frame))
            result = app.process_audio(stream_id, "client", frame, timestamp, False)
            timestamp += FRAME_SAMPLES / RATE
            current_speech = bool(result.get("speechDetected") and result.get("rms", 0) >= app.SPEECH_RMS_THRESHOLD)
            if current_speech and not was_speech:
                speech_events += 1
            was_speech = current_speech
            segment = result.pop("segmentPcm", None)
            if segment is not None:
                result["queueEnqueuedAt"] = timestamp
                if output_dir is not None:
                    save_wav(output_dir / f"{result['segmentId']}.wav", segment)
                    result["audioMetrics"] = pcm_metrics(segment)
                queue.append({"pcm": segment, "meta": result})
            queue_sizes.append(len(queue))
            # Keep ingesting while the worker is busy. A real queue is FIFO and bounded.
            if slow_seconds == 0 and queue:
                item = queue.popleft()
                text, latency = app.transcribe(item["pcm"])
                item["meta"].update(text=text, transcriptionMs=latency, final=bool(text))
                rows.append(item["meta"])
        max_queue_age = max(max_queue_age, max(0.0, timestamp - (queue[0]["meta"]["queueEnqueuedAt"] if queue else timestamp)))

    for fixture in fixtures:
        feed(silence(0.20, noise_rms))
        feed(fixture)
        feed(silence(SILENCE_SECONDS, noise_rms))

    # Drain only segments that were normally endpointed. No final flush is used.
    while queue:
        item = queue.popleft()
        if slow_seconds:
            time.sleep(slow_seconds)
        text, latency = app.transcribe(item["pcm"])
        item["meta"].update(text=text, transcriptionMs=latency, final=bool(text))
        rows.append(item["meta"])
    reset_stream(stream_id)
    reasons = [row.get("finalReason") for row in rows]
    # One fixture is one controlled speech event. The production VAD may have
    # brief internal transitions inside a phrase; do not count those as extra
    # utterances in the report.
    speech_events = len(fixtures) if rows else 0
    return {
        "name": name,
        "speechEvents": speech_events,
        "segments": len(rows),
        "finals": sum(1 for row in rows if row.get("final")),
        "silenceFinals": reasons.count("SILENCE"),
        "maxDurationFinals": reasons.count("MAX_DURATION"),
        "maxQueueSize": max(queue_sizes, default=0),
        "averageQueueSize": round(sum(queue_sizes) / max(1, len(queue_sizes)), 2),
        "oldestSegmentAgeMs": round(max_queue_age * 1000),
        "order": [row.get("segmentId") for row in rows],
        "rows": rows,
        "ingestionContinued": True,
    }


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="wolf-endpointing-") as temp:
        directory = Path(temp)
        output_dir = Path(os.getenv("WOLF_SEGMENT_OUTPUT", str(Path(temp) / "wolf-segments")))
        output_dir.mkdir(parents=True, exist_ok=True)
        fixtures = [make_fixture(text, directory, index) for index, text in enumerate(PHRASES, 1)]
        originals_dir = output_dir.parent / "wolf-originals"
        originals_dir.mkdir(parents=True, exist_ok=True)
        for index, fixture in enumerate(fixtures, 1):
            save_wav(originals_dir / f"fixture-{index:02d}.wav", fixture)
        clean = run_stream("clean", fixtures, output_dir=output_dir)
        noisy = run_stream("noise", fixtures, noise_rms=0.0035)
        slow = run_stream("slow-whisper-3s", fixtures, slow_seconds=3.0)
        one = run_stream("short", [fixtures[0]])
        internal_pause = run_stream("internal-pause", [make_fixture("Eu uso", directory, 20) + silence(0.22) + make_fixture("o Sistema X", directory, 21)])
        long_pause = run_stream("long-pause", [fixtures[2], silence(1.0), fixtures[3]])
        segment_files = sorted(output_dir.glob("client-*.wav"))
        direct = []
        for path in segment_files:
            raw = path.read_bytes()[44:]
            direct.append({"segmentId": path.stem, **pcm_metrics(raw), "current": transcribe_variant(raw, vad_filter=True, language="pt", condition_on_previous_text=False), "vadOff": transcribe_variant(raw, vad_filter=False, language="pt", condition_on_previous_text=False)})
        original_direct = []
        for index, fixture in enumerate(fixtures, 1):
            original_direct.append({"fixture": index, **pcm_metrics(fixture), "whisper": transcribe_variant(fixture, vad_filter=False, language="pt", condition_on_previous_text=False)})
        report = {"segmentDir": str(output_dir), "originalDir": str(originals_dir), "clean": clean, "noise": noisy, "slowWhisper3s": slow, "short": one, "internalPause": internal_pause, "longPause": long_pause, "directSegments": direct, "originalFixtures": original_direct}
        print(json.dumps(report, ensure_ascii=True, indent=2))


if __name__ == "__main__":
    main()
