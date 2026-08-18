import { describe, expect, it } from "vitest";
import { regionFromBrazilianPhone } from "./phone.js";

describe("região derivada somente do DDD", () => {
  it("mapeia DDD 82 para Alagoas", () => expect(regionFromBrazilianPhone("5582988543864")).toBe("Alagoas"));
  it("não inventa cidade", () => expect(regionFromBrazilianPhone("5511987654321")).toBe("São Paulo"));
});
