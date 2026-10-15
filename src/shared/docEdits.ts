// Structured edit plans for the chat -> document pipeline. The chat model
// returns a plan (find/replace/insert/delete on block text); the renderer
// applies it against the live BlockNote editor, so every change is visible,
// undoable, and — for .docx sources — written back as Word-native tracked
// changes by the existing save flow. Pure functions only: this module is
// imported by the main process (plan validation) and the renderer (apply).
//
// Design note: one shared document model — the AI writes structured ops
// against the live editor, and the editor shows them immediately.

export type DocEditOp =
  | { action: "replace"; find: string; replaceWith: string }
  | { action: "insert"; text: string; after?: string }
  | { action: "delete"; find: string };

export type DocEditPlan = {
  explanation?: string;
  ops: DocEditOp[];
};

export const MAX_PLAN_OPS = 30;
export const MAX_FIND_CHARS = 2000;
export const MAX_TEXT_CHARS = 8000;

/**
 * Validate and clamp an untrusted plan coming from a model. Keeps only
 * well-formed ops; drops everything else so a partial model answer can
 * never wedge the applier.
 */
export function sanitizeDocEditPlan(raw: any): DocEditPlan {
  const out: DocEditPlan = { ops: [] };
  if (raw && typeof raw.explanation === "string" && raw.explanation.trim()) {
    out.explanation = raw.explanation.trim().slice(0, 500);
  }
  const ops = Array.isArray(raw?.ops) ? raw.ops : [];
  for (const op of ops.slice(0, MAX_PLAN_OPS)) {
    if (!op || typeof op !== "object") continue;
    const action = op.action;
    if (action === "replace") {
      const find = typeof op.find === "string" ? op.find : "";
      const replaceWith = typeof op.replaceWith === "string" ? op.replaceWith : "";
      if (!find.trim() || find.length > MAX_FIND_CHARS || replaceWith.length > MAX_TEXT_CHARS) continue;
      if (find === replaceWith) continue;
      out.ops.push({ action: "replace", find, replaceWith });
    } else if (action === "insert") {
      const text = typeof op.text === "string" ? op.text : "";
      if (!text.trim() || text.length > MAX_TEXT_CHARS) continue;
      const after = typeof op.after === "string" ? op.after.slice(0, MAX_FIND_CHARS) : undefined;
      out.ops.push(after && after.trim() ? { action: "insert", text, after } : { action: "insert", text });
    } else if (action === "delete") {
      const find = typeof op.find === "string" ? op.find : "";
      if (!find.trim() || find.length > MAX_FIND_CHARS) continue;
      out.ops.push({ action: "delete", find });
    }
  }
  return out;
}

// ── inline content helpers (pure) ─────────────────────────────────────────
// BlockNote inline nodes: {type:"text", text, styles} | {type:"link", href,
// content: InlineContent[]} | custom atom nodes (treated as opaque).

type Inline = any;

export function inlineText(content: Inline[] | undefined | null): string {
  if (!Array.isArray(content)) return "";
  let out = "";
  for (const c of content) {
    if (typeof c === "string") out += c;
    else if (c?.type === "text") out += c.text ?? "";
    else if (c?.type === "link") out += inlineText(c.content);
    // atom nodes contribute nothing
  }
  return out;
}

/** Splits `content` at character offset `at` (both sides keep their styles). */
function splitAt(content: Inline[], at: number): [Inline[], Inline[]] {
  const left: Inline[] = [];
  const right: Inline[] = [];
  let pos = 0;
  for (const c of content) {
    const text = typeof c === "string" ? c : c?.type === "text" ? c.text ?? "" : c?.type === "link" ? inlineText(c.content) : "";
    const len = text.length;
    if (pos + len <= at) {
      left.push(c);
    } else if (pos >= at) {
      right.push(c);
    } else {
      const cut = at - pos;
      left.push(sliceInline(c, 0, cut));
      right.push(sliceInline(c, cut, len));
    }
    pos += len;
  }
  return [left, right];
}

function sliceInline(c: Inline, start: number, end: number): Inline {
  if (typeof c === "string") return c.slice(start, end);
  if (c?.type === "text") return { ...c, text: (c.text ?? "").slice(start, end) };
  if (c?.type === "link") return { ...c, content: sliceInlineList(c.content, start, end) };
  return c; // atoms are not splittable; callers never hit this (length 0)
}

function sliceInlineList(list: Inline[], start: number, end: number): Inline[] {
  const out: Inline[] = [];
  let pos = 0;
  for (const c of list) {
    const len = (typeof c === "string" ? c : c?.type === "text" ? c.text ?? "" : c?.type === "link" ? inlineText(c.content) : "").length;
    const s = Math.max(start, pos);
    const e = Math.min(end, pos + len);
    if (e > s) out.push(sliceInline(c, s - pos, e - pos));
    pos += len;
  }
  return out;
}

/**
 * Replace the first occurrence of `find` inside a block's inline content,
 * preserving the styles of the text being replaced. A match fully inside a
 * link is replaced within the link (href kept). Returns null when the text
 * does not appear.
 */
export function replaceInInlineContent(
  content: Inline[] | undefined | null,
  find: string,
  replaceWith: string,
): Inline[] | null {
  if (!Array.isArray(content) || !find) return null;
  // prefer a match fully inside one link node so the replacement keeps href
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (c?.type === "link") {
      const inner = replaceInInlineContent(c.content, find, replaceWith);
      if (inner) return [...content.slice(0, i), { ...c, content: inner }, ...content.slice(i + 1)];
    }
  }
  const hay = inlineText(content);
  const idx = hay.indexOf(find);
  if (idx < 0) return null;
  const [before, after] = splitAt(content, idx);
  const [, rest] = splitAt(after, find.length);
  // styles of the replaced span: first inline node inside the found range
  const matched = sliceInlineList(after, 0, find.length);
  const styles = matched.find((c: any) => c?.type === "text")?.styles ?? {};
  const replacement: Inline =
    replaceWith.length === 0
      ? null
      : { type: "text", text: replaceWith, styles: { ...(styles ?? {}) } };
  const merged = [...before, ...(replacement ? [replacement] : []), ...rest].filter(Boolean);
  return merged.length ? merged : [{ type: "text", text: "", styles: {} }];
}

/** True when a block's own text (excluding children) contains `needle`. */
export function blockContains(b: any, needle: string): boolean {
  const t =
    b?.type === "table" || !Array.isArray(b?.content)
      ? ""
      : inlineText(b.content);
  return !!t && t.includes(needle);
}
