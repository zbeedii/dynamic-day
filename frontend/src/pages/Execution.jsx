import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Check, ChevronLeft, Pause, Play, Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { fmtMin } from "@/api";
import { useDay } from "@/context/DayContext";

const order = { fixed: 0, carry: 1, recurring: 2, one_off: 3 };

function Ring({ pct, children }) {
  const R = 132;
  const C = 2 * Math.PI * R;
  return (
    <div className="relative h-[300px] w-[300px] grid place-items-center">
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 300 300">
        <circle cx="150" cy="150" r={R} fill="none" stroke="var(--hairline)" strokeWidth="6" />
        <circle
          cx="150"
          cy="150"
          r={R}
          fill="none"
          stroke="var(--sage)"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - Math.max(0, Math.min(1, pct)))}
          style={{ transition: "stroke-dashoffset 1s linear" }}
        />
      </svg>
      <div className="text-center space-y-1">{children}</div>
    </div>
  );
}

export default function Execution() {
  const { data, loading, start, pause, complete, finishDay, extend, addSub, toggleSub, deleteSub } = useDay();
  const [tick, setTick] = useState(Date.now());
  const [sub, setSub] = useState("");

  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const block = data?.blocks?.find((b) => b.id === data.current_block_id);
  const task = useMemo(() => {
    if (!block) return null;
    const live = block.tasks.filter((t) => !t.done && !t.skipped);
    return live.find((t) => t.active_since) || live.sort((a, b) => order[a.type] - order[b.type])[0] || null;
  }, [block]);

  const calm = data?.settings?.calm_background;
  const running = !!task?.active_since;
  const totalSec = Math.max(60, (task?.allocated_min || 0) * 60);
  const leftSec = running && task?.ends_at
    ? Math.max(0, Math.round((new Date(task.ends_at).getTime() - tick) / 1000))
    : totalSec;
  const pct = leftSec / totalSec;
  const mm = String(Math.floor(leftSec / 60)).padStart(2, "0");
  const ss = String(leftSec % 60).padStart(2, "0");

  return (
    <div className="min-h-screen relative overflow-hidden" style={{ background: "#0b0d10" }} data-testid="execution-mode">
      {calm && (
        <>
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[720px] w-[720px] rounded-full breathe pointer-events-none"
            style={{ background: "radial-gradient(circle, rgba(134,167,137,0.12), transparent 62%)" }}
          />
          <div
            className="absolute -bottom-40 -right-20 h-[420px] w-[420px] rounded-full breathe pointer-events-none"
            style={{ background: "radial-gradient(circle, rgba(224,169,109,0.08), transparent 65%)" }}
          />
        </>
      )}

      <Link
        to="/"
        data-testid="exit-execution"
        className="absolute top-6 left-6 z-10 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="h-4 w-4" />
        Leave focus
      </Link>

      <div className="relative min-h-screen flex flex-col items-center justify-center px-6 py-24">
        {loading && (
          <p className="text-sm text-muted-foreground fade" data-testid="execution-loading">
            Reading your day…
          </p>
        )}
        {!loading && !task && (
          <div className="text-center space-y-4 max-w-sm fade" data-testid="execution-idle">
            <p className="eyebrow">Nothing running</p>
            <h1 className="font-display text-2xl font-bold">
              {data?.next_block_id ? "You are between blocks" : "No block is active"}
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Focus mode stays empty until a block is live. That is deliberate.
            </p>
          </div>
        )}

        {!loading && task && (
          <div className="w-full max-w-md flex flex-col items-center gap-10 fade">
            <div className="text-center space-y-2">
              <p className="eyebrow">{block.name}</p>
              <h1 className="font-display text-2xl sm:text-3xl font-bold" data-testid="focus-task-title">
                {task.title}
              </h1>
            </div>

            <Ring pct={running ? pct : 1}>
              <p className="mono text-5xl font-bold" data-testid="focus-countdown">
                {mm}:{ss}
              </p>
              <p className="text-xs text-muted-foreground">
                {running ? "remaining" : `${fmtMin(task.allocated_min)} allotted`}
              </p>
            </Ring>

            {task.notes && (
              <p className="text-sm text-muted-foreground text-center leading-relaxed max-w-sm">
                {task.notes}
              </p>
            )}

            <div className="w-full space-y-2">
              {(task.subtasks || []).map((s) => (
                <div
                  key={s.id}
                  className="group flex items-center gap-3 px-4 py-3 rounded-xl"
                  style={{ background: "rgba(30,34,42,0.6)" }}
                >
                  <button
                    data-testid={`toggle-sub-${s.id}`}
                    onClick={() => toggleSub(task.id, s.id)}
                    className="h-5 w-5 shrink-0 rounded-md grid place-items-center transition-all"
                    style={{
                      border: `1px solid ${s.done ? "var(--sage)" : "var(--hairline)"}`,
                      background: s.done ? "var(--sage)" : "transparent",
                    }}
                  >
                    {s.done && <Check className="h-3 w-3" style={{ color: "#0d0f12" }} />}
                  </button>
                  <span className={`text-sm flex-1 ${s.done ? "line-through text-muted-foreground" : ""}`}>
                    {s.title}
                  </span>
                  <button
                    data-testid={`delete-sub-${s.id}`}
                    onClick={() => deleteSub(task.id, s.id)}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-[var(--terracotta)] transition-all"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}

              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!sub.trim()) return;
                  await addSub(task.id, sub.trim());
                  setSub("");
                }}
                className="flex gap-2"
              >
                <Input
                  data-testid="sub-input"
                  value={sub}
                  onChange={(e) => setSub(e.target.value)}
                  placeholder="Add a quick step"
                  className="h-10 bg-transparent border-[var(--hairline)]"
                />
                <button
                  type="submit"
                  data-testid="add-sub-button"
                  className="h-10 w-10 grid place-items-center rounded-lg text-muted-foreground hover:text-[var(--sage)]"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </form>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3">
              {running ? (
                <button
                  data-testid="pause-button"
                  onClick={() => pause(task.id)}
                  className="flex items-center gap-2 px-5 h-11 rounded-full text-sm border"
                  style={{ borderColor: "var(--hairline)" }}
                >
                  <Pause className="h-3.5 w-3.5" />
                  Pause
                </button>
              ) : (
                <button
                  data-testid="start-button"
                  onClick={() => start(task.id)}
                  className="flex items-center gap-2 px-6 h-11 rounded-full text-sm font-semibold"
                  style={{ background: "var(--sage)", color: "#0d0f12" }}
                >
                  <Play className="h-3.5 w-3.5" />
                  Start
                </button>
              )}
              <button
                data-testid="extend-5-button"
                onClick={() => extend(task.id, 5)}
                className="px-4 h-11 rounded-full text-sm mono border"
                style={{ borderColor: "var(--hairline)" }}
              >
                +5m
              </button>
              <button
                data-testid="extend-10-button"
                onClick={() => extend(task.id, 10)}
                className="px-4 h-11 rounded-full text-sm mono border"
                style={{ borderColor: "var(--hairline)" }}
              >
                +10m
              </button>
              <button
                data-testid="focus-done-button"
                onClick={() => complete(task.id)}
                className="flex items-center gap-2 px-5 h-11 rounded-full text-sm border"
                style={{ borderColor: "var(--sage)", color: "var(--sage)" }}
              >
                <Check className="h-3.5 w-3.5" />
                Done
              </button>
              {(task.type === "recurring" || task.type === "carry") && (
                <button
                  data-testid="focus-finish-day-button"
                  onClick={() => finishDay(task.id)}
                  className="px-4 h-11 rounded-full text-sm text-muted-foreground hover:text-foreground"
                >
                  Finished for today
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
