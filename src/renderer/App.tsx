import { useCallback, useEffect, useRef, useState } from "react";
import { BlockNoteEditor } from "@blocknote/core";
import { filterSuggestionItems } from "@blocknote/core/extensions";
import "@blocknote/core/fonts/inter.css";
import { en, zh } from "@blocknote/core/locales";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
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

export function App() {
  const editorRef = useRef<BlockNoteEditor<any, any, any> | null>(null);
  const filePath = useRef<string | undefined>(undefined);
  const [fileName, setFileName] = useState("欢迎");
  const [settings, setSettingsState] = useState<Settings>({ providers: [] });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [status, setStatus] = useState("");

  const editor = useCreateBlockNote({
    dictionary: { ...zh, ai: aiZh },
    extensions: [
      AIExtension({
        agentCursor: { name: "AI", color: "#4f8ef7" },
        transport: new DefaultChatTransport({ api: CHAT_API, fetch: trackingFetch }),
      }),
    ],
    initialContent: [
      { type: "paragraph", content: "正在加载…" },
    ],
  });
  editorRef.current = editor;
  const changes = useAiChanges(editor);

  useEffect(() => {
    (async () => {
      setSettingsState(await getSettings());
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
    const r = await saveFile(md, filePath.current);
    if (!r.canceled && r.path) {
      filePath.current = r.path;
      setFileName(r.name || "文档");
      setStatus(`已保存到 ${r.path}`);
    } else {
      setStatus("");
    }
  }, []);

  const onOpen = useCallback(async () => {
    if (!editorRef.current) return;
    const r = await openFile();
    if (r.canceled || r.content == null) return;
    const blocks = await editorRef.current.tryParseMarkdownToBlocks(r.content);
    if (blocks) {
      await editorRef.current.replaceBlocks(editorRef.current.document, blocks);
      filePath.current = r.path;
      setFileName(r.name || "文档");
      setStatus(`已打开 ${r.path}`);
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
