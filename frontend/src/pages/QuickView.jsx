import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  ArrowRightLeft,
  Check,
  CheckCheck,
  CircleSlash,
  Lock,
  Play,
  Shield,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { fmtMin, prettyDate, TASK_COLOR, TASK_LABEL } from "@/api";
import DayWrapUp from "@/components/DayWrapUp";
import { useDay } from "@/context/DayContext";
import PullForwardDialog from "@/components/PullForwardDialog";

const useClock = () => {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(id);
  }, []);
  return now;
};

const t2m = (s) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};

function blockForTask(data, taskId) { return data?.blocks?.find((b) => b.tasks.some((t) => t.id === taskId)); }

function TaskLine({ task, active }) {
  const { start, complete, finishDay, pullForward, skip, data } = useDay();
  const [pullOpen, setPullOpen] = useState(false);
  const dueFixed = data.blocks.some((b) => b.due_fixed_task_id === task.id);
  const isFixed = task.type === "fixed";
  const futureRemaining = data.blocks.filter((b) => b.start > (blockForTask(data, task.id)?.start || "00:00")).reduce((sum, b) => sum + b.tasks.filter((x) => x.tkey === task.tkey && !x.done && !x.skipped).reduce((n, x) => n + (x.need_min || 0), 0), 0);

  return (
    <div
      data-testid={`now-task-${task.id}`}
      className="group p-5 rounded-xl transition-all"
      style={{
        background: active ? "var(--sage-soft)" : "var(--surface-2)",
        border: `1px solid ${dueFixed ? "var(--amber)" : active ? "var(--sage)" : "var(--hairline)"}`,
      }}
    >
      <div className="flex items-start gap-4">
        <span className="mt-1.5 h-2 w-2 rounded-full shrink-0" style={{ background: TASK_COLOR[task.type] }} />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="font-display font-semibold">{task.title}</p>
            {isFixed ? (
              <span className="mono text-xs flex items-center gap-1" style={{ color: "var(--amber)" }}>
                <Lock className="h-3 w-3" />
                {task.fixed_start} · {task.fixed_duration_min}m
              </span>
            ) : task.type === "one_off" ? (
              <span className="text-xs" style={{ color: TASK_COLOR.one_off }}>
                {TASK_LABEL.one_off}
              </span>
            ) : (
              <span className="mono text-xs" data-testid={`now-task-alloc-${task.id}`}>
                {fmtMin(task.allocated_min)} now
              </span>
            )}
            {task.type === "carry" && (
              <span className="text-xs" style={{ color: "var(--terracotta)" }}>
                carried from {task.carry_from}
              </span>
            )}
            {task.is_protected && (
              <span className="text-xs flex items-center gap-1" style={{ color: "var(--sage)" }}>
                <Shield className="h-3 w-3" />
                floor held
              </span>
            )}
            {task.over_min > 0 && (
              <span className="text-xs" style={{ color: "var(--terracotta)" }}>
                +{fmtMin(task.over_min)} over
              </span>
            )}
          </div>

          {(task.type === "recurring" || task.type === "carry") && (
            <div className="flex items-center gap-3">
              <Progress
                value={task.block_progress_pct}
                className="h-1.5 flex-1 bg-[var(--hairline)]"
              />
              <span className="mono text-[11px] text-muted-foreground">
                {task.day_progress_pct}% of today
              </span>
            </div>
          )}

          {task.notes && <p className="text-xs text-muted-foreground leading-relaxed">{task.notes}</p>}

          <div className="flex flex-wrap gap-2 pt-1">
            {!isFixed && task.type !== "one_off" && (
              <Link
                to="/focus"
                data-testid={`start-task-${task.id}`}
                onClick={() => start(task.id)}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full"
                style={{ background: "var(--sage)", color: "#0d0f12" }}
              >
                <Play className="h-3 w-3" />
                {active ? "Back to focus" : "Focus"}
              </Link>
            )}
            <button
              data-testid={`done-task-${task.id}`}
              onClick={() => complete(task.id)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors hover:bg-[var(--sage-soft)]"
              style={{ borderColor: "var(--hairline)" }}
            >
              <Check className="h-3 w-3" />
              Done here
            </button>
            {(task.type === "recurring" || task.type === "carry") && task.day_progress_pct < 100 && (
              <button
                data-testid={`finish-day-task-${task.id}`}
                onClick={() => setPullOpen(true)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors hover:bg-[var(--sage-soft)]"
                style={{ borderColor: "var(--hairline)" }}
              >
                <CheckCheck className="h-3 w-3" />
                Finished for today
              </button>
            )}
            <button
              data-testid={`skip-task-${task.id}`}
              onClick={() => skip(task.id)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <CircleSlash className="h-3 w-3" />
              Drop
            </button>
          </div>
        </div>
      </div>
      <PullForwardDialog
        open={pullOpen}
        onOpenChange={setPullOpen}
        task={{ ...task, future_remaining_min: Math.round(futureRemaining) }}
        onPull={async (minutes) => { const res = await pullForward(task.id, minutes); if (res.ok) setPullOpen(false); }}
        onFinish={async () => { const res = await finishDay(task.id); if (res?.ok !== false) setPullOpen(false); }}
      />
    </div>
  );
}

const order = { fixed: 0, carry: 1, recurring: 2, one_off: 3 };

function BlockPanel({ block, isCurrent, nowM }) {
  const live = block.tasks.filter((t) => !t.done && !t.skipped).sort((a, b) => order[a.type] - order[b.type]);
  const done = block.tasks.filter((t) => t.done && !t.completed_early);
  const elapsed = isCurrent ? Math.min(100, ((nowM - t2m(block.start)) / block.duration_min) * 100) : 0;

  return (
    <section
      data-testid={isCurrent ? "current-block" : "next-block"}
      className={`surface p-7 sm:p-8 space-y-6 rise ${isCurrent ? "glow-sage" : ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <p className="eyebrow" style={{ color: isCurrent ? "var(--sage)" : undefined }}>
            {isCurrent ? "Happening now" : "Up next"}
          </p>
          <h2 className="font-display text-2xl sm:text-3xl font-bold">{block.name}</h2>
          <p className="mono text-sm text-muted-foreground">
            {block.start} – {block.end}
          </p>
        </div>
        <div className="text-right">
          <p className="mono text-3xl sm:text-4xl font-bold" data-testid={`${isCurrent ? "current" : "next"}-remaining`}>
            {isCurrent ? fmtMin(block.remaining_min) : fmtMin(t2m(block.start) - nowM)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">{isCurrent ? "left in this block" : "until it starts"}</p>
        </div>
      </div>

      {isCurrent && <Progress value={elapsed} className="h-1 bg-[var(--hairline)]" />}

      <div className="space-y-3">
        {live.length === 0 && (
          <p className="text-sm text-muted-foreground">Everything in this block is settled.</p>
        )}
        {live.map((t) => (
          <TaskLine key={t.id} task={t} active={!!t.active_since} />
        ))}
      </div>

      {block.free_min >= 1 && (
        <p className="mono text-xs text-muted-foreground" data-testid={`${isCurrent ? "current" : "next"}-slack`}>
          {fmtMin(block.free_min)} unclaimed in this block
        </p>
      )}

      {done.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-2 border-t border-[var(--hairline)]">
          {done.map((t) => (
            <span
              key={t.id}
              data-testid={`done-chip-${t.id}`}
              className="text-xs px-3 py-1.5 rounded-full flex items-center gap-1.5 text-muted-foreground"
              style={{ background: "var(--surface-2)" }}
            >
              <Check className="h-3 w-3" style={{ color: "var(--sage)" }} />
              {t.title}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

export default function QuickView() {
  const { data, loading, date } = useDay();
  const now = useClock();
  const nowM = now.getHours() * 60 + now.getMinutes();

  const shortfall = useMemo(() => {
    if (!data?.blocks) return 0;
    const open = data.blocks.filter((b) => b.status !== "past");
    const need = open.reduce(
      (a, b) =>
        a +
        b.tasks
          .filter((t) => t.must_today && !t.done && !t.skipped)
          .reduce((x, t) => x + t.need_min, 0),
      0,
    );
    const capacity = open.reduce((a, b) => a + b.remaining_min, 0);
    return Math.round(need - capacity);
  }, [data]);

  if (loading) return <p className="text-muted-foreground">Reading your day…</p>;

  const current = data?.blocks?.find((b) => b.id === data.current_block_id);
  const next = data?.blocks?.find((b) => b.id === data.next_block_id);

  return (
    <div className="max-w-3xl mx-auto space-y-8" data-testid="quick-view">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <p className="eyebrow">{prettyDate(date)}</p>
          <h1 className="font-display text-3xl sm:text-4xl font-extrabold">
            {current ? "Now & next" : data?.day_over ? "The day is done" : data?.exists ? "Between blocks" : "An open day"}
          </h1>
        </div>
        <p className="mono text-2xl" data-testid="wall-clock">
          {String(now.getHours()).padStart(2, "0")}:{String(now.getMinutes()).padStart(2, "0")}
        </p>
      </header>

      {!data?.exists && (
        <div className="surface p-8 space-y-4 text-center" data-testid="empty-day">
          <p className="text-base text-muted-foreground leading-relaxed">
            No blocks on this date yet. Assign a template or build the day by hand.
          </p>
          <Link
            to="/plan"
            data-testid="go-to-planning"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full font-semibold text-sm"
            style={{ background: "var(--sage)", color: "#0d0f12" }}
          >
            Open planning
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      )}

      {shortfall > 0 && (
        <div
          data-testid="quota-warning"
          className="p-5 rounded-xl flex items-start gap-3"
          style={{ background: "rgba(217,119,87,0.12)", border: "1px solid var(--terracotta)" }}
        >
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" style={{ color: "var(--terracotta)" }} />
          <p className="text-sm leading-relaxed">
            <span className="font-semibold">{fmtMin(shortfall)} of must-do work has no room left today.</span>{" "}
            Nothing carries to tomorrow — shorten, drop, or extend a block while there is still time.
          </p>
        </div>
      )}

      {data?.in_buffer && (
        <div
          data-testid="buffer-card"
          className="surface p-7 flex items-center gap-4"
          style={{ borderColor: "var(--amber)" }}
        >
          <ArrowRightLeft className="h-5 w-5 breathe" style={{ color: "var(--amber)" }} />
          <div>
            <p className="font-display font-semibold">Transition</p>
            <p className="text-sm text-muted-foreground">
              Protected buffer after {data.in_buffer.after} until{" "}
              <span className="mono">{data.in_buffer.until}</span>. Nothing is scheduled here on purpose.
            </p>
          </div>
        </div>
      )}

      <DayWrapUp />

      {current && <BlockPanel block={current} isCurrent nowM={nowM} />}
      {next && <BlockPanel block={next} isCurrent={false} nowM={nowM} />}

      {data?.exists && !current && !next && !data?.day_over && (
        <p className="text-muted-foreground" data-testid="day-finished">
          The day&apos;s blocks are behind you. Nothing more is scheduled.
        </p>
      )}
    </div>
  );
}
