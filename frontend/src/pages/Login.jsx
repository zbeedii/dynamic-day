import { useState } from "react";
import { Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";
import { useLocale } from "@/context/LocaleContext";

export default function Login() {
  const { login, register } = useAuth();
  const { language, setLanguage, t } = useLocale();
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault(); setError(""); setLoading(true);
    const res = mode === "login" ? await login(email, password) : await register(email, password);
    setLoading(false); if (!res.ok) setError(res.error);
  };

  return (
    <div className="min-h-screen grain flex items-stretch" data-testid="login-page">
      <div className="hidden lg:flex flex-col justify-between w-[46%] p-14 border-r border-[var(--hairline)] relative overflow-hidden">
        <div className="absolute -left-24 top-1/3 h-[420px] w-[420px] rounded-full breathe" style={{ background: "radial-gradient(circle, rgba(134,167,137,0.22), transparent 65%)" }} />
        <div className="flex items-center gap-3 relative"><Clock className="h-5 w-5" style={{ color: "var(--sage)" }} /><span className="font-display font-semibold tracking-tight">Dynamic Day</span></div>
        <div className="relative max-w-md space-y-6">
          <p className="eyebrow">{t("A day that re-plans itself")}</p>
          <h1 className="font-display text-4xl sm:text-5xl font-extrabold leading-[1.05]">{t("Your day is a shape")},<br />{t("not a list") }.</h1>
          <p className="text-base leading-relaxed text-muted-foreground">{t("Blocks of time, protected transitions, and percentages that quietly rebalance the moment reality moves. When it truly can't fit, it stops and asks you.")}</p>
        </div>
        <div className="relative flex gap-8 mono text-xs text-muted-foreground"><span>{t("PLAN")}</span><span style={{ color: "var(--sage)" }}>{t("NOW")}</span><span>{t("FOCUS")}</span></div>
      </div>
      <div className="flex-1 flex items-center justify-center p-6 sm:p-12">
        <form onSubmit={submit} className="w-full max-w-sm space-y-8 rise">
          <div className="flex justify-end gap-2"><button type="button" onClick={() => setLanguage("en")} className="text-xs px-3 py-1.5 rounded-full border" style={{ borderColor: language === "en" ? "var(--sage)" : "var(--hairline)" }}>English</button><button type="button" onClick={() => setLanguage("ar")} className="text-xs px-3 py-1.5 rounded-full border" style={{ borderColor: language === "ar" ? "var(--sage)" : "var(--hairline)" }}>العربية</button></div>
          <div className="space-y-2"><p className="eyebrow">{mode === "login" ? t("Welcome back") : t("Create your space")}</p><h2 className="font-display text-2xl sm:text-3xl font-bold">{mode === "login" ? t("Sign in") : t("Get started")}</h2></div>
          <div className="space-y-5">
            <div className="space-y-2"><Label htmlFor="email" className="eyebrow">{t("Email")}</Label><Input id="email" data-testid="login-email-input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="h-11 bg-[var(--surface)] border-[var(--hairline)]" /></div>
            <div className="space-y-2"><Label htmlFor="password" className="eyebrow">{t("Password")}</Label><Input id="password" data-testid="login-password-input" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="h-11 bg-[var(--surface)] border-[var(--hairline)]" /></div>
          </div>
          {error && <p data-testid="login-error" className="text-sm" style={{ color: "var(--terracotta)" }}>{error}</p>}
          <Button type="submit" data-testid="login-submit-button" disabled={loading} className="w-full h-11 rounded-full font-semibold" style={{ background: "var(--sage)", color: "#0d0f12" }}>{loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}{mode === "login" ? t("Sign in") : t("Create account")}</Button>
          <button type="button" data-testid="login-toggle-mode" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }} className="text-sm text-muted-foreground hover:text-foreground transition-colors">{mode === "login" ? t("No account yet? Create one") : t("Already have an account? Sign in")}</button>
        </form>
      </div>
    </div>
  );
}
