import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuthSession, getValidAccessToken } from "./supabase";
import { api } from "./api";

vi.mock("./supabase", () => ({ getValidAccessToken: vi.fn(), clearAuthSession: vi.fn() }));

const token = vi.mocked(getValidAccessToken);
const clear = vi.mocked(clearAuthSession);

describe("cliente autenticado da API", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    token.mockReset();
    clear.mockReset();
  });

  it("envia o access token da sessão Supabase", async () => {
    token.mockResolvedValue("valid-token");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await expect(api<{ ok: boolean }>("/dashboard")).resolves.toEqual({ ok: true });
    expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).get("authorization")).toBe("Bearer valid-token");
  });

  it("não envia JSON em GET sem body, mas envia JSON quando há body", async () => {
    token.mockResolvedValue("valid-token");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await api("/health");
    expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).get("content-type")).toBeNull();
    await api("/test", { method: "POST", body: JSON.stringify({ phone: "5511999999999" }) });
    expect(new Headers(fetchMock.mock.calls[1]![1]?.headers).get("content-type")).toBe("application/json");
  });

  it("renova uma sessão expirada uma única vez e repete a requisição", async () => {
    token.mockResolvedValueOnce("expired-token").mockResolvedValueOnce("refreshed-token");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "expirada" }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await expect(api<{ ok: boolean }>("/dashboard")).resolves.toEqual({ ok: true });
    expect(token).toHaveBeenNthCalledWith(1);
    expect(token).toHaveBeenNthCalledWith(2, true);
    expect(new Headers(fetchMock.mock.calls[1]![1]?.headers).get("authorization")).toBe(
      "Bearer refreshed-token",
    );
    expect(clear).not.toHaveBeenCalled();
  });

  it("limpa a sessão velha quando o refresh não recupera autenticação", async () => {
    token.mockResolvedValueOnce("expired-token").mockResolvedValueOnce(null);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "Sessão inválida ou expirada." }), { status: 401 }),
    );
    await expect(api("/dashboard")).rejects.toMatchObject({ status: 401 });
    expect(clear).toHaveBeenCalledOnce();
  });
  it("respeita Retry-After e bloqueia chamadas equivalentes durante o cooldown", async () => {
    token.mockResolvedValue(null);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "muitos pedidos" }), {
        status: 429,
        headers: { "retry-after": "30" },
      }),
    );
    await expect(api("/preflight/audio")).rejects.toMatchObject({
      status: 429,
      message: "Teste temporariamente bloqueado. Aguarde 30 segundos.",
    });
    await expect(api("/preflight/audio")).rejects.toMatchObject({
      status: 429,
      message: "Teste temporariamente bloqueado. Aguarde 30 segundos.",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
