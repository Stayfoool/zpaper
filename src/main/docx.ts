// docx conversion (Phase A pipeline, all-MIT):
//   open:  docx --mammoth(hidden window)--> html --> blocks
//   save:  blocks --> html(hidden window) --html-to-docx(main)--> docx
// Content-and-structure fidelity: headings/bold/lists/tables preserved;
// visual styling (fonts/colors/headers) is simplified by design.
import * as fs from "node:fs";
import { blocksToDocxBuffer, docxBufferToBlocks } from "./converterWindow";

export { blocksToDocxBuffer, docxBufferToBlocks };

export async function openDocxFile(filePath: string) {
  const buffer = fs.readFileSync(filePath);
  const blocks = await docxBufferToBlocks(buffer);
  if (!blocks || blocks.length === 0) {
    throw new Error("无法解析该 Word 文档（内容为空或格式不受支持）");
  }
  return blocks;
}

export async function saveDocxFile(filePath: string, blocks: any[]) {
  const buf = await blocksToDocxBuffer(blocks);
  fs.writeFileSync(filePath, buf);
}

export function isDocxPath(p: string) {
  return /\.docx$/i.test(p);
}
