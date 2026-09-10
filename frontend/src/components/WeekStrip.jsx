import { useCallback, useEffect, useState } from "react";
import { CalendarRange, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { client, errMsg, prettyDate, todayStr } from "@/api";

const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const shift = (iso, days) => {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return todayStr(dt);
};

const mondayOf = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return shift(iso, -((dt.getDay() + 6) % 7));
};

export default function WeekStrip({ date, setDate, templates, onChanged }) {
  const [start, setStart] = useState(mondayOf(date));
  const [days, setDays] = useState([]);
  const [tplId, setTplId] = useState("");
  const [busy, setBusy] = useState(false);
  const today = todayStr();

  const load = useCallback(async (s) => {
    try {
      const { data } = await client.get("/week", { params: { start: s } });
      setDays(data.days);
    } catch (e) {
      toast.error(errMsg(e));
    }
  }, []);

  useEffect(() => {
    load(start);
  }, [start, load]);

  useEffect(() => {
    if (!tplId && templates.length) setTplId(templates[0].id);
  }, [templates, tplId]);

  const fill = async (scope) => {
    if (!tplId) return;
    const dates = days
      .filter((d) => (scope === "weekdays" ? WD.indexOf(weekdayOf(d.date)) < 5 : true))
      .map((d) => d.date);
    setBusy(true);
    try {
      const { data } = await client.post("/week/assign", { template_id: tplId, dates });
      const parts = [`${data.template_name} added to ${data.assigned.length} day${data.assigned.length === 1 ? "" : "s"}`];
      if (data.skipped.length) parts.push(`${data.skipped.length} already planned, left untouched`);
      toast.success(parts.join(" · "));
      await load(start);
      onChanged?.();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const weekdayOf = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return WD[(new Date(y, m - 1, d).getDay() + 6) % 7];
  };

  return (
    <div className="surface p-6 space-y-5" data-testid="week-strip">
      <div className="flex flex-wrap items-center gap-3">
        <span className="eyebrow flex items-center gap-2">
          <CalendarRange className="h-3.5 w-3.5" />
          Week of {prettyDate(start).replace(/^\w+, /, "")}
        </span>
        <div className="flex gap-1 ml-auto">
          <button
            data-testid="week-prev"
            onClick={() => setStart(shift(start, -7))}
            className="h-9 w-9 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-[var(--surface-2)]"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            data-testid="week-this"
            onClick={() => setStart(mondayOf(today))}
            className="h-9 px-4 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-[var(--surface-2)]"
          >
            This week
          </button>
          <button
            data-testid="week-next"
            onClick={() => setStart(shift(start, 7))}
            className="h-9 w-9 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-[var(--surface-2)]"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        {days.length === 0 &&
          Array.from({ length: 7 }).map((_, i) => (
            <div
              key={i}
              className="p-4 rounded-xl border h-[92px] animate-pulse"
              style={{ borderColor: "var(--hairline)", background: "var(--surface-2)" }}
            />
          ))}
        {days.map((d) => {
          const selected = d.date === date;
          const isToday = d.date === today;
          return (
            <button
              key={d.date}
              data-testid={`week-day-${d.date}`}
              aria-current={selected ? "date" : undefined}
              onClick={() => setDate(d.date)}
              className="p-4 rounded-xl text-left transition-all border"
              style={{
                borderColor: selected ? "var(--sage)" : "var(--hairline)",
                background: selected ? "var(--sage-soft)" : "var(--surface-2)",
              }}
            >
              <div className="flex items-baseline gap-2">
                <span className="eyebrow" style={{ color: isToday ? "var(--amber)" : undefined }}>
                  {weekdayOf(d.date)}
                </span>
                <span className="mono text-sm">{d.date.slice(8)}</span>
              </div>
              {d.exists ? (
                <p
                  className="text-xs mt-2 truncate"
                  style={{ color: "var(--sage)" }}
                  data-testid={`week-planned-${d.date}`}
                >
                  {d.template_name || "Custom"}
                </p>
              ) : (
                <p className="text-xs mt-2 text-muted-foreground">free</p>
              )}
              {d.exists && (
                <p className="text-[11px] text-muted-foreground mt-0.5 mono">
                  {d.block_count} blocks · {d.task_count} tasks
                </p>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <select
          data-testid="week-template-select"
          value={tplId}
          onChange={(e) => setTplId(e.target.value)}
          className="h-10 px-3 rounded-lg text-sm bg-[var(--surface-2)] border border-[var(--hairline)]"
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button
          data-testid="week-fill-weekdays"
          disabled={busy || !tplId}
          onClick={() => fill("weekdays")}
          className="h-10 px-5 rounded-full text-sm font-semibold disabled:opacity-50"
          style={{ background: "var(--sage)", color: "#0d0f12" }}
        >
          Fill Mon–Fri
        </button>
        <button
          data-testid="week-fill-all"
          disabled={busy || !tplId}
          onClick={() => fill("all")}
          className="h-10 px-5 rounded-full text-sm border disabled:opacity-50"
          style={{ borderColor: "var(--hairline)" }}
        >
          Fill whole week
        </button>
        <p className="text-xs text-muted-foreground">Days that already have a plan are left untouched.</p>
      </div>
    </div>
  );
}
