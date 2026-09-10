import { useCallback, useEffect, useState } from "react";
import { CalendarDays, LayoutTemplate, Plus, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import BlockEditor from "@/components/BlockEditor";
import WeekStrip from "@/components/WeekStrip";
import { client, errMsg, prettyDate, todayStr } from "@/api";
import { useDay } from "@/context/DayContext";

function TemplatesPane() {
  const [templates, setTemplates] = useState([]);
  const [selected, setSelected] = useState(null);
  const [name, setName] = useState("");

  const load = useCallback(async () => {
    try {
      const { data } = await client.get("/templates");
      setTemplates(data);
      setSelected((prev) => (data.find((t) => t.id === prev) ? prev : data[0]?.id || null));
    } catch (e) {
      toast.error(errMsg(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (promise) => {
    try {
      const { data } = await promise;
      setTemplates((list) => list.map((t) => (t.id === data.id ? data : t)));
      return { ok: true };
    } catch (e) {
      toast.error(errMsg(e));
      return { ok: false };
    }
  };

  const tpl = templates.find((t) => t.id === selected);
  const base = `/templates/${selected}`;
  const api = {
    addBlock: (b) => run(client.post(`${base}/blocks`, b)),
    patchBlock: (id, b) => run(client.patch(`${base}/blocks/${id}`, b)),
    deleteBlock: (id) => run(client.delete(`${base}/blocks/${id}`)),
    splitBlock: (id, at) => run(client.post(`${base}/blocks/${id}/split`, { at })),
    addTask: (bid, t) => run(client.post(`${base}/blocks/${bid}/tasks`, t)),
    patchTask: (bid, tid, t) => run(client.patch(`${base}/blocks/${bid}/tasks/${tid}`, t)),
    deleteTask: (bid, tid) => run(client.delete(`${base}/blocks/${bid}/tasks/${tid}`)),
    moveTask: (tid, to) => run(client.post(`${base}/tasks/${tid}/move`, { to_block_id: to })),
  };

  const create = async (e) => {
    e.preventDefault();
    try {
      const { data } = await client.post("/templates", { name });
      setName("");
      setTemplates((l) => [...l, data]);
      setSelected(data.id);
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
      <aside className="lg:col-span-4 space-y-5">
        <div className="surface p-6 space-y-4">
          <p className="eyebrow">Your day templates</p>
          <div className="space-y-1">
            {templates.map((t) => (
              <button
                key={t.id}
                data-testid={`template-item-${t.id}`}
                onClick={() => setSelected(t.id)}
                className="w-full text-left px-4 py-3 rounded-xl transition-colors"
                style={
                  selected === t.id
                    ? { background: "var(--sage-soft)", color: "var(--sage)" }
                    : { color: "hsl(var(--foreground))" }
                }
              >
                <p className="text-sm font-medium">{t.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t.blocks.length} blocks ·{" "}
                  {t.blocks.reduce((a, b) => a + b.tasks.length, 0)} tasks
                </p>
              </button>
            ))}
            {templates.length === 0 && (
              <p className="text-sm text-muted-foreground py-2">No templates yet.</p>
            )}
          </div>
          <form onSubmit={create} className="flex gap-2 pt-2">
            <Input
              data-testid="new-template-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="University day"
              className="h-10 bg-[var(--surface-2)] border-[var(--hairline)]"
            />
            <Button
              type="submit"
              data-testid="create-template-button"
              className="h-10 rounded-full px-4"
              style={{ background: "var(--sage)", color: "#0d0f12" }}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </aside>

      <section className="lg:col-span-8 space-y-6">
        {!tpl && <p className="text-muted-foreground">Pick or create a template to shape it.</p>}
        {tpl && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Input
                data-testid="template-name-input"
                defaultValue={tpl.name}
                key={tpl.id}
                onBlur={(e) =>
                  e.target.value !== tpl.name && run(client.patch(`${base}`, { name: e.target.value }))
                }
                className="h-11 flex-1 min-w-[220px] font-display text-lg font-semibold bg-transparent border-transparent hover:bg-[var(--surface-2)] focus:bg-[var(--surface-2)]"
              />
              <button
                data-testid="delete-template-button"
                onClick={async () => {
                  await client.delete(base);
                  setSelected(null);
                  load();
                }}
                className="h-11 w-11 grid place-items-center rounded-full text-muted-foreground hover:text-[var(--terracotta)] hover:bg-[var(--surface-2)]"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <BlockEditor blocks={tpl.blocks} api={api} prefix="tpl" />
          </>
        )}
      </section>
    </div>
  );
}

function DayPane() {
  const { date, setDate, data, loading, assign, clearDay, refresh, addBlock, patchBlock, deleteBlock, splitBlock, addTask, patchTask, deleteTask, moveTask } =
    useDay();
  const [templates, setTemplates] = useState([]);

  useEffect(() => {
    client
      .get("/templates")
      .then(({ data: d }) => setTemplates(d))
      .catch((e) => toast.error(errMsg(e)));
  }, []);

  const api = {
    addBlock,
    patchBlock,
    deleteBlock,
    splitBlock,
    addTask,
    patchTask: (_b, tid, t) => patchTask(tid, t),
    deleteTask: (_b, tid) => deleteTask(tid),
    moveTask,
  };

  return (
    <div className="space-y-8">
      <WeekStrip date={date} setDate={setDate} templates={templates} onChanged={refresh} />

      <div className="surface p-6 flex flex-wrap items-end gap-6">
        <div className="space-y-2">
          <Label className="eyebrow">Day</Label>
          <Input
            data-testid="plan-date-input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value || todayStr())}
            className="h-10 mono bg-[var(--surface-2)] border-[var(--hairline)]"
          />
        </div>
        <div className="space-y-2 flex-1 min-w-[220px]">
          <Label className="eyebrow">Assign a template</Label>
          <div className="flex flex-wrap gap-2">
            {templates.map((t) => (
              <button
                key={t.id}
                data-testid={`assign-template-${t.id}`}
                onClick={() => assign(t.id)}
                className="flex items-center gap-2 px-4 h-10 rounded-full text-sm border transition-colors hover:bg-[var(--sage-soft)]"
                style={{ borderColor: "var(--hairline)" }}
              >
                <Wand2 className="h-3.5 w-3.5" style={{ color: "var(--sage)" }} />
                {t.name}
              </button>
            ))}
          </div>
        </div>
        {data?.exists && (
          <button
            data-testid="clear-day-button"
            onClick={clearDay}
            className="h-10 px-4 rounded-full text-sm text-muted-foreground hover:text-[var(--terracotta)] border"
            style={{ borderColor: "var(--hairline)" }}
          >
            Clear this day
          </button>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="font-display text-xl font-semibold">{prettyDate(date)}</h3>
        <p className="text-sm text-muted-foreground">
          {data?.exists
            ? `Based on ${data.template_name || "a custom day"} — edits here only affect this day.`
            : "Nothing planned yet. Assign a template above or add blocks by hand."}
        </p>
      </div>

      {!loading && <BlockEditor blocks={data?.blocks || []} api={api} prefix="day" />}
    </div>
  );
}

export default function Planning() {
  return (
    <div className="space-y-10" data-testid="planning-page">
      <div className="space-y-3 max-w-2xl">
        <p className="eyebrow">Advance planning</p>
        <h1 className="font-display text-3xl sm:text-4xl font-extrabold">Shape the day</h1>
        <p className="text-base text-muted-foreground leading-relaxed">
          Blocks hold time. Percentages decide how it gets divided. Transitions between split blocks
          are protected and never handed to a task.
        </p>
      </div>

      <Tabs defaultValue="day">
        <TabsList
          className="rounded-full p-1 h-11"
          style={{ background: "var(--surface-2)" }}
        >
          <TabsTrigger value="day" data-testid="tab-this-day" className="rounded-full px-5 gap-2">
            <CalendarDays className="h-3.5 w-3.5" />
            This day
          </TabsTrigger>
          <TabsTrigger value="templates" data-testid="tab-templates" className="rounded-full px-5 gap-2">
            <LayoutTemplate className="h-3.5 w-3.5" />
            Templates
          </TabsTrigger>
        </TabsList>
        <TabsContent value="day" className="mt-8">
          <DayPane />
        </TabsContent>
        <TabsContent value="templates" className="mt-8">
          <TemplatesPane />
        </TabsContent>
      </Tabs>
    </div>
  );
}
