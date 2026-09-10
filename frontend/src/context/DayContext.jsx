import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { client, errMsg, nowMinFor, todayStr } from "@/api";

const DayContext = createContext(null);
export const useDay = () => useContext(DayContext);

export function DayProvider({ children }) {
  const [date, setDate] = useState(todayStr());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [undoItem, setUndoItem] = useState(null);
  const [reward, setReward] = useState(null);
  const [busy, setBusy] = useState(false);
  const reminded = useRef({});

  const apply = useCallback((d) => {
    if (d.blocks && d.exists === undefined) d.exists = true;
    setData(d);
    if (d.message) toast.success(d.message);
    if (d.undo) setUndoItem({ ...d.undo, key: Date.now() });
    if (d.reward) setReward({ name: d.reward, key: Date.now() });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const { data: d } = await client.get(`/day/${date}`, { params: { now_min: nowMinFor(date) } });
      apply(d);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [date, apply]);

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh]);

  useEffect(() => {
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  const call = useCallback(
    async (method, path, body) => {
      setBusy(true);
      try {
        const url = `/day/${date}${path}`;
        const cfg = { params: { now_min: nowMinFor(date) } };
        const { data: d } =
          method === "get"
            ? await client.get(url, cfg)
            : method === "delete"
              ? await client.delete(url, cfg)
              : await client[method](url, body || {}, cfg);
        apply(d);
        return { ok: true, data: d };
      } catch (e) {
        toast.error(errMsg(e));
        return { ok: false, error: errMsg(e) };
      } finally {
        setBusy(false);
      }
    },
    [date, apply],
  );

  const undo = async () => {
    if (!undoItem) return;
    setUndoItem(null);
    try {
      const { data: d } = await client.post(`/undo/${undoItem.id}`, {}, { params: { now_min: nowMinFor(date) } });
      setData(d);
      toast.success("Change reverted");
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  // In-app reminder the moment a block's time arrives (synced across devices via server)
  useEffect(() => {
    const block = data?.blocks?.find((b) => b.id === data.current_block_id);
    if (!block) return;
    if (block.reminded_at) return;
    const key = `${date}:${block.id}`;
    if (reminded.current[key]) return;
    reminded.current[key] = true;
    // Persist to the server so other devices don't repeat the reminder
    client
      .post(`/day/${date}/blocks/${block.id}/remind`, {}, { params: { now_min: nowMinFor(date) } })
      .catch(() => {});
    toast(`${block.name} starts now`, {
      description: `${block.start} – ${block.end} · ${block.tasks.filter((t) => !t.done && !t.skipped).length} things planned`,
      duration: 8000,
    });
    if (data.settings?.notifications_enabled && "Notification" in window && Notification.permission === "granted") {
      new Notification(`${block.name} starts now`, { body: `${block.start} – ${block.end}` });
    }
  }, [data, date]);

  const actions = {
    assign: (template_id) => call("post", "/assign", { template_id }),
    clearDay: async () => {
      await client.delete(`/day/${date}`);
      refresh();
    },
    addBlock: (b) => call("post", "/blocks", b),
    patchBlock: (id, b) => call("patch", `/blocks/${id}`, b),
    deleteBlock: (id) => call("delete", `/blocks/${id}`),
    splitBlock: (id, at) => call("post", `/blocks/${id}/split`, { at }),
    addTask: (bid, t) => call("post", `/blocks/${bid}/tasks`, t),
    patchTask: (id, t) => call("patch", `/tasks/${id}`, t),
    deleteTask: (id) => call("delete", `/tasks/${id}`),
    moveTask: (id, toBlockId) => call("post", `/tasks/${id}/move`, { to_block_id: toBlockId }),
    defer: (id, toDate) => call("post", `/tasks/${id}/defer`, { to_date: toDate }),
    start: (id) => call("post", `/tasks/${id}/start`),
    pause: (id) => call("post", `/tasks/${id}/pause`),
    complete: (id) => call("post", `/tasks/${id}/complete`),
    finishDay: (id) => call("post", `/tasks/${id}/finish-day`),
    pullForward: (id, minutes) => call("post", `/tasks/${id}/pull-forward`, { minutes }),
    skip: (id) => call("post", `/tasks/${id}/skip`),
    skipAll: (id) => call("post", `/tasks/${id}/skip?whole_day=true`),
    extend: (id, minutes) => call("post", `/tasks/${id}/extend`, { minutes }),
    addSub: (id, title) => call("post", `/tasks/${id}/subtasks`, { title }),
    toggleSub: (id, sid) => call("post", `/tasks/${id}/subtasks/${sid}/toggle`),
    deleteSub: (id, sid) => call("delete", `/tasks/${id}/subtasks/${sid}`),
    decide: (payload) => call("post", "/decisions", payload),
  };

  return (
    <DayContext.Provider
      value={{
        date,
        setDate,
        data,
        loading,
        busy,
        refresh,
        undoItem,
        undo,
        dismissUndo: () => setUndoItem(null),
        reward,
        clearReward: () => setReward(null),
        ...actions,
      }}
    >
      {children}
    </DayContext.Provider>
  );
}
