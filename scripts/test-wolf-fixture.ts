import fs from "node:fs";
import WebSocket from "ws";

const file = process.argv[2] ?? "artifacts/wolf-speech-fixture.wav";
const wav = fs.readFileSync(file);
const dataOffset = wav.indexOf(Buffer.from("data"));
if (dataOffset < 0) throw new Error("WAV sem chunk data");
const pcm = wav.subarray(dataOffset + 8);
const socket = new WebSocket("ws://127.0.0.1:8765/audio/ws?stream_id=fixture&speaker=operator");
let finalText = "";
socket.on("message", (raw) => { const result = JSON.parse(String(raw)) as { final?: boolean; text?: string }; if (result.final && result.text) { finalText = result.text; console.log(JSON.stringify(result)); socket.close(); } });
socket.on("open", () => { for (let offset = 0; offset < pcm.length; offset += 4800) socket.send(pcm.subarray(offset, Math.min(offset + 4800, pcm.length))); for (let i = 0; i < 8; i += 1) socket.send(Buffer.alloc(4800)); });
socket.on("close", () => { if (!finalText) { console.error("FIXTURE_TRANSCRIPT_EMPTY"); process.exitCode = 1; } });
socket.on("error", (error) => { console.error(error); process.exitCode = 1; });
