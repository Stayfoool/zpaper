// Shared block flattening/text serialization for the docx tracked-save path.
// Used by both the renderer (to snapshot at open time) and the main process
// (to diff) — must stay byte-identical on both sides.

export type BlockSnapshot = { id: string; type: string; text: string };

/** Flatten BlockNote blocks (incl. children) into ordered snapshots. */
export function flattenBlocks(blocks: any[]): BlockSnapshot[] {
  const out: BlockSnapshot[] = [];
  const walk = (list: any[]) => {
    for (const b of list) {
      out.push({ id: b.id, type: b.type, text: blockText(b) });
      if (Array.isArray(b.children) && b.children.length) walk(b.children);
    }
  };
  walk(blocks);
  return out;
}

export function blockText(b: any): string {
  if (b.type === "table" && b.content?.rows) {
    return b.content.rows
      .map((row: any) =>
        (row.cells || [])
          .map((cell: any) =>
            (Array.isArray(cell.content) ? cell.content : [])
              .map((c: any) => c.text ?? "")
              .join(""),
          )
          .join(" | "),
      )
      .join("\n");
  }
  if (!Array.isArray(b.content)) return "";
  return b.content
    .map((c: any) => (typeof c === "string" ? c : c?.text ?? ""))
    .join("");
}
