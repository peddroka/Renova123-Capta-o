import { describe, expect, it } from "vitest";
import { resampleFloat32ToPcm16 } from "./audio";

describe("áudio do sistema", () => {
  it("converte mono float32 48 kHz para PCM16 mono 24 kHz", () => {
    const pcm = resampleFloat32ToPcm16(new Float32Array(480), 48_000, 24_000);
    expect(pcm.byteLength).toBe(480);
    expect(new DataView(pcm).getInt16(0, true)).toBe(0);
  });
  it("limita amplitude e escreve little endian", () => {
    const pcm = resampleFloat32ToPcm16(new Float32Array([2, -2]), 24_000, 24_000);
    const view = new DataView(pcm);
    expect(view.getInt16(0, true)).toBe(32767);
    expect(view.getInt16(2, true)).toBe(-32768);
  });
});
