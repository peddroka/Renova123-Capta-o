export async function sendOrderedParts(
  parts: string[],
  options: {
    send: (part: string, index: number) => Promise<void>;
    beforePart?: (part: string, index: number) => Promise<boolean>;
    pause?: (index: number) => Promise<void>;
  },
) {
  let completed = 0;
  for (let index = 0; index < parts.length; index += 1) {
    if (index > 0 && options.pause) await options.pause(index);
    if (options.beforePart && !await options.beforePart(parts[index]!, index)) return { completed, interrupted: true };
    await options.send(parts[index]!, index);
    completed += 1;
  }
  return { completed, interrupted: false };
}
