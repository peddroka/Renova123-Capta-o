import { createClient, type Session } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: "renova123-auth",
      },
    })
  : null;

export const supabaseConfigured = Boolean(supabase);
const AUTH_STORAGE_KEY = "renova123-auth";
let refreshPromise: Promise<Session | null> | null = null;

export async function getValidAccessToken(forceRefresh = false): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    clearAuthSession();
    return null;
  }
  const session = data.session;
  const expiresSoon = !session?.expires_at || session.expires_at * 1_000 <= Date.now() + 30_000;
  if (forceRefresh || expiresSoon) return (await refreshSession())?.access_token ?? null;
  return session.access_token;
}

export async function clearAuthSession() {
  if (supabase) supabase.auth.stopAutoRefresh();
  if (typeof window !== "undefined") window.localStorage.removeItem(AUTH_STORAGE_KEY);
  window.dispatchEvent(new Event("renova-auth-invalid"));
}

async function refreshSession() {
  if (!supabase) return null;
  refreshPromise ??= supabase.auth.refreshSession()
    .then(({ data, error }) => error ? null : data.session)
    .catch(() => null)
    .finally(() => { refreshPromise = null; });
  const session = await refreshPromise;
  return session;
}
