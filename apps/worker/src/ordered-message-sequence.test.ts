import { describe, expect, it } from "vitest";
import { sendOrderedParts } from "./ordered-message-sequence.js";

describe("sequência ordenada de bolhas", () => {
  it("aguarda a confirmação de uma bolha antes de iniciar a próxima", async () => {
    const events: string[] = [];
    await sendOrderedParts(["primeira", "segunda", "terceira"], {
      send: async (part) => { events.push(`início:${part}`); await Promise.resolve(); events.push(`fim:${part}`); },
    });
    expect(events).toEqual(["início:primeira", "fim:primeira", "início:segunda", "fim:segunda", "início:terceira", "fim:terceira"]);
  });

  it("retoma após falha sem duplicar uma bolha já confirmada", async () => {
    const accepted = new Set<string>();
    const deliveries: string[] = [];
    let failSecond = true;
    const send = async (part: string) => {
      if (accepted.has(part)) return;
      if (part === "segunda" && failSecond) { failSecond = false; throw new Error("falha antes da confirmação"); }
      accepted.add(part); deliveries.push(part);
    };
    await expect(sendOrderedParts(["primeira", "segunda", "terceira"], { send })).rejects.toThrow();
    await sendOrderedParts(["primeira", "segunda", "terceira"], { send });
    expect(deliveries).toEqual(["primeira", "segunda", "terceira"]);
  });

  it("interrompe as bolhas restantes quando chega uma nova fala", async () => {
    const deliveries: string[] = [];
    await sendOrderedParts(["primeira", "segunda", "terceira"], {
      beforePart: async (_part, index) => index < 1,
      send: async (part) => { deliveries.push(part); },
    });
    expect(deliveries).toEqual(["primeira"]);
  });
});
