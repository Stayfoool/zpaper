// Find & Replace for the zpaper editor — the one big editing feature
// BlockNote 0.55 does not ship. Implemented as a BlockNote extension:
// a prosemirror plugin computes matches + highlight decorations, and the
// store mirrors match state for the React UI (FindReplaceBar).
import { createExtension, createStore } from "@blocknote/core";
import type { BlockNoteEditor } from "@blocknote/core";
import { Plugin, PluginKey, TextSelection } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { EditorView } from "prosemirror-view";

export type FindMatch = { from: number; to: number };

export type FindState = {
  open: boolean;
  showReplace: boolean;
  query: string;
  replacement: string;
  matchCase: boolean;
  matches: FindMatch[];
  activeIndex: number;
};

const pluginKey = new PluginKey<DecorationSet>("zpaper-find");

export const FindReplaceExtension = createExtension(() => {
  const store = createStore<FindState>({
    open: false,
    showReplace: false,
    query: "",
    replacement: "",
    matchCase: false,
    matches: [],
    activeIndex: -1,
  });

  // ---- matching over the document text -------------------------------

  function collectText(doc: import("prosemirror-model").Node) {
    // one flat string with a position lookup table, block boundaries → "\n"
    let text = "";
    const positions: number[] = [];
    doc.descendants((node, pos) => {
      if (node.isText && node.text) {
        for (let i = 0; i < node.text.length; i++) {
          positions.push(pos + i);
          text += node.text[i];
        }
      } else if (node.isBlock && text.length > 0 && !text.endsWith("\n")) {
        positions.push(-1); // separator, never part of a match
        text += "\n";
      }
      return true;
    });
    return { text, positions };
  }

  function findMatches(
    doc: import("prosemirror-model").Node,
    query: string,
    matchCase: boolean,
  ): FindMatch[] {
    if (!query) return [];
    const { text, positions } = collectText(doc);
    const haystack = matchCase ? text : text.toLowerCase();
    const needle = matchCase ? query : query.toLowerCase();
    const out: FindMatch[] = [];
    let idx = haystack.indexOf(needle);
    while (idx !== -1 && needle.length > 0) {
      const from = positions[idx];
      const to = positions[idx + needle.length - 1] + 1;
      if (from >= 0 && to > from) out.push({ from, to });
      idx = haystack.indexOf(needle, idx + needle.length);
    }
    return out;
  }

  // ---- the prosemirror plugin ----------------------------------------

  const plugin: Plugin<DecorationSet> = new Plugin<DecorationSet>({
    key: pluginKey,
    state: {
      init: () => DecorationSet.empty,
      apply: (tr, old) => {
        const meta = tr.getMeta(pluginKey) as
          | { matches: FindMatch[]; activeIndex: number }
          | undefined;
        if (meta) {
          const decos: Decoration[] = meta.matches.map((m, i) =>
            Decoration.inline(m.from, m.to, {
              class:
                i === meta.activeIndex
                  ? "zp-find-match zp-find-active"
                  : "zp-find-match",
            }),
          );
          return DecorationSet.create(tr.doc, decos);
        }
        if (!tr.docChanged) return old;
        // doc changed: recompute against the current query settings
        const s = store.state;
        if (!s.open || !s.query) return DecorationSet.empty;
        const matches = findMatches(tr.doc, s.query, s.matchCase);
        let activeIndex = -1;
        const prevFrom = s.matches[s.activeIndex]?.from;
        if (prevFrom != null) {
          const mapped = tr.mapping.map(prevFrom);
          activeIndex = matches.findIndex((m) => m.from >= mapped - 2);
        }
        store.setState((prev) => ({ ...prev, matches, activeIndex }));
        const decos: Decoration[] = matches.map((m, i) =>
          Decoration.inline(m.from, m.to, {
            class:
              i === activeIndex ? "zp-find-match zp-find-active" : "zp-find-match",
          }),
        );
        return DecorationSet.create(tr.doc, decos);
      },
    },
    props: {
      decorations: (state) => pluginKey.getState(state),
    },
  });

  // ---- imperative helpers (called from the UI) ------------------------

  function editorView(editor: BlockNoteEditor<any, any, any>): EditorView | null {
    return (editor as any).prosemirrorView ?? null;
  }

  function dispatchSet(
    editor: BlockNoteEditor<any, any, any>,
    patch: Partial<FindState>,
  ) {
    store.setState((prev) => ({ ...prev, ...patch }));
    const view = editorView(editor);
    if (!view) return;
    const s = store.state;
    const matches = patch.matches
      ? (patch.matches as FindMatch[])
      : findMatches(view.state.doc, s.query, s.matchCase);
    view.dispatch(
      view.state.tr.setMeta(pluginKey, {
        matches,
        activeIndex: s.activeIndex,
      }),
    );
  }

  function scrollToMatch(editor: BlockNoteEditor<any, any, any>, m: FindMatch) {
    const view = editorView(editor);
    if (!view) return;
    // select the whole match (Word behavior: typing over replaces it)
    const tr = view.state.tr.setSelection(
      TextSelection.create(view.state.doc, m.from, m.to),
    );
    tr.scrollIntoView();
    view.dispatch(tr.setMeta("addToHistory", false));
  }

  function recompute(editor: BlockNoteEditor<any, any, any>, keepActive = false) {
    const view = editorView(editor);
    if (!view) return;
    const s = store.state;
    const matches = findMatches(view.state.doc, s.query, s.matchCase);
    let activeIndex = s.activeIndex;
    if (!keepActive || activeIndex >= matches.length) {
      activeIndex = matches.length > 0 ? 0 : -1;
    }
    dispatchSet(editor, { matches, activeIndex });
    if (matches[activeIndex]) scrollToMatch(editor, matches[activeIndex]);
  }

  const api = {
    open(editor: BlockNoteEditor<any, any, any>, showReplace = false) {
      editor.focus();
      dispatchSet(editor, { open: true, showReplace });
      recompute(editor);
    },
    close(editor: BlockNoteEditor<any, any, any>) {
      dispatchSet(editor, { open: false, matches: [], activeIndex: -1 });
    },
    setQuery(
      editor: BlockNoteEditor<any, any, any>,
      query: string,
      matchCase = store.state.matchCase,
    ) {
      dispatchSet(editor, { query });
      recompute(editor);
    },
    setReplacement(editor: BlockNoteEditor<any, any, any>, replacement: string) {
      store.setState((prev) => ({ ...prev, replacement }));
    },
    toggleMatchCase(editor: BlockNoteEditor<any, any, any>) {
      store.setState((prev) => ({ ...prev, matchCase: !prev.matchCase }));
      recompute(editor);
    },
    goToMatch(editor: BlockNoteEditor<any, any, any>, dir: 1 | -1) {
      const s = store.state;
      if (s.matches.length === 0) return;
      const next =
        (s.activeIndex + dir + s.matches.length) % s.matches.length;
      store.setState((prev) => ({ ...prev, activeIndex: next }));
      const view = editorView(editor);
      view?.dispatch(
        view.state.tr.setMeta(pluginKey, {
          matches: s.matches,
          activeIndex: next,
        }),
      );
      scrollToMatch(editor, s.matches[next]);
    },
    replaceCurrent(editor: BlockNoteEditor<any, any, any>) {
      const s = store.state;
      const m = s.matches[s.activeIndex];
      const view = editorView(editor);
      if (!m || !view) return;
      view.dispatch(view.state.tr.insertText(s.replacement, m.from, m.to));
      // the plugin's apply() recomputes matches + decorations on the doc
      // change and keeps walking forward from the replaced position
    },
    replaceAll(editor: BlockNoteEditor<any, any, any>) {
      const s = store.state;
      const view = editorView(editor);
      if (!view || s.matches.length === 0) return;
      const tr = view.state.tr;
      // apply back-to-front so earlier positions stay valid
      for (let i = s.matches.length - 1; i >= 0; i--) {
        tr.insertText(s.replacement, s.matches[i].from, s.matches[i].to);
      }
      view.dispatch(tr);
    },
  };

  return {
    key: "zpaperFindReplace" as const,
    store,
    keyboardShortcuts: {
      "Mod-f": (ctx) => {
        api.open(ctx.editor, false);
        return true;
      },
      "Mod-h": (ctx) => {
        api.open(ctx.editor, true);
        return true;
      },
    },
    prosemirrorPlugins: [plugin],
    ...api,
  };
});

export type FindReplaceApi = ReturnType<ReturnType<typeof FindReplaceExtension>>;
