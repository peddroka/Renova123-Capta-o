import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deliveryIsUncertain, deliveryWasAccepted, markDeliveryAccepted, markDeliveryUncertain } from "./delivery-ledger.js";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true })));

describe("registro local de entregas", () => {
  it("preserva a confirmação fora do banco compartilhado", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "renova-delivery-"));
    directories.push(directory);
    const database = path.join(directory, "mock-db.json");
    expect(deliveryWasAccepted(database, "send:1")).toBe(false);
    markDeliveryAccepted(database, "send:1");
    markDeliveryAccepted(database, "send:1");
    expect(deliveryWasAccepted(database, "send:1")).toBe(true);
  });

  it("bloqueia reenvio quando o resultado do provedor é incerto", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "renova-uncertain-"));
    directories.push(directory);
    const database = path.join(directory, "mock-db.json");
    markDeliveryUncertain(database, "send:ambiguous");
    expect(deliveryIsUncertain(database, "send:ambiguous")).toBe(true);
    expect(deliveryWasAccepted(database, "send:ambiguous")).toBe(false);
  });
});
