// docx PoC: verify the conversion pipeline end to end
//   docx --(mammoth)--> html --(BlockNote server-util)--> blocks
//   blocks --(server-util)--> html --(html-to-docx)--> docx --(mammoth)--> html
// Run: node poc/docx-roundtrip.mjs
import * as fs from "node:fs";
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import mammoth from "mammoth";

const OUT = "/tmp/zpaper-docx-poc";
fs.mkdirSync(OUT, { recursive: true });

// ---------- 1. build a representative test docx ----------
const doc = new Document({
  sections: [
    {
      children: [
        new Paragraph({ text: "季度工作总结", heading: HeadingLevel.HEADING_1 }),
        new Paragraph({
          children: [
            new TextRun("本季度销售额达到 "),
            new TextRun({ text: "120 万元", bold: true }),
            new TextRun("，同比增长 18%。核心产品线表现稳健。"),
          ],
        }),
        new Paragraph({ text: "重点工作", heading: HeadingLevel.HEADING_2 }),
        new Paragraph({ text: "重点客户续约率 92%，高于上季度", bullet: { level: 0 } }),
        new Paragraph({ text: "渠道合作伙伴从 12 家扩展到 19 家", bullet: { level: 0 } }),
        new Paragraph({ text: "渠道明细", heading: HeadingLevel.HEADING_2 }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph("区域")] }),
                new TableCell({ children: [new Paragraph("销售额")] }),
              ],
            }),
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph("华东")] }),
                new TableCell({ children: [new Paragraph("52 万")] }),
              ],
            }),
          ],
        }),
        new Paragraph({
          children: [new TextRun("下季度继续冲刺 150 万元目标。")],
          alignment: AlignmentType.LEFT,
        }),
      ],
    },
  ],
});

const docxBuf = await Packer.toBuffer(doc);
fs.writeFileSync(`${OUT}/original.docx`, docxBuf);
console.log("[1] original.docx written:", docxBuf.length, "bytes");

// ---------- 2. docx -> html (mammoth) ----------
const { value: html1 } = await mammoth.convertToHtml({ buffer: docxBuf });
fs.writeFileSync(`${OUT}/step1.html`, html1);
console.log("[2] mammoth html length:", html1.length);
console.log("    contains h1:", html1.includes("<h1>"), "| strong:", html1.includes("<strong>"),
  "| ul:", html1.includes("<ul>"), "| table:", html1.includes("<table>"));

// ---------- 3. html -> blocks (BlockNote server-util) ----------
const { ServerBlockNoteEditor } = await import("@blocknote/server-util");
const serverEditor = new ServerBlockNoteEditor();
const blocks = await serverEditor.tryParseHTMLToBlocks(html1);
console.log("[3] blocks parsed:", blocks.length);
for (const b of blocks) {
  const text = Array.isArray(b.content)
    ? b.content.map((c) => c.text).join("")
    : b.type === "table"
      ? `[表格 ${b.content?.rows?.length ?? "?"} 行]`
      : `[${b.type}]`;
  console.log(`    - ${b.type}: ${text.slice(0, 40)}`);
}

// ---------- 4. blocks -> html -> docx -> html (roundtrip) ----------
const html2 = await serverEditor.blocksToHTMLLossy(blocks);
fs.writeFileSync(`${OUT}/step4.html`, html2);
const htmlToDocx = (await import("html-to-docx")).default;
const docx2 = await htmlToDocx(html2, undefined, { table: { row: { cantSplit: true } } });
fs.writeFileSync(`${OUT}/roundtrip.docx`, docx2);
console.log("[4] roundtrip.docx written:", docx2.length, "bytes");

const { value: html3 } = await mammoth.convertToHtml({ buffer: Buffer.from(docx2) });
const strip = (s) => s.replace(/\s+/g, "").toLowerCase();
const textOf = (s) => (s.match(/>([^<>]+)</g) || []).join("");
const sameText = strip(textOf(html1)) === strip(textOf(html3));
console.log("[5] roundtrip text identical to original html:", sameText);
console.log("    roundtrip contains table:", html3.includes("<table>"),
  "| strong:", html3.includes("<strong>"), "| h2:", html3.includes("<h2>"));

// ---------- 5. verify AI suggestion marks can be written back (w:ins/w:del)?
console.log("\nNOTE: suggestion marks (w:ins/w:del) are NOT covered by this pipeline;");
console.log("they need a redline-aware writer (e.g. SuperDoc or python-docx based service).");
