// Find & Replace bar (Ctrl/Cmd+F / Ctrl/Cmd+H) — sits at the top of the paper.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  useExtension,
  useExtensionState,
} from "@blocknote/react";
import type { BlockNoteEditor } from "@blocknote/core";
import { FindReplaceExtension } from "./FindReplaceExtension";

export function FindReplaceBar({ editor }: { editor: BlockNoteEditor<any, any, any> }) {
  const ext = useExtension(FindReplaceExtension, { editor });
  const state = useExtensionState(FindReplaceExtension, { editor });

  const [queryInput, setQueryInput] = useState(state.query);
  const [replaceInput, setReplaceInput] = useState(state.replacement);
  const queryRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);

  // focus the query field whenever the bar opens; pre-fill from selection
  useEffect(() => {
    if (state.open) {
      if (!queryInput && state.query === "") {
        const sel = editor.getSelectedText?.() || "";
        // only pre-fill short, single-line selections (Word behavior)
        const singleLine = sel.includes("\n") || sel.length > 80 ? "" : sel;
        if (singleLine) {
          setQueryInput(singleLine);
          ext.setQuery(editor, singleLine);
        }
      }
      window.setTimeout(() => {
        (state.showReplace ? replaceRef : queryRef).current?.focus();
        queryRef.current?.select();
      }, 0);
    } else {
      setQueryInput("");
      setReplaceInput("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.open, state.showReplace]);

  // debounced recompute as the user types
  useEffect(() => {
    if (!state.open) return;
    const t = window.setTimeout(() => ext.setQuery(editor, queryInput), 120);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryInput, state.matchCase]);

  // global shortcuts work even when the editor itself isn't focused
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        ext.open(editor, false);
      } else if (mod && e.key.toLowerCase() === "h") {
        e.preventDefault();
        ext.open(editor, true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor, ext]);

  const onInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        ext.goToMatch(editor, e.shiftKey ? -1 : 1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        ext.close(editor);
        editor.focus();
      }
    },
    [editor, ext],
  );

  if (!state.open) return null;

  const total = state.matches.length;
  const current = total > 0 ? state.activeIndex + 1 : 0;

  return (
    <div className="find-bar" role="search">
      <div className="find-row">
        <input
          ref={queryRef}
          className="find-input"
          placeholder="查找…"
          value={queryInput}
          onChange={(e) => setQueryInput(e.target.value)}
          onKeyDown={onInputKeyDown}
          spellCheck={false}
        />
        <button
          className={"find-option" + (state.matchCase ? " on" : "")}
          title="区分大小写"
          onClick={() => ext.toggleMatchCase(editor)}
        >
          Aa
        </button>
        <span className="find-count">
          {total > 0 ? `${current}/${total}` : queryInput ? "无结果" : ""}
        </span>
        <button
          className="icon-btn"
          title="上一个 (Shift+Enter)"
          onClick={() => ext.goToMatch(editor, -1)}
          disabled={total === 0}
        >
          ↑
        </button>
        <button
          className="icon-btn"
          title="下一个 (Enter)"
          onClick={() => ext.goToMatch(editor, 1)}
          disabled={total === 0}
        >
          ↓
        </button>
        <button
          className="icon-btn"
          title={state.showReplace ? "隐藏替换" : "显示替换 (Ctrl+H)"}
          onClick={() => {
            const show = !state.showReplace;
            // reuse open() to keep focus handling in one place
            ext.open(editor, show);
          }}
        >
          ⤵
        </button>
        <button
          className="icon-btn"
          title="关闭 (Esc)"
          onClick={() => {
            ext.close(editor);
            editor.focus();
          }}
        >
          ✕
        </button>
      </div>
      {state.showReplace && (
        <div className="find-row">
          <input
            ref={replaceRef}
            className="find-input"
            placeholder="替换为…"
            value={replaceInput}
            onChange={(e) => {
              setReplaceInput(e.target.value);
              ext.setReplacement(editor, e.target.value);
            }}
            onKeyDown={onInputKeyDown}
            spellCheck={false}
          />
          <button
            className="find-action"
            onClick={() => ext.replaceCurrent(editor)}
            disabled={total === 0}
          >
            替换
          </button>
          <button
            className="find-action"
            onClick={() => ext.replaceAll(editor)}
            disabled={total === 0}
          >
            全部替换
          </button>
        </div>
      )}
    </div>
  );
}
