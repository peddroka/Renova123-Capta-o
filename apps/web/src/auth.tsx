import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { clearAuthSession, supabase, supabaseConfigured } from "./supabase";

type AuthState = {
  session: Session | null;
  loading: boolean;
  configured: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    let active = true;
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) clearAuthSession();
      setSession(error ? null : data.session);
      setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (active) { setSession(nextSession); setLoading(false); }
    });
    const invalidate = () => { if (active) setSession(null); };
    window.addEventListener("renova-auth-invalid", invalidate);
    return () => {
      active = false;
      listener.subscription.unsubscribe();
      window.removeEventListener("renova-auth-invalid", invalidate);
    };
  }, []);

  async function signOut() {
    clearAuthSession();
    setSession(null);
  }

  return <AuthContext.Provider value={{ session, loading, configured: supabaseConfigured, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth deve ser usado dentro de AuthProvider.");
  return value;
}

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="auth-loading">Validando sessão…</div>;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}
