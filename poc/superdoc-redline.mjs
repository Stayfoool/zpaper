// SuperDoc PoC (docx 选型报告阶段 B): can the SuperDoc SDK write AI edits
// into a docx as Word-native tracked changes (w:ins / w:del)?
//
// Flow mirrors zpaper's real pipeline:
//   1. BlockNote blocks -> html -> html-to-docx  (our existing save leg)
//   2. SuperDoc SDK: open with trackChanges + userName, replace 30日 -> 45日
//   3. save -> unzip -> assert w:ins / w:del exist
//
// Run: node poc/superdoc-redline.mjs
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const OUT = "/tmp/zpaper-superdoc-poc";
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// ---------- 1. build the "original" contract docx via our pipeline ----------
const html = `
<h1>采购合同</h1>
<p>甲方与乙方经友好协商，就采购事宜达成如下条款：</p>
<p>第三条 付款条款：乙方交付货物并验收合格后，甲方应在 30 日 内支付全部货款。</p>
<p>第四条 本合同自双方签字之日起生效。</p>
`.trim();

const htmlToDocx = (await import("html-to-docx")).default;
const originalBuf = await htmlToDocx(html, undefined, { table: { row: { cantSplit: true } } });
const originalPath = path.join(OUT, "contract-original.docx");
fs.writeFileSync(originalPath, originalBuf);
console.log("[1] original contract.docx written:", originalBuf.length, "bytes");

// ---------- 2. SuperDoc SDK: open in tracked-changes mode and edit ----------
const { createSuperDocClient } = await import("@superdoc-dev/sdk");
const client = createSuperDocClient();
await client.connect();

const editedPath = path.join(OUT, "contract-tracked.docx");
let tracked = false;
try {
  const doc = await client.open({
    doc: originalPath,
    trackChanges: { replacements: "paired" },
    userName: "zpaper AI",
  });

  // find the target text
  const match = await doc.query.match({
    select: { type: "text", pattern: "30 日" },
    require: "first",
  });
  const target = match.items?.[0]?.target;
  console.log("[2] find '30 日':", target ? "found" : "NOT FOUND");

  if (target) {
    await doc.replace({ target, text: "45 日", changeMode: "tracked" });
    console.log("[3] replaced 30 日 -> 45 日 (changeMode=tracked)");
  }

  await doc.save({ out: editedPath });
  await doc.close();
  tracked = fs.existsSync(editedPath);
  console.log("[4] saved:", editedPath, tracked ? fs.statSync(editedPath).size + " bytes" : "MISSING");
} catch (e) {
  console.error("[!] SDK flow failed:", String(e).slice(0, 400));
}
await client.dispose();

// ---------- 3. verify: unzip and look for w:ins / w:del ----------
if (tracked) {
  const xml = execSync(
    `cd "${OUT}" && unzip -p contract-tracked.docx word/document.xml`,
  ).toString();
  const hasIns = xml.includes("<w:ins ");
  const hasDel = xml.includes("<w:del ");
  const authorOk = xml.includes('w:author="zpaper AI"');
  const originalKept = xml.includes("30 日") || xml.includes("30日");
  console.log("[5] VERDICT: w:ins =", hasIns, "| w:del =", hasDel, "| author =", authorOk, "| original text preserved =", originalKept);
  console.log("    -> Word 打开时应显示：~~30 日~~ 45 日（修订标记，作者 zpaper AI）");
} else {
  console.log("[5] SKIPPED (no edited file)");
}
