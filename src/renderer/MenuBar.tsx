// Word-style menu bar row: undo/redo, find & replace, comments toggle,
// print / export, theme switch and zoom — plus the keyboard shortcuts that
// belong to them.
import { useCallback, useEffect, useState } from "react";
import type { BlockNoteEditor } from "@blocknote/core";

export const ZOOM_LEVELS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

const THEME_KEY = "zpaper:theme";

export function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">(
    () => (localStorage.getItem(THEME_KEY) as "light" | "dark") || "light",
  );
  useEffect(() => {
    document.body.classList.toggle("zp-dark", theme === "dark");
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);
  return { theme, setTheme };
}

export function useZoom() {
  const [zoom, setZoomState] = useState<number>(
    () => Number(localStorage.getItem("zpaper:zoom")) || 1,
  );
  const setZoom = useCallback((z: number) => {
    setZoomState(z);
    localStorage.setItem("zpaper:zoom", String(z));
  }, []);
  return { zoom, setZoom };
}

export function MenuBar({
  editor,
  theme,
  onToggleTheme,
  zoom,
  onZoom,
  commentsOpen,
  onToggleComments,
}: {
  editor: BlockNoteEditor<any, any, any>;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  zoom: number;
  onZoom: (z: number) => void;
  commentsOpen: boolean;
  onToggleComments: () => void;
}) {
  const [, force] = useState(0);

  // keep the bar reactive to document changes
  useEffect(() => {
    return editor.onChange(() => force((v) => v + 1));
  }, [editor]);

  // Ctrl+P print
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        window.print();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Ctrl+, / Ctrl+. sub/superscript (Word parity)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === ",") {
        e.preventDefault();
        editor.removeStyles({ superscript: true } as any);
        editor.toggleStyles({ subscript: true } as any);
      } else if (e.key === ".") {
        e.preventDefault();
        editor.removeStyles({ subscript: true } as any);
        editor.toggleStyles({ superscript: true } as any);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor]);

  const exportHtml = useCallback(async () => {
    if (!editor) return;
    const html = await editor.blocksToFullHTML(editor.document);
    const doc = `<!doctype html><html><head><meta charset="utf-8"><title>zpaper 导出</title></head><body>${html}</body></html>`;
    const blob = new Blob([doc], { type: "text/html;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "document.html";
    a.click();
    URL.revokeObjectURL(a.href);
  }, [editor]);

  const btn = (
    label: string,
    title: string,
    onClick: () => void,
    opts?: { disabled?: boolean; active?: boolean },
  ) => (
    <button
      key={label}
      className={"menu-btn" + (opts?.active ? " active" : "")}
      title={title}
      onClick={onClick}
      disabled={opts?.disabled}
    >
      {label}
    </button>
  );

  return (
    <div className="menubar" role="toolbar" aria-label="格式工具栏">
      {btn("↶", "撤销 (Ctrl+Z)", () => editor.undo())}
      {btn("↷", "重做 (Ctrl+Shift+Z)", () => editor.redo())}
      <span className="menu-divider" />
      {btn("🔍", "查找与替换 (Ctrl+F)", () => {
        const ext = (editor as any).getExtension("zpaperFindReplace");
        ext?.open(editor, false);
      })}
      {btn("💬", "评论", () => onToggleComments(), { active: commentsOpen })}
      <span className="menu-divider" />
      {btn("🖨", "打印 / 导出 PDF (Ctrl+P)", () => window.print())}
      {btn("HTML", "导出为 HTML", exportHtml)}
      <span className="menu-divider" />
      {btn(theme === "light" ? "🌙" : "☀️", "切换明暗主题", onToggleTheme)}
      <select
        className="zoom-select"
        title="缩放"
        value={String(zoom)}
        onChange={(e) => onZoom(Number(e.target.value))}
      >
        {ZOOM_LEVELS.map((z) => (
          <option key={z} value={z}>
            {Math.round(z * 100)}%
          </option>
        ))}
      </select>
    </div>
  );
}

export function StatusBar({
  editor,
  zoom,
}: {
  editor: BlockNoteEditor<any, any, any>;
  zoom: number;
}) {
  const [stats, setStats] = useState({ words: 0, chars: 0, charsNoSpace: 0 });

  useEffect(() => {
    const compute = () => {
      const text = editor.document
        .map((b: any) => blockText(b))
        .join("\n");
      const cjk = (text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || [])
        .length;
      const latin = (
        text
          .replace(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, " ")
          .match(/[A-Za-z0-9_'-]+/g) || []
      ).length;
      setStats({
        words: cjk + latin,
        chars: text.replace(/\n/g, "").length,
        charsNoSpace: text.replace(/\s/g, "").length,
      });
    };
    compute();
    return editor.onChange(compute);
  }, [editor]);

  return (
    <div className="doc-statusbar">
      <span>
        字数 <b>{stats.words}</b>
      </span>
      <span>
        字符数（不计空格）<b>{stats.charsNoSpace}</b>
      </span>
      <span>
        字符数（计空格）<b>{stats.chars}</b>
      </span>
      <span className="spacer" />
      <span>{Math.round(zoom * 100)}%</span>
    </div>
  );
}

function blockText(block: any): string {
  const inline = Array.isArray(block?.content)
    ? block.content
        .map((c: any) =>
          c.type === "text"
            ? c.text
            : c.type === "link"
              ? (c.content ?? []).map((x: any) => x.text ?? "").join("")
              : "",
        )
        .join("")
    : "";
  const children = Array.isArray(block?.children)
    ? block.children.map(blockText).join("\n")
    : "";
  return inline + (children ? "\n" + children : "");
}
