import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BlockNoteEditor } from "@blocknote/core";
import { CollaborationExtension } from "@blocknote/core/yjs";
import { filterSuggestionItems } from "@blocknote/core/extensions";
import { insertOrUpdateBlockForSlashMenu } from "@blocknote/core/extensions";
import { CommentsExtension } from "@blocknote/core/comments";
import type { DefaultReactSuggestionItem } from "@blocknote/react";
import "@blocknote/core/fonts/inter.css";
import { en, zh } from "@blocknote/core/locales";
import {
  FormattingToolbar,
  FormattingToolbarController,
  getDefaultReactSlashMenuItems,
  getPageBreakReactSlashMenuItems,
  SuggestionMenuController,
  ThreadsSidebar,
  useCreateBlockNote,
  AddCommentButton,
  BasicTextStyleButton,
  ColorStyleButton,
  CreateLinkButton,
  FileCaptionButton,
  FileDeleteButton,
  FileDownloadButton,
  FilePreviewButton,
  FileRenameButton,
  FileReplaceButton,
  NestBlockButton,
  TableCellMergeButton,
  TextAlignButton,
  UnnestBlockButton,
  BlockTypeSelect,
  FloatingComposerController,
  FloatingThreadController,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import {
  AIExtension,
  AIMenuController,
  AIToolbarButton,
  getAISlashMenuItems,
} from "@blocknote/xl-ai";
import { en as aiEn, zh as aiZh } from "@blocknote/xl-ai/locales";
import "@blocknote/xl-ai/style.css";
import { DefaultChatTransport } from "ai";
import {
  CHAT_API,
  getSettings,
  isElectron,
  openFile,
  saveFile,
  setSettings,
  type Settings,
} from "./bridge";
import { WELCOME_MD } from "./welcome";
import { SettingsModal, PRESETS } from "./SettingsModal";
import { useAiChanges, lastInstruction } from "./useAiChanges";
import { ChangesPanel } from "./ChangesPanel";
import { CollabDialog, loadCollab, type CollabConfig } from "./CollabDialog";
import { flattenBlocks } from "../shared/blockText";
import { zpaperSchema } from "./schema";
import { FindReplaceExtension } from "./FindReplaceExtension";
import { FindReplaceBar } from "./FindReplaceBar";
import { MenuBar, StatusBar, useTheme, useZoom } from "./MenuBar";
import {
  ClearFormattingButton,
  FontFamilySelect,
  FontSizeSelect,
  JustifyAlignButton,
  SubscriptButton,
  SuperscriptButton,
} from "./ToolbarExtras";
import { createLocalThreadStore, LOCAL_USER_ID } from "./LocalThreadStore";
import { ChatPanel, type DocContext } from "./ChatPanel";
import { applyDocEdits, readSelectionText } from "./docOps";

// capture the user's instruction from the outgoing AI request body
const trackingFetch: typeof fetch = async (input, init) => {
  try {
    if (init?.body) {
      const body = JSON.parse(String(init.body));
      const msgs = Array.isArray(body?.messages) ? body.messages : [];
      const lastUser = [...msgs].reverse().find((m: any) => m.role === "user");
      const text = (lastUser?.parts ?? [])
        .filter((p: any) => p.type === "text")
        .map((p: any) => p.text)
        .join(" ");
      if (text) lastInstruction.text = text.slice(0, 80);
    }
  } catch {
    /* tracking only */
  }
  return fetch(input, init);
};

const isDocx = (p: string) => /\.docx$/i.test(p);

// local uploads become data URLs — zpaper is offline-first and has no server
const uploadFile = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

// comment users: single local user; remote collab users fall back to their id
const resolveUsers = async (userIds: string[]) =>
  userIds.map((id) => ({
    id,
    username: id === LOCAL_USER_ID ? "我" : id,
    avatarUrl: "",
  }));

export function App() {
  const collabCfg = useRef<CollabConfig | null>(loadCollab());
  const editorRef = useRef<BlockNoteEditor<any, any, any> | null>(null);
  const filePath = useRef<string | undefined>(undefined);
  // snapshot of the blocks as they were when a .docx was opened — the baseline
  // for writing accepted edits back as Word-native tracked changes
  const originalDocx = useRef<{ path: string; blocks: ReturnType<typeof flattenBlocks> } | null>(null);
  const [fileName, setFileName] = useState(collabCfg.current ? `协作·${collabCfg.current.room}` : "欢迎");
  const [settings, setSettingsState] = useState<Settings>({ providers: [] });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [collabOpen, setCollabOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(() => localStorage.getItem("zpaper:chat:open") !== "0");
  const commentsBodyRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState("");
  const { theme, setTheme } = useTheme();
  const { zoom, setZoom } = useZoom();

  // one local comment store per document session
  const threadStore = useMemo(() => createLocalThreadStore(), []);

  // collaboration (if configured) is wired at editor creation; joining/leaving
  // saves the config and reloads the page
  const ydocRef = useRef<Y.Doc | null>(null);
  const wsRef = useRef<WebsocketProvider | null>(null);
  let collabOptions: Record<string, any> | undefined;
  if (collabCfg.current) {
    const ydoc = new Y.Doc();
    const provider = new WebsocketProvider(collabCfg.current.server, collabCfg.current.room, ydoc);
    ydocRef.current = ydoc;
    wsRef.current = provider;
    collabOptions = {
      fragment: ydoc.getXmlFragment("document"),
      user: { name: collabCfg.current.name, color: collabCfg.current.color },
      provider: { awareness: provider.awareness },
      showCursorLabels: "activity",
    };
  }

  const editor = useCreateBlockNote({
    schema: zpaperSchema,
    // xl-ai 自带的中文文案与产品术语不一致，覆盖为「AI 编辑」
    dictionary: {
      ...zh,
      ai: {
        ...aiZh,
        formatting_toolbar: {
          ...aiZh.formatting_toolbar,
          ai: { tooltip: "AI 编辑" },
        },
      },
    },
    uploadFile,
    extensions: [
      AIExtension({
        agentCursor: { name: "AI", color: "#4f8ef7" },
        transport: new DefaultChatTransport({ api: CHAT_API, fetch: trackingFetch }) as any,
      }),
      FindReplaceExtension(),
      CommentsExtension({ threadStore, resolveUsers }),
      ...(collabOptions ? [CollaborationExtension(collabOptions as any)] : []),
    ],
    ...(collabCfg.current
      ? {}
      : { initialContent: [{ type: "paragraph", content: "正在加载…" }] as any }),
  });
  editorRef.current = editor;
  const changes = useAiChanges(editor);

  // live selection text — the chat panel quotes it as「选区」context
  const [selectionText, setSelectionText] = useState("");
  useEffect(() => {
    if (!editor) return;
    const read = () => setSelectionText(readSelectionText(editor).slice(0, 4000));
    let off: (() => void) | undefined;
    try {
      off = (editor as any).onSelectionChange?.(read);
    } catch {
      off = undefined;
    }
    let el: HTMLElement | null = null;
    if (!off) {
      el = ((editor as any).domElement as HTMLElement) ?? null;
      el?.addEventListener("mouseup", read);
      el?.addEventListener("keyup", read);
    }
    read();
    return () => {
      try {
        off?.();
      } catch {
        /* already gone */
      }
      if (el) {
        el.removeEventListener("mouseup", read);
        el.removeEventListener("keyup", read);
      }
    };
  }, [editor]);

  // seed the collaborative document if the room is empty (first user)
  useEffect(() => {
    if (!collabCfg.current) return;
    const provider = wsRef.current!;
    const ydoc = ydocRef.current!;
    const seed = async () => {
      const fragment = ydoc.getXmlFragment("document");
      // BlockNote writes an initial empty paragraph into the fragment, so
      // "empty room" means: nothing (or one block with no text at all)
      const doc = editor.document;
      const firstContent = doc[0]?.content;
      // content 可能是 InlineContent[] 或表格的 TableContent，后者没有可读文本
      const firstText = Array.isArray(firstContent)
        ? firstContent.map((c: any) => c.text).join("")
        : "";
      const isEmpty = fragment.length === 0 || (doc.length <= 1 && !firstText.trim());
      if (isEmpty) {
        try {
          const blocks = await editor.tryParseMarkdownToBlocks(WELCOME_MD);
          if (blocks) await editor.replaceBlocks(editor.document, blocks);
        } catch (e) {
          console.error("collab seed failed", e);
        }
      }
    };
    if (provider.synced) seed();
    else provider.on("sync", (s: boolean) => s && seed());
    return () => {
      provider.destroy();
      ydoc.destroy();
    };
  }, [editor]);

  useEffect(() => {
    (async () => {
      setSettingsState(await getSettings());
      if (collabCfg.current) return; // collaborative content comes from the room
      try {
        const blocks = await editor.tryParseMarkdownToBlocks(WELCOME_MD);
        if (blocks) await editor.replaceBlocks(editor.document, blocks);
      } catch (e) {
        console.error("welcome doc failed", e);
      }
    })();
    (window as any).__zpaperEditor = editor;
    exposeAutomationHook();
  }, [editor]);

  // keep the automation hook current on every render
  useEffect(() => {
    (window as any).__zpaperChanges = changes;
  });

  const activeProvider = settings.providers.find((p) => p.id === settings.activeProviderId);
  const providerLabel = activeProvider ? activeProvider.name : "演示模式";

  // the chat panel reads the document as it is at send time; docDir gives the
  // ZCode agent a workspace to read around the document
  const getDocContext = useCallback(async (): Promise<DocContext> => {
    const ed = editorRef.current;
    const markdown = ed ? await ed.blocksToMarkdownLossy(ed.document) : "";
    const p = filePath.current;
    const cut = p ? Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")) : -1;
    const docDir = p && cut > 0 ? p.slice(0, cut) : undefined;
    return { docTitle: fileName, docMarkdown: markdown, docDir };
  }, [fileName]);

  const onSave = useCallback(async () => {
    if (!editorRef.current) return;
    setStatus("保存中…");
    const md = await editorRef.current.blocksToMarkdownLossy(editorRef.current.document);
    const r = await saveFile({
      markdown: md,
      blocks: editorRef.current.document,
      path: filePath.current,
      originalPath: originalDocx.current?.path,
      originalBlocks: originalDocx.current?.blocks,
      tracked: !!originalDocx.current,
    });
    if (r.error && !r.fallbackSaved) {
      setStatus(r.error);
      return;
    }
    if (!r.canceled && r.path) {
      filePath.current = r.path;
      setFileName(r.name || "文档");
      if (r.trackedChanges != null) {
        setStatus(`已保存为 Word 文档（含 ${r.trackedChanges} 处修订标记）`);
      } else if (r.fallbackSaved) {
        setStatus(`已保存（普通方式）。${r.error || ""}`);
      } else if (isDocx(r.path)) {
        setStatus("已保存为 Word 文档");
      } else {
        setStatus(`已保存到 ${r.path}`);
      }
      // rebase the tracked-changes baseline on the just-saved file
      if (isDocx(r.path) && editorRef.current) {
        originalDocx.current = {
          path: r.path,
          blocks: flattenBlocks(editorRef.current.document as any),
        };
      }
    } else {
      setStatus("");
    }
  }, []);

  const onOpen = useCallback(async () => {
    if (!editorRef.current) return;
    const r = await openFile();
    if (r.canceled) return;
    if (r.error) {
      setStatus(r.error);
      return;
    }
    if (r.kind === "blocks" && r.blocks) {
      await editorRef.current.replaceBlocks(editorRef.current.document, r.blocks as any);
      filePath.current = r.path;
      setFileName(r.name || "文档");
      originalDocx.current = { path: r.path!, blocks: flattenBlocks(r.blocks) };
      setStatus("已打开 Word 文档（内容级保真，AI 修改可以修订形式写回）");
      return;
    }
    if (r.content != null) {
      const blocks = await editorRef.current.tryParseMarkdownToBlocks(r.content);
      if (blocks) {
        await editorRef.current.replaceBlocks(editorRef.current.document, blocks);
        filePath.current = r.path;
        setFileName(r.name || "文档");
        originalDocx.current = null;
        setStatus(`已打开 ${r.path}`);
      }
    }
  }, []);

  const onNew = useCallback(async () => {
    if (!editorRef.current) return;
    const blocks = await editorRef.current.tryParseMarkdownToBlocks("# 新文档\n\n");
    if (blocks) await editorRef.current.replaceBlocks(editorRef.current.document, blocks);
    filePath.current = undefined;
    setFileName("未命名");
    originalDocx.current = null;
    setStatus("");
  }, []);

  const onSaveSettings = useCallback(async (s: Settings) => {
    await setSettings(s);
    setSettingsState(s);
    setSettingsOpen(false);
    setStatus("设置已保存");
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">z</span>
          <span className="brand-name">zpaper</span>
          <span className="file-name">{fileName}</span>
        </div>
        <div className="actions">
          <button onClick={onNew}>新建</button>
          <button onClick={onOpen}>打开</button>
          <button onClick={onSave} className="primary">保存</button>
          <span className="divider" />
          <button
            className={chatOpen ? "primary" : ""}
            onClick={() => {
              setChatOpen((v) => {
                localStorage.setItem("zpaper:chat:open", v ? "0" : "1");
                return !v;
              });
            }}
            title="与 AI 多轮对话（会读到当前文档内容）"
          >
            💬 对话
          </button>
          <button onClick={() => changes.setOpen(!changes.open)}>
            变更{changes.entries.length > 0 ? ` (${changes.entries.length})` : ""}
          </button>
          <button
            className={collabCfg.current ? "primary" : ""}
            onClick={() => setCollabOpen(true)}
            title={collabCfg.current ? `已加入房间 ${collabCfg.current.room}` : "多人协作"}
          >
            {collabCfg.current ? `协作·${collabCfg.current.room}` : "协作"}
          </button>
          <span
            className={"ai-badge" + (activeProvider ? " ok" : "")}
            title={activeProvider ? `${activeProvider.name} · ${activeProvider.model}` : "未配置模型，当前为演示模式"}
          >
            {activeProvider ? `AI：${activeProvider.name}` : "AI：演示模式"}
          </span>
          <button onClick={() => setSettingsOpen(true)}>⚙ 设置</button>
        </div>
      </header>

      <MenuBar
        editor={editor}
        theme={theme}
        onToggleTheme={() => setTheme(theme === "light" ? "dark" : "light")}
        zoom={zoom}
        onZoom={setZoom}
        commentsOpen={commentsOpen}
        onToggleComments={() => setCommentsOpen((v) => !v)}
      />

      {status && <div className="statusbar">{status}</div>}

      <div className={"main-area" + (changes.open ? " with-panel" : "")}>
        <div className="paper-wrap">
          <FindReplaceBar editor={editor} />
          <div className="paper" style={{ zoom }}>
          <BlockNoteView
            editor={editor}
            theme={theme}
            formattingToolbar={false}
            slashMenu={false}
          >
            <AIMenuController />
            <FloatingComposerController />
            <FloatingThreadController />
            {commentsOpen && <CommentsPortal targetRef={commentsBodyRef} />}
            <FormattingToolbarController
              formattingToolbar={() => (
                <FormattingToolbar>
                  <BlockTypeSelect />
                  <FontFamilySelect />
                  <FontSizeSelect />
                  <TableCellMergeButton />
                  <FileCaptionButton />
                  <FileReplaceButton />
                  <FileRenameButton />
                  <FileDeleteButton />
                  <FileDownloadButton />
                  <FilePreviewButton />
                  <BasicTextStyleButton basicTextStyle={"bold"} />
                  <BasicTextStyleButton basicTextStyle={"italic"} />
                  <BasicTextStyleButton basicTextStyle={"underline"} />
                  <BasicTextStyleButton basicTextStyle={"strike"} />
                  <BasicTextStyleButton basicTextStyle={"code"} />
                  <SubscriptButton />
                  <SuperscriptButton />
                  <TextAlignButton textAlignment={"left"} />
                  <TextAlignButton textAlignment={"center"} />
                  <TextAlignButton textAlignment={"right"} />
                  <JustifyAlignButton />
                  <ColorStyleButton />
                  <NestBlockButton />
                  <UnnestBlockButton />
                  <CreateLinkButton />
                  <ClearFormattingButton />
                  {/* AIToolbarButton 不接收 children（文案来自上方字典），见 xl-ai 0.55 实现 */}
                  <AIToolbarButton />
                  <AddCommentButton />
                </FormattingToolbar>
              )}
            />
            <SuggestionMenuController
              triggerCharacter="/"
              getItems={async (query) =>
                filterSuggestionItems(
                  [
                    ...getDefaultReactSlashMenuItems(editor),
                    ...getPageBreakReactSlashMenuItems(editor),
                    ...getZpaperSlashItems(editor),
                  ],
                  query,
                ).concat(
                  // AI items live at the end of the slash menu
                  filterSuggestionItems(getAISlashMenuItems(editor), query),
                )
              }
            />
          </BlockNoteView>
          </div>
        </div>
        {chatOpen && (
          <ChatPanel
            providerLabel={providerLabel}
            getDocContext={getDocContext}
            getSelection={() => readSelectionText(editorRef.current)}
            applyEdits={(plan) => {
              const ed = editorRef.current;
              return ed ? applyDocEdits(ed, plan) : { applied: 0, failed: 0 };
            }}
            onStatus={setStatus}
            onClose={() => {
              setChatOpen(false);
              localStorage.setItem("zpaper:chat:open", "0");
            }}
          />
        )}
        {commentsOpen && (
          <div className="comments-panel">
            <div className="changes-head">
              <span>评论</span>
              <button className="link" onClick={() => setCommentsOpen(false)}>
                关闭
              </button>
            </div>
            <div className="comments-body" ref={commentsBodyRef} />
          </div>
        )}
        {changes.open && (
          <ChangesPanel
            entries={changes.entries}
            onClose={() => changes.setOpen(false)}
            onClear={() => changes.clear()}
          />
        )}
      </div>

      <StatusBar editor={editor} zoom={zoom} />

      {settingsOpen && (
        <SettingsModal
          initial={settings}
          onCancel={() => setSettingsOpen(false)}
          onSave={onSaveSettings}
        />
      )}

      {collabOpen && (
        <CollabDialog current={collabCfg.current} onClose={() => setCollabOpen(false)} />
      )}
    </div>
  );
}

// Renders the ThreadsSidebar inside the editor's React context (it needs
// BlockNote's components context) but portals its DOM into the comments
// side panel next to the paper.
function CommentsPortal({ targetRef }: { targetRef: React.RefObject<HTMLDivElement | null> }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || !targetRef.current) return null;
  return createPortal(<ThreadsSidebar filter="all" sort="position" />, targetRef.current);
}

// slash-menu entries for zpaper's own blocks
function getZpaperSlashItems(editor: BlockNoteEditor<any, any, any>): DefaultReactSuggestionItem[] {  return [
    {
      title: "提示块",
      subtext: "带颜色和图标的信息提示框",
      group: "高级",
      icon: <span style={{ fontSize: 16 }}>💡</span>,
      onItemClick: () => {
        insertOrUpdateBlockForSlashMenu(editor, { type: "callout" } as any);
      },
    },
    {
      title: "目录",
      subtext: "根据标题自动生成目录",
      group: "高级",
      icon: <span style={{ fontSize: 16 }}>☰</span>,
      onItemClick: () => {
        insertOrUpdateBlockForSlashMenu(editor, { type: "tableOfContents" } as any);
      },
    },
  ];
}

// automation / E2E hook (no-op in packaged builds, harmless to keep)
function exposeAutomationHook() {
  (window as any).__zpaper = {
    get editor() {
      return (window as any).__zpaperEditor;
    },
  };
  // editor is assigned by the effect below via a second pass
  setTimeout(() => {
    const editor = (window as any).__zpaperEditor;
    if (!editor) return;
    (window as any).__zpaper = {
      editor,
      selectBlock: (id: string) => {
        editor.setTextCursorPosition(id, "start");
        const ids = editor.document.map((b: any) => b.id as string);
        const i = ids.indexOf(id);
        const other = ids[i + 1] ?? ids[i - 1];
        editor.setSelection(id, other);
      },
      openAIAt: (id: string) => {
        const em = editor._extensionManager;
        const ai = em.extensions.find((x: any) => typeof x.openAIMenuAtBlock === "function");
        if (!ai) return false;
        ai.openAIMenuAtBlock(id);
        return true;
      },
      applyDocEdits: (plan: any) => applyDocEdits(editor, plan),
      clickOption: (index = 0) => {
        const els = document.querySelectorAll<HTMLElement>('[role="option"]');
        els[index]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        return els.length;
      },
      blockIds: () => editor.document.map((b: any) => b.id),
    };
  }, 0);
}
