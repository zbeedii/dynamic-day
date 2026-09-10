import { useEffect, useState } from "react";
import { RotateCcw, X } from "lucide-react";
import { useDay } from "@/context/DayContext";

const WINDOW = 5000;

export default function UndoBar() {
  const { undoItem, undo, dismissUndo } = useDay();
  const [left, setLeft] = useState(WINDOW);

  useEffect(() => {
    if (!undoItem) return;
    setLeft(WINDOW);
    const started = Date.now();
    const id = setInterval(() => {
      const rem = WINDOW - (Date.now() - started);
      setLeft(rem);
      if (rem <= 0) {
        clearInterval(id);
        dismissUndo();
      }
    }, 100);
    return () => clearInterval(id);
  }, [undoItem, dismissUndo]);

  if (!undoItem) return null;
  const pct = Math.max(0, left / WINDOW);
  const C = 2 * Math.PI * 12;

  return (
    <div
      data-testid="undo-bar"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rise w-[calc(100%-2rem)] sm:w-auto"
    >
      <div className="surface-raised glow-sage flex items-center gap-4 px-5 py-4 shadow-2xl">
        <svg width="30" height="30" viewBox="0 0 30 30" className="shrink-0 -rotate-90">
          <circle cx="15" cy="15" r="12" fill="none" stroke="var(--hairline)" strokeWidth="3" />
          <circle
            cx="15"
            cy="15"
            r="12"
            fill="none"
            stroke="var(--sage)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - pct)}
          />
        </svg>
        <p data-testid="undo-label" className="text-sm max-w-sm leading-snug">
          {undoItem.label}
        </p>
        <button
          data-testid="undo-button"
          onClick={undo}
          className="flex items-center gap-2 text-sm font-semibold px-3 py-1.5 rounded-full transition-colors hover:bg-[var(--sage-soft)]"
          style={{ color: "var(--sage)" }}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Undo
        </button>
        <button
          data-testid="undo-dismiss"
          onClick={dismissUndo}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
