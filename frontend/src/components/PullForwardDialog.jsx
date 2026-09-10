import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { fmtMin } from "@/api";
import { useLocale } from "@/context/LocaleContext";

export default function PullForwardDialog({ open, onOpenChange, task, onPull, onFinish }) {
  const { t } = useLocale();
  const max = Math.max(0, Math.round(task?.future_remaining_min || 0));
  const [amount, setAmount] = useState(Math.min(15, max));
  useEffect(() => { if (open) setAmount(Math.min(15, max)); }, [open, max]);
  if (!task) return null;
  const presets = [15, 30, max].filter((v, i, a) => v > 0 && v <= max && a.indexOf(v) === i);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-[var(--hairline)]" style={{ background: "var(--surface)" }}>
        <DialogHeader>
          <DialogTitle className="font-display text-xl font-bold">{t("Pull forward")}</DialogTitle>
          <DialogDescription>
            {task.title} · {fmtMin(max)} {t("remaining")} today
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6 py-2">
          <div className="text-center">
            <div className="mono text-3xl font-bold">{fmtMin(amount)}</div>
            <div className="text-xs text-muted-foreground mt-1">of {fmtMin(max)} available</div>
          </div>
          <Slider value={[amount]} min={1} max={Math.max(1, max)} step={1} onValueChange={(v) => setAmount(v[0])} disabled={max < 1} />
          <div className="flex flex-wrap gap-2">
            {presets.map((v) => (
              <button key={v} onClick={() => setAmount(v)} className="px-3 py-2 rounded-full border text-xs mono" style={{ borderColor: "var(--hairline)" }}>
                {v === max ? t("All remaining") : `+${v}m`}
              </button>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => onOpenChange(false)} className="px-4 py-2 rounded-full text-sm">{t("Cancel")}</button>
            <button onClick={() => amount > 0 && onPull(amount)} disabled={max < 1} className="px-5 py-2 rounded-full text-sm font-semibold" style={{ background: "var(--sage)", color: "#0d0f12" }}>{t("Apply")}</button>
          </div>
          <button onClick={onFinish} disabled={max < 1} className="w-full px-4 py-2 rounded-full text-sm border" style={{ borderColor: "var(--hairline)" }}>
            {t("Finished for today")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
