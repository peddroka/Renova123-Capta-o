import { clearAuthSession, getValidAccessToken } from "./supabase";

const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();
const isLocalApiUrl = Boolean(configuredApiUrl && /^(https?:\/\/)?(127\.0\.0\.1|localhost)(:\d+)?\b/i.test(configuredApiUrl));
if (import.meta.env.PROD && (!configuredApiUrl || isLocalApiUrl)) {
  throw new Error("VITE_API_URL de produção deve apontar para o backend HTTPS do Francisco na AWS.");
}
export const API_URL = configuredApiUrl || "/api";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const rateLimitCooldowns = new Map<string, number>();

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const cooldownUntil = rateLimitCooldowns.get(path) ?? 0;
  if (cooldownUntil > Date.now()) {
    const seconds = Math.max(1, Math.ceil((cooldownUntil - Date.now()) / 1000));
    throw new ApiError(`Teste temporariamente bloqueado. Aguarde ${seconds} segundos.`, 429);
  }
  const token = await getValidAccessToken();
  let response = await request(path, init, token);
  let sessionCleared = false;

  if (response.status === 401 && token) {
    const refreshedToken = await getValidAccessToken(true);
    if (refreshedToken) response = await request(path, init, refreshedToken);
    else {
      clearAuthSession();
      sessionCleared = true;
    }
  }

  const body = (await response.json().catch(() => ({}))) as { message?: string };
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("retry-after") ?? "10");
    const seconds = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(120, Math.ceil(retryAfter)) : 10;
    rateLimitCooldowns.set(path, Date.now() + seconds * 1000);
    throw new ApiError(`Teste temporariamente bloqueado. Aguarde ${seconds} segundos.`, 429);
  }
  if (response.status === 401 && !sessionCleared) clearAuthSession();
  if (!response.ok)
    throw new ApiError(body.message ?? "Não foi possível concluir a operação.", response.status);
  return body as T;
}

function request(path: string, init: RequestInit, token: string | null) {
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init.body && !(init.body instanceof FormData) ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
    signal: init.signal ?? AbortSignal.timeout(20_000),
  });
}
