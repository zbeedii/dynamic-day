import { AlertTriangle, Clock, Shield } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { fmtMin } from "@/api";
import { useDay } from "@/context/DayContext";

const Choice = ({ testid, title, hint, onClick, tone }) => (
  <button
    data-testid={testid}
    onClick={onClick}
    className="w-full text-left p-5 rounded-xl border transition-all hover:translate-x-0.5"
    style={{
      background: "var(--surface-2)",
      borderColor: tone ? tone : "var(--hairline)",
    }}
  >
    <p className="font-display font-semibold text-base" style={{ color: tone || undefined }}>
      {title}
    </p>
    <p className="text-sm text-muted-foreground mt-1 leading-snug">{hint}</p>
  </button>
);

export default function DecisionDialog() {
  const { data, decide, complete, extend, skip } = useDay();
  const decision = data?.pending_decisions?.[0];
  if (!decision) return null;

  const block = data.blocks.find((b) => b.id === decision.block_id);
  const dropCandidates = (block?.tasks || []).filter(
    (t) => !t.done && !t.skipped && (t.type === "recurring" || t.type === "carry"),
  );

  const head = {
    late_start: {
      icon: <Clock className="h-4 w-4" />,
      eyebrow: "Conscious friction",
      title: `You're ${fmtMin(decision.delay_min)} into ${block?.name} without starting`,
      body: "Automatic rebalancing has stopped. Nothing on your schedule will move until you choose.",
    },
    min_protection: {
      icon: <Shield className="h-4 w-4" />,
      eyebrow: "Protected minimum",
      title: `${decision.title} would only get ${fmtMin(decision.allocated_min)}`,
      body: `You asked for at least ${fmtMin(decision.min_minutes)} of unbroken time on this. It is being held at its minimum until you decide.`,
    },
    overrun: {
      icon: <AlertTriangle className="h-4 w-4" />,
      eyebrow: "Running over",
      title: `${decision.title} is ${fmtMin(decision.over_min)} past its planned time`,
      body: "That is more than your friction threshold, so nothing is being reshuffled silently.",
    },
  }[decision.kind];

  return (
    <AlertDialog open>
      <AlertDialogContent
        data-testid="decision-dialog"
        className="max-w-lg border-[var(--hairline)] p-8"
        style={{ background: "var(--surface)" }}
      >
        <div className="space-y-6">
          <div className="space-y-3">
            <span className="eyebrow flex items-center gap-2" style={{ color: "var(--amber)" }}>
              {head.icon}
              {head.eyebrow}
            </span>
            <AlertDialogTitle className="font-display text-xl sm:text-2xl font-bold leading-snug">
              {head.title}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-muted-foreground leading-relaxed">
              {head.body}
            </AlertDialogDescription>
          </div>

          <div className="space-y-3">
            {decision.kind === "min_protection" && (
              <>
                <Choice
                  testid="decision-protect"
                  tone="var(--sage)"
                  title="Keep the minimum"
                  hint="Trim the other percentage tasks in this block to protect this one."
                  onClick={() => decide({ ...decision, action: "protect" })}
                />
                <Choice
                  testid="decision-accept-shorter"
                  title={`Accept ${fmtMin(decision.allocated_min)} today`}
                  hint="Let this task run shorter than its floor, just for today."
                  onClick={() => decide({ ...decision, action: "accept_shorter" })}
                />
                <Choice
                  testid="decision-drop-task"
                  title="Drop it from today"
                  hint="Its time goes back to the rest of the block."
                  onClick={() => decide({ ...decision, action: "drop_task" })}
                />
              </>
            )}

            {decision.kind === "late_start" && (
              <>
                <Choice
                  testid="decision-push-block"
                  tone="var(--amber)"
                  title="Push the block 15 minutes later"
                  hint="Only possible if the next block leaves room for the transition buffer."
                  onClick={() => decide({ ...decision, action: "push_block", minutes: 15 })}
                />
                <Choice
                  testid="decision-absorb"
                  title="Absorb the delay"
                  hint="Keep the block as it is and rebalance everything into the time that is left."
                  onClick={() => decide({ ...decision, action: "absorb" })}
                />
                {dropCandidates.map((t) => (
                  <Choice
                    key={t.id}
                    testid={`decision-drop-${t.id}`}
                    title={`Drop "${t.title}"`}
                    hint={`Frees ${fmtMin(t.need_min)} inside this block.`}
                    onClick={() => decide({ ...decision, task_id: t.id, action: "drop_task" })}
                  />
                ))}
              </>
            )}

            {decision.kind === "overrun" && (
              <>
                <Choice
                  testid="decision-extend"
                  tone="var(--amber)"
                  title="Give it 15 more minutes"
                  hint="Taken from the other tasks in this block."
                  onClick={async () => {
                    await extend(decision.task_id, 15);
                  }}
                />
                <Choice
                  testid="decision-finish-now"
                  tone="var(--sage)"
                  title="Finish it now"
                  hint="Mark it done and hand the leftover time back to the block."
                  onClick={async () => {
                    await complete(decision.task_id);
                  }}
                />
                <Choice
                  testid="decision-keep-going"
                  title="Keep going, stop asking"
                  hint="Accept the overrun and let the rest of the day rebalance silently."
                  onClick={() => decide({ ...decision, action: "acknowledge_overrun" })}
                />
                <Choice
                  testid="decision-overrun-drop"
                  title="Drop it"
                  hint="Give up on this task for today."
                  onClick={async () => {
                    await skip(decision.task_id);
                  }}
                />
              </>
            )}
          </div>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
