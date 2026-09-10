import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { TASK_COLOR } from "@/api";

const TYPES = [
  { id: "recurring", label: "Recurring", hint: "Takes a % of the block" },
  { id: "one_off", label: "One-off", hint: "Just a checkmark" },
  { id: "fixed", label: "Fixed", hint: "Locked clock time" },
];

const empty = {
  title: "",
  type: "recurring",
  share_pct: 25,
  min_minutes: 0,
  must_today: false,
  fixed_start: "",
  fixed_duration_min: 60,
  notes: "",
};

export default function TaskDialog({ open, onOpenChange, onSubmit, initial, block }) {
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const editing = !!initial;

  useEffect(() => {
    if (open) setForm(initial ? { ...empty, ...initial } : { ...empty, fixed_start: block?.start || "" });
  }, [open, initial, block]);

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const payload = editing
      ? {
          title: form.title,
          notes: form.notes,
          ...(form.type === "recurring"
            ? { share_pct: Number(form.share_pct), min_minutes: Number(form.min_minutes), must_today: form.must_today }
            : {}),
          ...(form.type === "fixed"
            ? { fixed_start: form.fixed_start, fixed_duration_min: Number(form.fixed_duration_min) }
            : {}),
        }
      : {
          ...form,
          share_pct: form.type === "recurring" ? Number(form.share_pct) : 0,
          min_minutes: form.type === "recurring" ? Number(form.min_minutes) : 0,
          must_today: form.type === "recurring" ? form.must_today : false,
          fixed_start: form.type === "fixed" ? form.fixed_start : null,
          fixed_duration_min: form.type === "fixed" ? Number(form.fixed_duration_min) : 0,
        };
    const res = await onSubmit(payload);
    setSaving(false);
    if (res?.ok !== false) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="task-dialog"
        className="max-w-lg border-[var(--hairline)] p-7 max-h-[90vh] overflow-y-auto"
        style={{ background: "var(--surface)" }}
      >
        <form onSubmit={submit} className="space-y-6">
          <div className="space-y-1">
            <p className="eyebrow">{block?.name}</p>
            <DialogTitle className="font-display text-xl font-bold">
              {editing ? "Edit task" : "New task"}
            </DialogTitle>
          </div>

          <div className="space-y-2">
            <Label className="eyebrow">Title</Label>
            <Input
              data-testid="task-title-input"
              autoFocus
              required
              value={form.title}
              onChange={(e) => set("title")(e.target.value)}
              placeholder="Thesis writing"
              className="h-11 bg-[var(--surface-2)] border-[var(--hairline)]"
            />
          </div>

          {!editing && (
            <div className="grid grid-cols-3 gap-2">
              {TYPES.map((t) => {
                const active = form.type === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    data-testid={`task-type-${t.id}`}
                    onClick={() => set("type")(t.id)}
                    className="p-3 rounded-xl border text-left transition-all"
                    style={{
                      borderColor: active ? TASK_COLOR[t.id] : "var(--hairline)",
                      background: active ? "var(--surface-2)" : "transparent",
                    }}
                  >
                    <p className="text-sm font-semibold" style={{ color: active ? TASK_COLOR[t.id] : undefined }}>
                      {t.label}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{t.hint}</p>
                  </button>
                );
              })}
            </div>
          )}

          {form.type === "recurring" && (
            <div className="space-y-6 p-5 rounded-xl" style={{ background: "var(--surface-2)" }}>
              <div className="space-y-3">
                <div className="flex items-baseline justify-between">
                  <Label className="eyebrow">Share of the block</Label>
                  <span className="mono text-sm" data-testid="task-share-value">
                    {form.share_pct}%
                  </span>
                </div>
                <Slider
                  data-testid="task-share-slider"
                  value={[Number(form.share_pct)]}
                  min={1}
                  max={100}
                  step={5}
                  onValueChange={(v) => set("share_pct")(v[0])}
                />
              </div>
              <div className="space-y-3">
                <div className="flex items-baseline justify-between">
                  <Label className="eyebrow">Never shorter than</Label>
                  <span className="mono text-sm" data-testid="task-min-value">
                    {Number(form.min_minutes) === 0 ? "no floor" : `${form.min_minutes} min`}
                  </span>
                </div>
                <Slider
                  data-testid="task-min-slider"
                  value={[Number(form.min_minutes)]}
                  min={0}
                  max={120}
                  step={5}
                  onValueChange={(v) => set("min_minutes")(v[0])}
                />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  If the day can&apos;t honour this, you get asked instead of silently losing the time.
                </p>
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label className="text-sm">Must be done today</Label>
                  <p className="text-xs text-muted-foreground">
                    Missed time is taken out of later blocks, never tomorrow.
                  </p>
                </div>
                <Switch
                  data-testid="task-must-today-switch"
                  checked={!!form.must_today}
                  onCheckedChange={set("must_today")}
                />
              </div>
            </div>
          )}

          {form.type === "fixed" && (
            <div className="grid grid-cols-2 gap-4 p-5 rounded-xl" style={{ background: "var(--surface-2)" }}>
              <div className="space-y-2">
                <Label className="eyebrow">Starts at</Label>
                <Input
                  data-testid="task-fixed-start-input"
                  type="time"
                  required
                  value={form.fixed_start || ""}
                  onChange={(e) => set("fixed_start")(e.target.value)}
                  className="h-11 mono bg-[var(--surface)] border-[var(--hairline)]"
                />
              </div>
              <div className="space-y-2">
                <Label className="eyebrow">Minutes</Label>
                <Input
                  data-testid="task-fixed-duration-input"
                  type="number"
                  min={5}
                  step={5}
                  required
                  value={form.fixed_duration_min}
                  onChange={(e) => set("fixed_duration_min")(e.target.value)}
                  className="h-11 mono bg-[var(--surface)] border-[var(--hairline)]"
                />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label className="eyebrow">Notes</Label>
            <Textarea
              data-testid="task-notes-input"
              rows={3}
              value={form.notes || ""}
              onChange={(e) => set("notes")(e.target.value)}
              placeholder="Anything you want in front of you while doing this."
              className="bg-[var(--surface-2)] border-[var(--hairline)] resize-none"
            />
          </div>

          <div className="flex gap-3 justify-end pt-1">
            <Button
              type="button"
              variant="ghost"
              data-testid="task-cancel-button"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              data-testid="task-save-button"
              disabled={saving}
              className="rounded-full px-6 font-semibold"
              style={{ background: "var(--sage)", color: "#0d0f12" }}
            >
              {editing ? "Save" : "Add task"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
