import { useEffect, useState, type FormEvent } from "react";
import { Eye, EyeOff, LockKeyhole, LogIn, Mail } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { supabase } from "../supabase";

export function LoginPage() {
  const { session, configured } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const destination = typeof location.state === "object" && location.state && "from" in location.state ? String(location.state.from) : "/dashboard";

  useEffect(() => { if (session) navigate(destination, { replace: true }); }, [destination, navigate, session]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) { setError("Supabase Auth não está configurado no frontend."); return; }
    setBusy(true);
    setError("");
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (authError) setError("E-mail ou senha inválidos. Confira os dados e tente novamente.");
    } catch {
      setError("Não foi possível conectar ao serviço de autenticação. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="login-page">
    <section className="login-card" aria-labelledby="login-title">
      <div className="login-brand"><img src="/brand/renova123-logo.png" alt="Renova123" /></div>
      <div className="login-copy">
        <span>Acesso seguro</span>
        <h1 id="login-title">Login administrativo</h1>
        <p>Entre para acessar o painel de captação.</p>
      </div>
      <form onSubmit={submit} noValidate>
        <label htmlFor="login-email">E-mail
          <span className="input-with-icon"><Mail aria-hidden="true" /><input id="login-email" name="email" type="email" autoComplete="username" inputMode="email" placeholder="seu@email.com" required value={email} onChange={(event) => setEmail(event.target.value)} /></span>
        </label>
        <label htmlFor="login-password">Senha
          <span className="input-with-icon"><LockKeyhole aria-hidden="true" /><input id="login-password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="Digite sua senha" required minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} /><button type="button" className="password-toggle" aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</button></span>
        </label>
        {!configured ? <p className="login-error" role="alert">Supabase Auth não está configurado no frontend.</p> : error ? <p className="login-error" role="alert">{error}</p> : null}
        <button className="login-submit" type="submit" disabled={busy || !configured} aria-busy={busy}>{busy ? <span className="loader" aria-hidden="true" /> : <LogIn aria-hidden="true" />}{busy ? "Entrando..." : "Entrar"}</button>
      </form>
      <p className="login-security"><LockKeyhole aria-hidden="true" /> Acesso protegido pelo Supabase Auth</p>
    </section>
  </main>;
}
