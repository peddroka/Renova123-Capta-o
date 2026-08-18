export function resampleFloat32ToPcm16(input: Float32Array, fromRate: number, toRate: number): ArrayBuffer {
  if (!input.length || fromRate <= 0 || toRate <= 0) return new ArrayBuffer(0);
  const ratio = fromRate / toRate;
  const length = Math.max(1, Math.round(input.length / ratio));
  const output = new ArrayBuffer(length * 2);
  const view = new DataView(output);
  for (let index = 0; index < length; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const right = Math.min(input.length - 1, left + 1);
    const amount = position - left;
    const sample = Math.max(
      -1,
      Math.min(1, (input[left] ?? 0) * (1 - amount) + (input[right] ?? 0) * amount),
    );
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return output;
}
