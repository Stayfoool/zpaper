// Pure-function tests for the chat -> document edit-plan pipeline
// (src/shared/docEdits.ts). Bundled + run by scripts/test-docedits.mjs.
import {
  sanitizeDocEditPlan,
  replaceInInlineContent,
  inlineText,
  blockContains,
} from "../src/shared/docEdits";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// ── sanitizeDocEditPlan ──────────────────────────────────────────────────
{
  const raw = {
    explanation: "  改两句  ",
    ops: [
      { action: "replace", find: "甲", replaceWith: "乙" },
      { action: "replace", find: "", replaceWith: "乙" }, // empty find -> drop
      { action: "replace", find: "same", replaceWith: "same" }, // no-op -> drop
      { action: "replace", find: 42, replaceWith: "x" }, // non-string -> drop
      { action: "insert", text: "新段" },
      { action: "insert", text: "新段", after: "锚点" },
      { action: "insert", text: "" }, // empty -> drop
      { action: "delete", find: "删我" },
      { action: "delete", find: "" }, // drop
      "garbage", // drop
      null, // drop
      { action: "unknown", find: "x" }, // drop
    ],
  };
  const plan = sanitizeDocEditPlan(raw);
  check("explanation trimmed", plan.explanation === "改两句");
  check("valid ops kept", plan.ops.length === 4);
  check(
    "op order preserved",
    JSON.stringify(plan.ops.map((o) => o.action + ":" + ("find" in o ? o.find : "text" in o ? o.text : "?"))) ===
      JSON.stringify(["replace:甲", "insert:新段", "insert:新段", "delete:删我"]),
  );
  check("insert after kept", (plan.ops[2] as any).after === "锚点");
  check("null input safe", sanitizeDocEditPlan(null).ops.length === 0);
  check(
    "ops clamped to MAX_PLAN_OPS",
    sanitizeDocEditPlan({ ops: Array.from({ length: 50 }, () => ({ action: "insert", text: "x" })) }).ops.length <= 30,
  );
}

// ── replaceInInlineContent ───────────────────────────────────────────────
{
  const single = [{ type: "text", text: "你好世界", styles: { bold: true } }];
  const out = replaceInInlineContent(single, "世界", "zpaper");
  check("single-node replace", inlineText(out) === "你好zpaper");
  check("styles preserved", (out as any[])[0].styles?.bold === true);

  const multi = [
    { type: "text", text: "前", styles: { bold: true } },
    { type: "text", text: "中段文字", styles: { italic: true } },
    { type: "text", text: "后", styles: {} },
  ];
  const out2: any = replaceInInlineContent(multi, "中段文字", "改写");
  check("cross-node replace text", inlineText(out2) === "前改写后");
  check("cross-node keeps first matched styles", out2[1].styles?.italic === true);
  check("untouched neighbors keep styles", out2[0].styles?.bold === true && out2[2].text === "后");

  const out3 = replaceInInlineContent(multi, "前中段文字后", "X");
  check("full-block replace", inlineText(out3) === "X");

  check("not found -> null", replaceInInlineContent(multi, "不存在", "x") === null);
  check("empty content -> null", replaceInInlineContent([], "a", "b") === null);

  // empty replacement removes the span
  const out4: any = replaceInInlineContent(single, "世界", "");
  check("empty replaceWith deletes span", inlineText(out4) === "你好");

  // link content is replaced through; partial match splits the link and
  // preserves its href on both halves
  const withLink: any[] = [
    { type: "text", text: "看", styles: {} },
    { type: "link", href: "https://e.com", content: [{ type: "text", text: "链接文字", styles: {} }] },
  ];
  const out5: any = replaceInInlineContent(withLink, "链接", "传送门");
  check("link partial replace text", inlineText(out5) === "看传送门文字");
  check("link partial replace keeps href", out5.length === 2 && out5[1].type === "link" && out5[1].href === "https://e.com");
  check("link partial replace splits content", inlineText(out5[1].content) === "传送门文字");
}

// ── blockContains / inlineText ───────────────────────────────────────────
{
  const block = {
    id: "1",
    type: "paragraph",
    content: [
      { type: "text", text: "合同期限为", styles: {} },
      { type: "text", text: "30 日", styles: { bold: true } },
    ],
    children: [{ id: "2", type: "paragraph", content: [{ type: "text", text: "子块内容" }] }],
  };
  check("blockContains hit", blockContains(block, "30 日"));
  check("blockContains miss on own text only", !blockContains(block, "子块内容"));
  check("table block has no inline text", !blockContains({ type: "table", content: { rows: [] } }, "x"));
  check("inlineText of undefined", inlineText(undefined) === "");
}

console.log(`docEdits: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
