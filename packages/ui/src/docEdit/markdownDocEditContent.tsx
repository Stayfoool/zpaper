// 文档编辑 pane（一期 MVP，见《智能文档编辑-调研与方案》阶段 1）：
// markdown 预览 pane 的可编辑形态 —— BlockNote 富文本编辑器 + xl-ai 的
// 「选中 → AI 编辑 → 审查态」。AI transport 由 PreviewPane 注入（真实模型
// 通道），未注入时回退演示 transport。保存经 onPersist 走
// FileService.writeTextFile 落盘。
import { useCallback, useEffect, useRef, useState } from "react";
import type { BlockNoteEditor } from "@blocknote/core";
import { en, zh } from "@blocknote/core/locales";
import type { ChatTransport, UIMessage } from "ai";
import { useCreateBlockNote } from "@blocknote/react";
import { AIExtension } from "@blocknote/xl-ai";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import "@blocknote/xl-ai/style.css";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { createDemoDocEditTransport } from "@/docEdit/docEditMockTransport.js";
import { DocEditSurface } from "@/docEdit/docEditSurface.js";

interface MarkdownDocEditContentProps {
  /** 打开时的文件内容（markdown 源文本） */
  content: string;
  /** 内容标识：变化时重新载入（切换文件 / 磁盘变更后的重读） */
  sourceKey: string;
  dark: boolean;
  /** 保存：父级经 FileService.writeTextFile 落盘；抛错即保存失败 */
  onPersist: (markdown: string) => Promise<void>;
  /**
   * 真实模型 transport（经 ZCode agent runtime / 账号层）。
   * 缺省时回退到演示 transport（无 key 也能演示交互）。
   */
  aiTransport?: ChatTransport<UIMessage>;
  /** 当前选中模型的展示名（如 provider/model），为空表示未选择模型 */
  modelLabel?: string;
}

type SaveState = { kind: "idle" } | { kind: "dirty" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string };

export function MarkdownDocEditContent({
  content,
  sourceKey,
  dark,
  onPersist,
  aiTransport,
  modelLabel,
}: MarkdownDocEditContentProps) {
  const { intl, locale } = useZCodeIntl();
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const savingRef = useRef(false);
  const editorRef = useRef<BlockNoteEditor<any, any, any> | null>(null);

  const editor = useCreateBlockNote({
    dictionary: locale.startsWith("zh") ? zh : en,
    extensions: [
      AIExtension({
        agentCursor: { name: "AI", color: "#4f8ef7" },
        transport: (aiTransport ?? createDemoDocEditTransport()) as never,
      }),
    ],
    initialContent: [{ type: "paragraph", content: "" }],
  });
  editorRef.current = editor;

  // 载入 markdown 内容（按 sourceKey 一次）
  useEffect(() => {
    if (loadedKey === sourceKey) return;
    let cancelled = false;
    setLoadedKey(sourceKey);
    setSaveState({ kind: "idle" });
    void (async () => {
      try {
        const blocks = await editor.tryParseMarkdownToBlocks(content);
        if (!cancelled && blocks) await editor.replaceBlocks(editor.document, blocks);
      } catch (error) {
        console.error("[docEdit] markdown load failed:", error);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- content/sourceKey 仅在载入时消费
  }, [editor, sourceKey]);

  const save = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaveState({ kind: "saving" });
    try {
      const ed = editorRef.current;
      if (!ed) throw new Error("editor unavailable");
      await onPersist(await ed.blocksToMarkdownLossy(ed.document));
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

  // ⌘S / Ctrl+S 保存
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
    saveState.kind === "saving"
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
          disabled={saveState.kind !== "dirty" && saveState.kind !== "error"}
          onClick={() => void save()}
        >
          {intl.formatMessage({ id: "codeViewer.docEdit.save" })}
        </button>
      </div>
      <div className="mx-auto max-w-3xl px-6 pb-16">
        <DocEditSurface editor={editor} dark={dark} onChange={editorChange} />
      </div>
    </div>
  );
}
