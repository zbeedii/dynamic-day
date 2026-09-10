import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Bell, CalendarDays, Clock, Focus, LogOut, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { client, errMsg } from "@/api";
import { useAuth } from "@/context/AuthContext";
import { useDay } from "@/context/DayContext";
import { useLocale } from "@/context/LocaleContext";
import { enablePushNotifications } from "@/push";

const TABS = [
  { to: "/", label: "Now", icon: Clock, testid: "nav-now" },
  { to: "/plan", label: "Plan", icon: CalendarDays, testid: "nav-plan" },
  { to: "/focus", label: "Focus", icon: Focus, testid: "nav-focus" },
];

function SettingsPanel() {
  const { data, refresh } = useDay();
  const { language, setLanguage, t } = useLocale();
  const s = data?.settings || {};
  const [saving, setSaving] = useState(false);

  const save = async (patch) => {
    setSaving(true);
    try {
      await client.put("/settings", patch);
      await refresh();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  const askNotifications = async (on) => {
    if (on && "Notification" in window && Notification.permission === "default") {
      const p = await Notification.requestPermission();
      if (p !== "granted")
        toast("Browser notifications were not allowed — in-app reminders will still appear.");
      else enablePushNotifications().catch(() => {});
    }
    save({ notifications_enabled: on });
  };

  return (
    <div className="space-y-7" data-testid="settings-panel">
      <div className="space-y-2">
        <Label className="eyebrow">{t("Language")}</Label>
        <div className="flex gap-2">
          <button onClick={() => setLanguage("en")} className="px-3 py-2 rounded-full text-xs border" style={{ borderColor: language === "en" ? "var(--sage)" : "var(--hairline)" }}>{t("English")}</button>
          <button onClick={() => setLanguage("ar")} className="px-3 py-2 rounded-full text-xs border" style={{ borderColor: language === "ar" ? "var(--sage)" : "var(--hairline)" }}>{t("العربية")}</button>
        </div>
      </div>
      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <Label className="eyebrow">{t("Friction threshold")}</Label>
          <span className="mono text-sm" data-testid="settings-threshold-value">
            {s.delay_threshold_pct}% of a block
          </span>
        </div>
        <Slider
          data-testid="settings-threshold-slider"
          value={[s.delay_threshold_pct ?? 30]}
          min={10}
          max={80}
          step={5}
          onValueCommit={(v) => save({ delay_threshold_pct: v[0] })}
        />
        <p className="text-xs text-muted-foreground leading-relaxed">
          Past this much slippage, the day stops adapting on its own and asks you what to do.
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <Label className="eyebrow">{t("Reward chance")}</Label>
          <span className="mono text-sm">{s.reward_chance_pct}%</span>
        </div>
        <Slider
          data-testid="settings-reward-slider"
          value={[s.reward_chance_pct ?? 35]}
          min={0}
          max={100}
          step={5}
          onValueCommit={(v) => save({ reward_chance_pct: v[0] })}
        />
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <Label className="text-sm">{t("Browser reminders")}</Label>
          <p className="text-xs text-muted-foreground">{t("In-app reminders always fire.")}</p>
        </div>
        <Switch
          data-testid="settings-notifications-switch"
          checked={!!s.notifications_enabled}
          onCheckedChange={askNotifications}
        />
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <Label className="text-sm">{t("Calm backdrop in focus")}</Label>
          <p className="text-xs text-muted-foreground">{t("A quiet ambient glow while you work.")}</p>
        </div>
        <Switch
          data-testid="settings-calm-switch"
          checked={!!s.calm_background}
          onCheckedChange={(v) => save({ calm_background: v })}
        />
      </div>
      {saving && <p className="text-xs text-muted-foreground">{t("Saving…")}</p>}
    </div>
  );
}

export default function AppShell({ children }) {
  const { pathname } = useLocation();
  const { t } = useLocale();
  const { logout, user } = useAuth();

  return (
    <div className="min-h-screen grain">
      <header className="sticky top-0 z-30 backdrop-blur-xl border-b border-[var(--hairline)] bg-[rgba(13,15,18,0.82)]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-6">
          <div className="flex items-center gap-2.5">
            <Clock className="h-4 w-4" style={{ color: "var(--sage)" }} />
            <span className="font-display font-semibold tracking-tight hidden sm:block">
              Dynamic Day
            </span>
          </div>

          <nav className="flex items-center gap-1 ml-auto sm:ml-0">
            {TABS.map(({ to, label, icon: Icon, testid }) => {
              const active = pathname === to;
              return (
                <Link
                  key={to}
                  to={to}
                  data-testid={testid}
                  className="flex items-center gap-2 px-4 py-2 rounded-full text-sm transition-colors"
                  style={
                    active
                      ? { background: "var(--sage-soft)", color: "var(--sage)" }
                      : { color: "hsl(var(--muted-foreground))" }
                  }
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-1">
            <Popover>
              <PopoverTrigger asChild>
                <button
                  data-testid="open-settings-button"
                  className="h-9 w-9 grid place-items-center rounded-full text-muted-foreground hover:text-foreground hover:bg-[var(--surface-2)] transition-colors"
                >
                  <Settings2 className="h-4 w-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-[340px] p-6 border-[var(--hairline)]"
                style={{ background: "var(--surface)" }}
              >
                <SettingsPanel />
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <button
                  data-testid="open-user-menu"
                  className="h-9 px-3 rounded-full text-xs mono text-muted-foreground hover:text-foreground hover:bg-[var(--surface-2)] transition-colors"
                >
                  {user?.email?.split("@")[0]}
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-56 p-3 border-[var(--hairline)]"
                style={{ background: "var(--surface)" }}
              >
                <p className="text-xs text-muted-foreground px-2 pb-2 truncate">{user?.email}</p>
                <button
                  data-testid="logout-button"
                  onClick={logout}
                  className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm hover:bg-[var(--surface-2)] transition-colors"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  {t("Sign out")}
                </button>
                {"Notification" in window && Notification.permission === "default" && (
                  <button
                    data-testid="enable-notifications-button"
                    onClick={async () => { const p = await Notification.requestPermission(); if (p === "granted") enablePushNotifications().catch(() => {}); }}
                    className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm hover:bg-[var(--surface-2)] transition-colors"
                  >
                    <Bell className="h-3.5 w-3.5" />
                    Allow reminders
                  </button>
                )}
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12">{children}</main>
    </div>
  );
}
