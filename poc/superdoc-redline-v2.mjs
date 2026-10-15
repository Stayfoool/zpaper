// SuperDoc PoC v2: tracked INSERT and DELETE of whole paragraphs.
// Complements superdoc-redline.mjs (which proved tracked replace).
// Run: node poc/superdoc-redline-v2.mjs
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const OUT = "/tmp/zpaper-superdoc-poc2";
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const html = `
<h1>项目计划</h1>
<p>第一阶段：需求调研。</p>
<p>第二阶段：原型开发。</p>
<p>第三阶段：正式发布。</p>
`.trim();

const htmlToDocx = (await import("html-to-docx")).default;
const buf = await htmlToDocx(html, undefined, { table: { row: { cantSplit: true } } });
const src = path.join(OUT, "plan.docx");
fs.writeFileSync(src, buf);
console.log("[1] plan.docx:", buf.length, "bytes");

const { createSuperDocClient } = await import("@superdoc-dev/sdk");
const client = createSuperDocClient();
await client.connect();

const out = path.join(OUT, "plan-tracked.docx");
try {
  const doc = await client.open({
    doc: src,
    trackChanges: { replacements: "paired" },
    userName: "zpaper AI",
  });

  // --- tracked DELETE: remove the 第二阶段 paragraph entirely ---
  const bl = await doc.blocks.list({});
  const hit = (bl.blocks || []).find((b) => (b.textPreview || "").includes("第二阶段"));
  if (hit?.nodeId) {
    await doc.blocks.delete({
      target: { kind: "block", nodeType: "paragraph", nodeId: hit.nodeId },
      changeMode: "tracked",
    });
    console.log("[2] tracked delete 第二阶段: done (nodeId", hit.nodeId + ")");
  } else {
    console.log("[2] block not found");
  }

  // --- tracked INSERT: new paragraph after 第三阶段 ---
  const hit3 = (bl.blocks || []).find((b) => (b.textPreview || "").includes("第三阶段"));
  if (hit3?.nodeId) {
    await doc.insert({
      target: { kind: "block", nodeType: "paragraph", nodeId: hit3.nodeId },
      placement: "after",
      content: [{ type: "paragraph", text: "第四阶段：持续迭代（由 AI 增补）。" }],
      changeMode: "tracked",
    });
    console.log("[3] tracked insert 第四阶段: done (after nodeId", hit3.nodeId + ")");
  }

  await doc.save({ out });
  await doc.close();
} catch (e) {
  console.error("[!] flow failed:", String(e).slice(0, 300));
}
await client.dispose();

if (fs.existsSync(out)) {
  const xml = execSync(`cd "${OUT}" && unzip -p plan-tracked.docx word/document.xml`).toString();
  const hasIns = xml.includes("<w:ins ");
  const hasDel = xml.includes("<w:del ");
  const stage2Marked = /<w:del[^>]*>(?:(?!<\/w:del>).)*第二阶段/s.test(xml);
  const stage4Marked = /<w:ins[^>]*>(?:(?!<\/w:ins>).)*第四阶段/s.test(xml);
  console.log("[4] VERDICT: w:ins =", hasIns, "| w:del =", hasDel,
    "| 第二阶段 marked-deleted =", stage2Marked, "| 第四阶段 marked-inserted =", stage4Marked);
  fs.writeFileSync(path.join(OUT, "document.xml"), xml);
}
