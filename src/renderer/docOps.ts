// Renderer side of the chat -> document pipeline: request a structured edit
// plan from the main process and apply it against the live BlockNote editor.
// Applied changes are ordinary editor edits — visible immediately, undoable
// with Ctrl+Z, and (for .docx sources) written back as Word-native tracked
// changes by the normal save flow.
import type { BlockNoteEditor } from "@blocknote/core";
import {
  blockContains,
  replaceInInlineContent,
  sanitizeDocEditPlan,
  type DocEditPlan,
} from "../shared/docEdits";
import { DOC_EDIT_API } from "./bridge";

export type DocEditBrief = {
  instruction: string;
  proposal?: string;
  docTitle?: string;
  docMarkdown: string;
  docSelection?: string;
};

export async function requestDocEditPlan(brief: DocEditBrief): Promise<DocEditPlan> {
  const r = await fetch(DOC_EDIT_API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(brief),
  });
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try {
      msg = JSON.parse(await r.text())?.error || msg;
    } catch {
      /* keep status text */
    }
    throw new Error(msg);
  }
  const { plan } = await r.json();
  return sanitizeDocEditPlan(plan);
}

export type ApplyResult = { applied: number; failed: number };

/** All blocks, depth-first, including children (list/table children too). */
function walkBlocks(blocks: any[]): any[] {
  const out: any[] = [];
  const walk = (list: any[]) => {
    for (const b of list) {
      out.push(b);
      if (Array.isArray(b.children) && b.children.length) walk(b.children);
    }
  };
  walk(blocks);
  return out;
}

function findBlockBy(editor: BlockNoteEditor<any, any, any>, needle: string) {
  return walkBlocks(editor.document as any[]).find((b) => blockContains(b, needle));
}

/**
 * Apply a plan to the editor. Each op is independent: an op whose find text
 * no longer matches counts as failed and never blocks the rest.
 */
export function applyDocEdits(editor: BlockNoteEditor<any, any, any>, plan: DocEditPlan): ApplyResult {
  let applied = 0;
  let failed = 0;
  for (const op of plan.ops) {
    try {
      if (op.action === "replace") {
        const block = findBlockBy(editor, op.find);
        if (!block || !Array.isArray(block.content)) {
          failed++;
          continue;
        }
        const next = replaceInInlineContent(block.content, op.find, op.replaceWith);
        if (!next) {
          failed++;
          continue;
        }
        editor.updateBlock(block, { content: next } as any);
        applied++;
      } else if (op.action === "delete") {
        const block = findBlockBy(editor, op.find);
        if (!block) {
          failed++;
          continue;
        }
        editor.removeBlocks([block as any]);
        applied++;
      } else {
        const doc = editor.document as any[];
        const anchor = op.after ? findBlockBy(editor, op.after) : null;
        const ref = anchor ?? doc[doc.length - 1];
        if (!ref) {
          failed++;
          continue;
        }
        editor.insertBlocks([{ type: "paragraph", content: op.text } as any], ref as any, "after");
        applied++;
      }
    } catch (e) {
      console.warn("[zpaper] doc-edit op failed:", op.action, String((e as Error)?.message || e).slice(0, 120));
      failed++;
    }
  }
  return { applied, failed };
}

/** Text of the current editor selection ("" when none). */
export function readSelectionText(editor: BlockNoteEditor<any, any, any> | null): string {
  if (!editor) return "";
  try {
    if (typeof (editor as any).getSelectedText === "function") {
      const t = (editor as any).getSelectedText();
      if (typeof t === "string") return t;
    }
  } catch {
    /* fall through */
  }
  try {
    const state = (editor as any).prosemirrorView?.state;
    if (!state || state.selection.empty) return "";
    return state.doc.textBetween(state.selection.from, state.selection.to, "\n") || "";
  } catch {
    return "";
  }
}

