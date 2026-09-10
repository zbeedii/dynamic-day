import { useState } from "react";
import { CircleSlash, MoonStar, Sunrise, X } from "lucide-react";
import { fmtMin, todayStr } from "@/api";
import { useDay } from "@/context/DayContext";

const tomorrowOf = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + 1);
  return todayStr(dt);
};

export default function DayWrapUp() {
  const { data, date, skipAll, defer } = useDay();
  const [dismissed, setDismissed] = useState(false);

  if (!data?.day_over || dismissed) return null;
  const leftovers = data.leftovers || [];
  const tomorrow = tomorrowOf(date);

  return (
    <section className="surface p-7 sm:p-8 space-y-6 rise" data-testid="day-wrapup" style={{ borderColor: "var(--amber)" }}>
      <div className="flex items-start gap-4">
        <MoonStar className="h-5 w-5 mt-1 shrink-0 breathe" style={{ color: "var(--amber)" }} />
        <div className="flex-1 space-y-1.5">
          <p className="eyebrow" style={{ color: "var(--amber)" }}>
            The day is over
          </p>
          <h2 className="font-display text-2xl font-bold text-foreground">
            {data.done_count} finished
            <span className="text-muted-foreground font-normal"> · {fmtMin(data.spent_total_min)} tracked</span>
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {leftovers.length === 0
              ? "Nothing was left behind. Close the laptop."
              : `${leftovers.length} thing${leftovers.length === 1 ? "" : "s"} didn't happen. Nothing carries by itself — drop it or send it to ${tomorrow}.`}
          </p>
        </div>
        <button
          data-testid="wrapup-dismiss"
          onClick={() => setDismissed(true)}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-2">
        {leftovers.map((l) => (
          <div
            key={l.task_id}
            data-testid={`leftover-${l.task_id}`}
            className="flex flex-wrap items-center gap-3 p-4 rounded-xl"
            style={{ background: "var(--surface-2)" }}
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{l.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {l.block_name}
                {l.need_min >= 1 ? ` · ${fmtMin(l.need_min)} left undone` : ""}
              </p>
            </div>
            <button
              data-testid={`leftover-defer-${l.task_id}`}
              onClick={() => defer(l.task_id, tomorrow)}
              className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-full"
              style={{ background: "var(--sage)", color: "#0d0f12" }}
            >
              <Sunrise className="h-3 w-3" />
              Move to tomorrow
            </button>
            <button
              data-testid={`leftover-drop-${l.task_id}`}
              onClick={() => skipAll(l.task_id)}
              className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-full border text-muted-foreground hover:text-[var(--terracotta)]"
              style={{ borderColor: "var(--hairline)" }}
            >
              <CircleSlash className="h-3 w-3" />
              Drop it
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
