// Watches the BlockNote AI extension state machine and records an entry per
// AI edit run: the instruction, the blocks it changed (snapshot diff), and
// whether the user accepted or reverted. Powers the「变更」panel.
import { useEffect, useRef, useState } from "react";
import type { BlockNoteEditor } from "@blocknote/core";

export type BlockChange = {
  id: string;
  kind: "modified" | "added" | "removed";
  before: string;
  after: string;
};

export type ChangeEntry = {
  id: string;
  time: number;
  instruction: string;
  status: "reviewing" | "accepted" | "reverted";
  changes: BlockChange[];
  jumpToId: string | null;
};

type Snapshot = { id: string; text: string }[];

function serialize(editor: BlockNoteEditor<any, any, any>): Snapshot {
  return editor.document.map((b: any) => ({
    id: b.id as string,
    text: b.content ? b.content.map((c: any) => c.text).join("") : `[${b.type}]`,
  }));
}

function diffSnap(before: Snapshot, after: Snapshot): BlockChange[] {
  const beforeMap = new Map(before.map((b) => [b.id, b.text]));
  const afterMap = new Map(after.map((b) => [b.id, b.text]));
  const out: BlockChange[] = [];
  for (const [id, text] of afterMap) {
    if (!beforeMap.has(id)) {
      out.push({ id, kind: "added", before: "", after: text });
    } else if (beforeMap.get(id) !== text) {
      out.push({ id, kind: "modified", before: beforeMap.get(id)!, after: text });
    }
  }
  for (const [id, text] of beforeMap) {
    if (!afterMap.has(id)) out.push({ id, kind: "removed", before: text, after: "" });
  }
  return out;
}

// Captures the instruction text of the outgoing AI request. Set from the
// wrapped transport fetch in App.tsx.
export const lastInstruction = { text: "" };

export function useAiChanges(editor: BlockNoteEditor<any, any, any> | null) {
  const [entries, setEntries] = useState<ChangeEntry[]>([]);
  const entriesRef = useRef<ChangeEntry[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!editor) return;

    let snapshot: Snapshot | null = null;
    let runId: string | null = null;
    let prevStatus = "closed";
    let closedTicks = 0;

    const tick = () => {
      // resolve the AI extension lazily: on first effect run it may not be
      // registered in _extensionManager yet
      const em = (editor as any)._extensionManager;
      const ai = em?.extensions?.find((x: any) => typeof x.openAIMenuAtBlock === "function");
      if (!ai?.store) return;
      const m = ai.store.state?.aiMenuState;
      const dbg = ((window as any).__zpaperTick ??= { ticks: 0, last: null, snapshots: 0, records: 0 });
      dbg.ticks++;
      dbg.last = m && m !== "closed" ? (m as any).status : "closed";

      const commit = (next: ChangeEntry[]) => {
        entriesRef.current = next;
        setEntries(next);
      };

      const status = m && m !== "closed" ? (m as any).status : "closed";

      // menu open / request in flight: a fresh run takes a "before" snapshot.
      // the snapshot lives until the run resolves OR the next run replaces it —
      // the menu flashes "closed" between writing and reviewing, so we must
      // not reset there.
      if (status === "thinking" || status === "user-input") {
        if (prevStatus !== "thinking" && prevStatus !== "user-input") {
          runId = `run_${Date.now()}`;
          snapshot = serialize(editor);
          dbg.snapshots++;
        }
        closedTicks = 0;
        prevStatus = status;
        return;
      }

      // reviewing: record the diff once
      if (status === "user-reviewing") {
        closedTicks = 0;
        prevStatus = status;
        if (runId && snapshot && !entriesRef.current.some((e) => e.id === runId)) {
          const now = serialize(editor);
          const changes = diffSnap(snapshot, now);
          dbg.diff = { snapLen: snapshot.length, nowLen: now.length, changes: changes.length };
          if (changes.length > 0) {
            dbg.records++;
            const first = changes.find((c) => c.kind !== "removed") ?? changes[0];
            commit([
              {
                id: runId,
                time: Number(runId.slice(4)),
                instruction: lastInstruction.text || "AI 修改",
                status: "reviewing",
                changes,
                jumpToId: first.id,
              },
              ...entriesRef.current,
            ]);
          }
        }
        return;
      }

      // menu closed: resolve a pending reviewing entry; otherwise keep the
      // snapshot for a while (the gap between writing and reviewing can be
      // seconds long) — give up only after minutes of continuous closure
      prevStatus = "closed";
      if (!runId) return;
      const pending = entriesRef.current.find((e) => e.id === runId && e.status === "reviewing");
      if (pending && snapshot) {
        const changed = JSON.stringify(serialize(editor)) !== JSON.stringify(snapshot);
        commit(
          entriesRef.current.map((e) =>
            e.id === runId ? { ...e, status: changed ? "accepted" : "reverted" } : e,
          ),
        );
        snapshot = null;
        runId = null;
        closedTicks = 0;
        return;
      }
      if (!pending) {
        closedTicks++;
        if (closedTicks > 300) {
          // ~2 min closed with nothing to resolve: a run that never changed anything
          snapshot = null;
          runId = null;
          closedTicks = 0;
        }
      }
    };

    const timer = setInterval(tick, 400);
    return () => clearInterval(timer);
  }, [editor]);

  return { entries, open, setOpen, clear: () => setEntries([]) };
}

export function jumpToBlock(blockId: string) {
  const el =
    document.querySelector(`[data-id="${blockId}"]`) ||
    document.querySelector(`[node-id="${blockId}"]`);
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  (el as HTMLElement).style.transition = "background-color 0.3s";
  (el as HTMLElement).style.backgroundColor = "#fff3c2";
  setTimeout(() => {
    (el as HTMLElement).style.backgroundColor = "";
  }, 1600);
  return true;
}
