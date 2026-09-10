import { useState } from "react";
import { ArrowRightLeft, GripVertical, MoveRight, Pencil, Plus, Scissors, Shield, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import TaskDialog from "@/components/TaskDialog";
import { TASK_COLOR, TASK_LABEL } from "@/api";

const TaskRow = ({ task, blockId, blocks, onMove, onEdit, onDelete, prefix }) => (
  <div
    data-testid={`${prefix}-task-${task.id}`}
    draggable
    onDragStart={(e) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", JSON.stringify({ taskId: task.id, from: blockId }));
    }}
    className="group flex items-start gap-2 p-4 rounded-xl transition-colors hover:bg-[var(--surface-2)] cursor-grab active:cursor-grabbing"
  >
    <GripVertical className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground opacity-40 group-hover:opacity-100 transition-opacity" />
    <span className="mt-1.5 h-2 w-2 rounded-full shrink-0" style={{ background: TASK_COLOR[task.type] }} />
    <div className="min-w-0 flex-1">
      <p className="text-sm font-medium truncate">{task.title}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-muted-foreground">
        <span style={{ color: TASK_COLOR[task.type] }}>{TASK_LABEL[task.type]}</span>
        {task.type === "recurring" && <span className="mono">{task.share_pct}%</span>}
        {task.type === "fixed" && (
          <span className="mono">
            {task.fixed_start} · {task.fixed_duration_min}m
          </span>
        )}
        {task.min_minutes > 0 && (
          <span className="flex items-center gap-1">
            <Shield className="h-3 w-3" />
            min {task.min_minutes}m
          </span>
        )}
        {task.must_today && <span style={{ color: "var(--terracotta)" }}>must today</span>}
      </div>
      {task.notes && (
        <p className="text-xs text-muted-foreground mt-2 leading-relaxed line-clamp-2">{task.notes}</p>
      )}
    </div>
    <div className="flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
      {blocks.length > 1 && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              data-testid={`${prefix}-move-task-${task.id}`}
              title="Move to another block"
              className="h-8 w-8 grid place-items-center rounded-lg text-muted-foreground hover:text-[var(--sage)]"
            >
              <MoveRight className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-64 p-2 border-[var(--hairline)]"
            style={{ background: "var(--surface)" }}
          >
            <p className="eyebrow px-2 py-2">Move to</p>
            {blocks
              .filter((b) => b.id !== blockId)
              .map((b) => (
                <button
                  key={b.id}
                  data-testid={`${prefix}-move-${task.id}-to-${b.id}`}
                  onClick={() => onMove(b.id)}
                  className="w-full text-left px-2 py-2 rounded-lg text-sm hover:bg-[var(--surface-2)] transition-colors"
                >
                  {b.name} <span className="mono text-xs text-muted-foreground ml-1">{b.start}</span>
                </button>
              ))}
          </PopoverContent>
        </Popover>
      )}
      <button
        data-testid={`${prefix}-edit-task-${task.id}`}
        onClick={onEdit}
        className="h-8 w-8 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button
        data-testid={`${prefix}-delete-task-${task.id}`}
        onClick={onDelete}
        className="h-8 w-8 grid place-items-center rounded-lg text-muted-foreground hover:text-[var(--terracotta)]"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  </div>
);

