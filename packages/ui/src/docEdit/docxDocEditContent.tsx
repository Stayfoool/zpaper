// docx 文档编辑 pane（阶段 3 快路线，管线移植自 zpaper v0.5 已验证方案）：
//   打开：FileService.readFileRange 读字节 → mammoth（browser build）转 HTML
//         → BlockNote tryParseHTMLToBlocks 转块（渲染端有真实 DOM，无需 polyfill）
//   保存：BlockNote blocksToHTMLLossy → FileService.writeDocxFromHtml
//         （host 侧 html-to-docx 组装 .docx，原子落盘）
// 保真为「内容与结构级」：标题/加粗/列表/表格保留，视觉样式（字体/页眉等）
// 按管线设计简化；Word 原生修订写回（SuperDoc）为后续增强。
import { useCallback, useEffect, useRef, useState } from "react";
import type { BlockNoteEditor } from "@blocknote/core";
import { en, zh } from "@blocknote/core/locales";
import type { ChatTransport, UIMessage } from "ai";
import { useCreateBlockNote } from "@blocknote/react";
import { AIExtension } from "@blocknote/xl-ai";
import { en as aiEn, zh as aiZh } from "@blocknote/xl-ai/locales";
import * as mammoth from "mammoth";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import "@blocknote/xl-ai/style.css";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { createDemoDocEditTransport } from "@/docEdit/docEditMockTransport.js";
import { docEditSchema } from "@/docEdit/docEditSchema.js";
import { DocEditSurface } from "@/docEdit/docEditSurface.js";

const MAX_DOCX_BYTES = 50 * 1024 * 1024;

interface DocxDocEditContentProps {
  sourcePath: string;
  dark: boolean;
  /** 读取 docx 原始字节（PreviewPane 注入 FileService.readFileRange 封装） */
  readBytes: (path: string) => Promise<Uint8Array>;
  /** 保存：父级经 FileService.writeDocxFromHtml 落盘 */
  onPersist: (html: string) => Promise<void>;
  aiTransport?: ChatTransport<UIMessage>;
  /** 当前选中模型的展示名，为空表示未选择模型 */
  modelLabel?: string;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; message: string };

type SaveState =
  | { kind: "idle" }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

export function DocxDocEditContent({
  sourcePath,
  dark,
  readBytes,
  onPersist,
  aiTransport,
  modelLabel,
}: DocxDocEditContentProps) {
  const { intl, locale } = useZCodeIntl();
  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [loadedPath, setLoadedPath] = useState<string | null>(null);
  const savingRef = useRef(false);
  const editorRef = useRef<BlockNoteEditor<any, any, any> | null>(null);

  const editor = useCreateBlockNote({
    schema: docEditSchema,
    // xl-ai 词典并入 editor dictionary，否则 AI 菜单报 "AI dictionary not found"
    dictionary: {
      ...(locale.startsWith("zh") ? zh : en),
      ai: locale.startsWith("zh") ? aiZh : aiEn,
    },
    extensions: [
      AIExtension({
        agentCursor: { name: "AI", color: "#4f8ef7" },
        transport: (aiTransport ?? createDemoDocEditTransport()) as never,
      }),
    ],
    initialContent: [{ type: "paragraph", content: "" }],
  });
  editorRef.current = editor;

  // 打开：docx 字节 → mammoth → HTML → blocks（按 sourcePath 一次）
  useEffect(() => {
    if (loadedPath === sourcePath) return;
    let cancelled = false;
    setLoadedPath(sourcePath);
    setLoadState({ kind: "loading" });
    setSaveState({ kind: "idle" });
    void (async () => {
      try {
        const bytes = await readBytes(sourcePath);
        if (cancelled) return;
        const arrayBuffer = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer;
        const { value: html } = await (mammoth as any).convertToHtml({ arrayBuffer });
        if (cancelled) return;
        const blocks = await editor.tryParseHTMLToBlocks(html);
        if (cancelled) return;
        if (!blocks || blocks.length === 0) {
          setLoadState({ kind: "error", message: intl.formatMessage({ id: "codeViewer.docEdit.docxEmpty" }) });
          return;
        }
        await editor.replaceBlocks(editor.document, blocks);
        setLoadState({ kind: "ready" });
      } catch (error) {
        if (!cancelled) {
          setLoadState({
            kind: "error",
            message: `${intl.formatMessage({ id: "codeViewer.docEdit.docxOpenFailed" })}：${
              error instanceof Error ? error.message : String(error)
            }`,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在 sourcePath 变化时载入
  }, [editor, sourcePath]);

  const save = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaveState({ kind: "saving" });
    try {
      const ed = editorRef.current;
      if (!ed) throw new Error("editor unavailable");
      const html = await ed.blocksToHTMLLossy(ed.document);
      await onPersist(html);
      setSaveState({ kind: "saved" });
    } catch (error) {
      setSaveState({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      savingRef.current = false;
    }
  }, [onPersist]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [save]);

  const editorChange = useCallback(() => {
    setSaveState({ kind: "dirty" });
  }, []);

  const statusText =
    loadState.kind === "error"
      ? loadState.message
      : saveState.kind === "saving"
        ? intl.formatMessage({ id: "codeViewer.docEdit.saving" })
        : saveState.kind === "saved"
          ? intl.formatMessage({ id: "codeViewer.docEdit.saved" })
          : saveState.kind === "error"
            ? `${intl.formatMessage({ id: "codeViewer.docEdit.saveFailed" })}：${saveState.message}`
            : "";

  return (
    <div className="relative h-full w-full overflow-auto bg-background">
      <div className="pointer-events-none sticky top-0 z-10 flex items-center justify-end gap-2 bg-background/80 px-3 py-1.5 backdrop-blur-sm">
        <span
          className="pointer-events-auto rounded-md border border-border px-2 py-0.5 text-xs text-foreground-subtle"
          title={
            aiTransport
              ? intl.formatMessage({ id: "codeViewer.docEdit.modelBadgeTitle" })
              : intl.formatMessage({ id: "codeViewer.docEdit.demoBadgeTitle" })
          }
        >
          {modelLabel
            ? `AI：${modelLabel}`
            : aiTransport
              ? intl.formatMessage({ id: "codeViewer.docEdit.noModel" })
              : intl.formatMessage({ id: "codeViewer.docEdit.demoMode" })}
        </span>
        {statusText ? (
          <span className="pointer-events-auto text-xs text-foreground-subtle">{statusText}</span>
        ) : null}
        <button
          type="button"
          className="pointer-events-auto rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-accent disabled:opacity-50"
          disabled={loadState.kind !== "ready" || (saveState.kind !== "dirty" && saveState.kind !== "error")}
          onClick={() => void save()}
        >
          {intl.formatMessage({ id: "codeViewer.docEdit.save" })}
        </button>
      </div>
      {loadState.kind === "loading" ? (
        <div className="p-4 text-sm text-foreground-subtle">
          {intl.formatMessage({ id: "codeViewer.docEdit.docxLoading" })}
        </div>
      ) : loadState.kind === "error" ? (
        <div className="p-4 text-sm text-destructive">{loadState.message}</div>
      ) : (
        <div className="mx-auto max-w-3xl px-6 pb-16">
          <DocEditSurface editor={editor} dark={dark} onChange={editorChange} />
        </div>
      )}
    </div>
  );
}
