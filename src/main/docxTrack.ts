// Phase B: write accepted edits back to a .docx as Word-native tracked
// changes (w:ins / w:del) via the SuperDoc SDK. The renderer sends the
// block snapshot taken when the document was opened plus the current
// blocks; we diff them and apply each difference as a tracked operation.
// Any failure throws — the save handler falls back to the plain docx path.
import * as fs from "node:fs";
import * as path from "node:path";
import type { BlockSnapshot } from "./blockText";

const clientCache: { client: any | null } = { client: null };

async function getClient() {
  if (!clientCache.client) {
    const { createSuperDocClient } = await import("@superdoc-dev/sdk");
    clientCache.client = createSuperDocClient();
    await clientCache.client.connect();
  }
  return clientCache.client;
}

export async function disposeDocxTrackClient() {
  if (clientCache.client) {
    try {
      await clientCache.client.dispose();
    } catch {
      /* already gone */
    }
    clientCache.client = null;
  }
}

type DiffOp =
  | { kind: "replace"; oldText: string; newText: string }
  | { kind: "delete"; text: string; nodeType: "paragraph" | "heading" | "listItem" }
  | { kind: "insert"; text: string; afterOriginalText: string | null };

/** Order-aware block diff between the open-time snapshot and current state. */
export function diffBlocks(original: BlockSnapshot[], current: BlockSnapshot[]): DiffOp[] {
  const origById = new Map(original.map((b) => [b.id, b]));
  const currIds = new Set(current.map((b) => b.id));

  const ops: DiffOp[] = [];
  // 1. replacements + deletions, in original document order
  for (const ob of original) {
    if (!currIds.has(ob.id)) {
      ops.push({ kind: "delete", text: ob.text, nodeType: superdocNodeType(ob.type) });
      continue;
    }
    const cb = current.find((b) => b.id === ob.id)!;
    if (cb.text !== ob.text) ops.push({ kind: "replace", oldText: ob.text, newText: cb.text });
  }
  // 2. insertions, in current order, anchored to the nearest preceding
  //    original block (the SDK inserts relative to an existing block)
  const origOrder = new Map(original.map((b, i) => [b.id, i]));
  for (let i = 0; i < current.length; i++) {
    const cb = current[i];
    if (origById.has(cb.id)) continue;
    let anchor: string | null = null;
    for (let j = i - 1; j >= 0; j--) {
      if (origById.has(current[j].id)) {
        anchor = current[j].text;
        break;
      }
    }
    ops.push({ kind: "insert", text: cb.text, afterOriginalText: anchor });
  }
  return ops;
}

function superdocNodeType(t: string): "paragraph" | "heading" | "listItem" {
  if (t === "heading") return "heading";
  if (t.includes("ListItem")) return "listItem";
  return "paragraph";
}

/** Minimal changed span between two strings (common prefix/suffix trim). */
export function changedSpan(oldText: string, newText: string) {
  let pre = 0;
  const maxPre = Math.min(oldText.length, newText.length);
  while (pre < maxPre && oldText[pre] === newText[pre]) pre++;
  let suf = 0;
  const maxSuf = maxPre - pre;
  while (suf < maxSuf && oldText[oldText.length - 1 - suf] === newText[newText.length - 1 - suf]) suf++;
  return {
    oldMiddle: oldText.slice(pre, oldText.length - suf),
    newMiddle: newText.slice(pre, newText.length - suf),
  };
}

export async function saveDocxWithTrackedChanges(opts: {
  originalPath: string;
  outPath: string;
  originalBlocks: BlockSnapshot[];
  currentBlocks: BlockSnapshot[];
  authorName: string;
}): Promise<{ applied: number }> {
  const { originalPath, outPath, originalBlocks, currentBlocks, authorName } = opts;
  const ops = diffBlocks(originalBlocks, currentBlocks);
  if (ops.length === 0) return { applied: 0 };

  const client = await getClient();
  const doc = await client.open({
    doc: originalPath,
    trackChanges: { replacements: "paired" },
    userName: authorName,
  });

  let applied = 0;
  try {
    for (const op of ops) {
      if (op.kind === "replace") {
        const { oldMiddle, newMiddle } = changedSpan(op.oldText, op.newText);
        const pattern = oldMiddle || op.oldText;
        const replacement = oldMiddle ? newMiddle : op.newText;
        if (!pattern.trim()) continue;
        const m = await doc.query.match({
          select: { type: "text", pattern },
          require: "first",
        });
        const target = m.items?.[0]?.target;
        if (!target) continue;
        await doc.replace({ target, text: replacement, changeMode: "tracked" });
        applied++;
      } else if (op.kind === "delete") {
        const bl = await doc.blocks.list({});
        const hit = (bl.blocks || []).find((b) =>
          (b.textPreview || "").trim() === op.text.trim() ||
          (op.text.trim() && (b.textPreview || "").includes(op.text.trim().slice(0, 30))),
        );
        if (hit?.nodeId) {
          await doc.blocks.delete({
            target: { kind: "block", nodeType: op.nodeType, nodeId: hit.nodeId },
            changeMode: "tracked",
          });
          applied++;
        }
      } else {
        // insert: anchor to the preceding original block; without an anchor,
        // append at the end of the document
        let anchorNodeId: string | null = null;
        if (op.afterOriginalText) {
          const bl = await doc.blocks.list({});
          const anchor = (bl.blocks || []).find((b) =>
            (op.afterOriginalText.trim() && (b.textPreview || "").includes(op.afterOriginalText.trim().slice(0, 30))),
          );
          anchorNodeId = anchor?.nodeId ?? null;
        }
        const insertParams: any = {
          content: [{ type: "paragraph", content: [{ type: "text", text: op.text }] }],
          changeMode: "tracked",
        };
        if (anchorNodeId) {
          insertParams.target = { kind: "block", nodeType: "paragraph", nodeId: anchorNodeId };
          insertParams.placement = "after";
        }
        await doc.insert(insertParams);
        applied++;
      }
    }
    // saving in place: the host may hold the file open, so go via a temp file
    if (path.resolve(outPath) === path.resolve(originalPath)) {
      const tmp = outPath + ".zpaper-tmp.docx";
      await doc.save({ out: tmp });
      fs.renameSync(tmp, outPath);
    } else {
      await doc.save({ out: outPath });
    }
  } catch (e) {
    try {
      await doc.close({ discard: true });
    } catch {
      /* best effort */
    }
    throw e;
  }
  await doc.close();
  return { applied };
}