import { useCallback, useEffect, useRef, useState } from "react";
import { BlockNoteEditor } from "@blocknote/core";
import { CollaborationExtension } from "@blocknote/core/yjs";
import { filterSuggestionItems } from "@blocknote/core/extensions";
import "@blocknote/core/fonts/inter.css";
import { en, zh } from "@blocknote/core/locales";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import {
  FormattingToolbar,
  FormattingToolbarController,
  getDefaultReactSlashMenuItems,
  getFormattingToolbarItems,
  SuggestionMenuController,
  useCreateBlockNote,
} from "@blocknote/react";
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

export function App() {
  const collabCfg = useRef<CollabConfig | null>(loadCollab());
  const editorRef = useRef<BlockNoteEditor<any, any, any> | null>(null);
  const filePath = useRef<string | undefined>(undefined);
  const [fileName, setFileName] = useState(collabCfg.current ? `协作·${collabCfg.current.room}` : "欢迎");
  const [settings, setSettingsState] = useState<Settings>({ providers: [] });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [collabOpen, setCollabOpen] = useState(false);
  const [status, setStatus] = useState("");

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
    dictionary: { ...zh, ai: aiZh },
    extensions: [
      AIExtension({
        agentCursor: { name: "AI", color: "#4f8ef7" },
        transport: new DefaultChatTransport({ api: CHAT_API, fetch: trackingFetch }),
      }),
      ...(collabOptions ? [CollaborationExtension(collabOptions as any)] : []),
    ],
    ...(collabCfg.current
      ? {}
      : { initialContent: [{ type: "paragraph", content: "正在加载…" }] as any }),
  });
  editorRef.current = editor;
  const changes = useAiChanges(editor);

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
      const isEmpty =
        fragment.length === 0 ||
        (doc.length <= 1 && !(doc[0]?.content?.map((c: any) => c.text).join("") || "").trim());
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

  const onSave = useCallback(async () => {
    if (!editorRef.current) return;
    setStatus("保存中…");
    const md = await editorRef.current.blocksToMarkdownLossy(editorRef.current.document);
    const r = await saveFile({
      markdown: md,
      blocks: editorRef.current.document,
      path: filePath.current,
    });
    if (r.error) {
      setStatus(r.error);
    } else if (!r.canceled && r.path) {
      filePath.current = r.path;
      setFileName(r.name || "文档");
      setStatus(isDocx(r.path) ? "已保存为 Word 文档" : `已保存到 ${r.path}`);
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
      setStatus("已打开 Word 文档（内容级保真，样式可能简化）");
      return;
    }
    if (r.content != null) {
      const blocks = await editorRef.current.tryParseMarkdownToBlocks(r.content);
      if (blocks) {
        await editorRef.current.replaceBlocks(editorRef.current.document, blocks);
        filePath.current = r.path;
        setFileName(r.name || "文档");
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

      {status && <div className="statusbar">{status}</div>}

      <div className={"main-area" + (changes.open ? " with-panel" : "")}>
        <div className="paper-wrap">
          <div className="paper">
          <BlockNoteView
            editor={editor}
            formattingToolbar={false}
            slashMenu={false}
          >
            <AIMenuController />
            <FormattingToolbarController
              formattingToolbar={() => (
                <FormattingToolbar>
                  {...getFormattingToolbarItems()}
                  <AIToolbarButton>AI 编辑</AIToolbarButton>
                </FormattingToolbar>
              )}
            />
            <SuggestionMenuController
              triggerCharacter="/"
              getItems={async (query) =>
                filterSuggestionItems(getDefaultReactSlashMenuItems(editor), query).concat(
                  // AI items live at the end of the slash menu
                  filterSuggestionItems(getAISlashMenuItems(editor), query),
                )
              }
            />
          </BlockNoteView>
          </div>
        </div>
        {changes.open && (
          <ChangesPanel
            entries={changes.entries}
            onClose={() => changes.setOpen(false)}
            onClear={() => changes.clear()}
          />
        )}
      </div>

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
      clickOption: (index = 0) => {
        const els = document.querySelectorAll<HTMLElement>('[role="option"]');
        els[index]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        return els.length;
      },
      blockIds: () => editor.document.map((b: any) => b.id),
    };
  }, 0);
}