function BlockCard({ block, blocks, api, prefix }) {
  const [taskOpen, setTaskOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [splitAt, setSplitAt] = useState("");
  const [over, setOver] = useState(false);
  const shares = block.tasks.filter((t) => t.type === "recurring").reduce((a, t) => a + (t.share_pct || 0), 0);

  const field = (key, type = "text", extra = "") => (
    <Input
      data-testid={`${prefix}-block-${key}-${block.id}`}
      type={type}
      defaultValue={block[key]}
      onBlur={(e) => e.target.value !== block[key] && api.patchBlock(block.id, { [key]: e.target.value })}
      className={`h-9 border-transparent bg-transparent hover:bg-[var(--surface-2)] focus:bg-[var(--surface-2)] px-2 ${extra}`}
    />
  );

  return (
    <div
      data-testid={`${prefix}-block-${block.id}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        try {
          const p = JSON.parse(e.dataTransfer.getData("text/plain"));
          if (p.taskId && p.from !== block.id) api.moveTask(p.taskId, block.id);
        } catch {
          /* ignore */
        }
      }}
      className="surface p-6 space-y-4 transition-all"
      style={over ? { borderColor: "var(--sage)", background: "var(--sage-soft)" } : undefined}
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[160px]">{field("name", "text", "font-display font-semibold text-base")}</div>
        <div className="flex items-center gap-1 mono text-sm">
          {field("start", "time", "w-[110px] mono")}
          <span className="text-muted-foreground">–</span>
          {field("end", "time", "w-[110px] mono")}
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <button
              data-testid={`${prefix}-split-open-${block.id}`}
              title="Split this block"
              className="h-9 w-9 grid place-items-center rounded-lg text-muted-foreground hover:text-[var(--sage)] hover:bg-[var(--surface-2)]"
            >
              <Scissors className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="w-72 p-5 space-y-4 border-[var(--hairline)]"
            style={{ background: "var(--surface)" }}
          >
            <div className="space-y-1">
              <Label className="eyebrow">Split at</Label>
              <p className="text-xs text-muted-foreground leading-relaxed">
                The first half ends here; a protected 5-minute transition follows before the second half.
              </p>
            </div>
            <Input
              data-testid={`${prefix}-split-time-${block.id}`}
              type="time"
              value={splitAt}
              onChange={(e) => setSplitAt(e.target.value)}
              className="h-10 mono bg-[var(--surface-2)] border-[var(--hairline)]"
            />
            <Button
              data-testid={`${prefix}-split-confirm-${block.id}`}
              onClick={() => splitAt && api.splitBlock(block.id, splitAt)}
              className="w-full rounded-full font-semibold"
              style={{ background: "var(--sage)", color: "#0d0f12" }}
            >
              Split block
            </Button>
          </PopoverContent>
        </Popover>
        <button
          data-testid={`${prefix}-delete-block-${block.id}`}
          onClick={() => api.deleteBlock(block.id)}
          className="h-9 w-9 grid place-items-center rounded-lg text-muted-foreground hover:text-[var(--terracotta)] hover:bg-[var(--surface-2)]"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="flex items-center gap-3">
        <div className="h-1.5 flex-1 rounded-full overflow-hidden" style={{ background: "var(--hairline)" }}>
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${Math.min(100, shares)}%`, background: "var(--sage)" }}
          />
        </div>
        <span className="mono text-xs text-muted-foreground" data-testid={`${prefix}-shares-${block.id}`}>
          {shares}% shared · {Math.max(0, 100 - shares)}% slack
        </span>
      </div>

      <div className="space-y-1">
        {block.tasks.length === 0 && (
          <p className="text-sm text-muted-foreground px-4 py-3">
            Nothing planned here yet — drop a task in or add one.
          </p>
        )}
        {block.tasks.map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            blockId={block.id}
            blocks={blocks}
            prefix={prefix}
            onMove={(to) => api.moveTask(t.id, to)}
            onEdit={() => {
              setEditing(t);
              setTaskOpen(true);
            }}
            onDelete={() => api.deleteTask(block.id, t.id)}
          />
        ))}
      </div>

      <button
        data-testid={`${prefix}-add-task-${block.id}`}
        onClick={() => {
          setEditing(null);
          setTaskOpen(true);
        }}
        className="flex items-center gap-2 text-sm px-4 py-2 rounded-full transition-colors hover:bg-[var(--sage-soft)]"
        style={{ color: "var(--sage)" }}
      >
        <Plus className="h-3.5 w-3.5" />
        Add task
      </button>

      <TaskDialog
        open={taskOpen}
        onOpenChange={setTaskOpen}
        initial={editing}
        block={block}
        onSubmit={(payload) =>
          editing ? api.patchTask(block.id, editing.id, payload) : api.addTask(block.id, payload)
        }
      />
    </div>
  );
}

export default function BlockEditor({ blocks, api, prefix, bufferMin = 5 }) {
  const [form, setForm] = useState({ name: "", start: "09:00", end: "12:00" });

  const add = async (e) => {
    e.preventDefault();
    const res = await api.addBlock(form);
    if (res?.ok !== false) setForm({ name: "", start: form.end, end: form.end });
  };

  return (
    <div className="space-y-4">
      {blocks.length > 1 && (
        <p className="text-xs text-muted-foreground px-1">
          Drag a task onto another block to move it, or use its move button.
        </p>
      )}
      {blocks.map((b, i) => (
        <div key={b.id} className="space-y-4">
          <BlockCard block={b} blocks={blocks} api={api} prefix={prefix} />
          {i < blocks.length - 1 && (
            <div className="flex items-center gap-3 pl-6" data-testid={`${prefix}-buffer-${b.id}`}>
              <ArrowRightLeft className="h-3 w-3" style={{ color: "var(--amber)" }} />
              <span className="mono text-xs" style={{ color: "var(--amber)" }}>
                {b.buffer_after_min || bufferMin}m transition
              </span>
              <span className="h-px flex-1" style={{ background: "var(--hairline)" }} />
            </div>
          )}
        </div>
      ))}

      <form onSubmit={add} className="surface-raised p-6 flex flex-wrap items-end gap-4">
        <div className="space-y-2 flex-1 min-w-[180px]">
          <Label className="eyebrow">New block</Label>
          <Input
            data-testid={`${prefix}-new-block-name`}
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Evening – Personal"
            className="h-10 bg-[var(--surface)] border-[var(--hairline)]"
          />
        </div>
        <div className="space-y-2">
          <Label className="eyebrow">From</Label>
          <Input
            data-testid={`${prefix}-new-block-start`}
            type="time"
            required
            value={form.start}
            onChange={(e) => setForm({ ...form, start: e.target.value })}
            className="h-10 mono bg-[var(--surface)] border-[var(--hairline)]"
          />
        </div>
        <div className="space-y-2">
          <Label className="eyebrow">To</Label>
          <Input
            data-testid={`${prefix}-new-block-end`}
            type="time"
            required
            value={form.end}
            onChange={(e) => setForm({ ...form, end: e.target.value })}
            className="h-10 mono bg-[var(--surface)] border-[var(--hairline)]"
          />
        </div>
        <Button
          type="submit"
          data-testid={`${prefix}-add-block-button`}
          className="h-10 rounded-full px-5 font-semibold"
          style={{ background: "var(--sage)", color: "#0d0f12" }}
        >
          <Plus className="h-4 w-4 mr-1" />
          Add block
        </Button>
      </form>
    </div>
  );
}
