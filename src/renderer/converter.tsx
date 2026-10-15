// Conversion page: runs in a hidden window, exposes window.__zpaperConvert.
// Uses the browser build of mammoth (resolved via the package's browser field)
// and a real BlockNote editor for html <-> blocks parsing.
import "./converter-style.css";
import * as mammoth from "mammoth";
import { createRoot } from "react-dom/client";
import { useCallback } from "react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import { useCreateBlockNote } from "@blocknote/react";

function Converter() {
  const editor = useCreateBlockNote();
  (window as any).__zpaperEditor = editor;

  (window as any).__zpaperConvert = async (op: string, id: string, payload: any) => {
    try {
      if (op === "docxToHtml") {
        const bytes = Uint8Array.from(atob(payload.base64), (c) => c.charCodeAt(0));
        const r = await (mammoth as any).convertToHtml({ arrayBuffer: bytes.buffer });
        return { id, data: { html: r.value } };
      }
      if (op === "htmlToBlocks") {
        const blocks = await editor.tryParseHTMLToBlocks(payload.html);
        return { id, data: { blocks } };
      }
      if (op === "blocksToHtml") {
        const html = await editor.blocksToHTMLLossy(payload.blocks);
        return { id, data: { html } };
      }
      throw new Error(`unknown op: ${op}`);
    } catch (e: any) {
      return { id, error: String(e?.message || e).slice(0, 300) };
    }
  };

  const ref = useCallback((el: HTMLDivElement | null) => {
    if (el) el.style.display = "none";
  }, []);

  return (
    <div ref={ref} style={{ display: "none" }}>
      <BlockNoteView editor={editor} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Converter />);
