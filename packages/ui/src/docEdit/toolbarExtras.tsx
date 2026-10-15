// Word 风格工具栏扩展控件：字体 / 字号下拉、上下标、两端对齐、清除格式。
// 移植自 zpaper ToolbarExtras.tsx，渲染在 DocEditSurface 的格式工具栏中。
import {
  defaultProps,
  type BlockSchema,
  type InlineContentSchema,
  type StyleSchema,
} from "@blocknote/core";
import {
  useBlockNoteEditor,
  useComponentsContext,
  useEditorState,
  usePortalElement,
} from "@blocknote/react";
import { FONT_FAMILIES, FONT_SIZES } from "@/docEdit/docEditSchema.js";

function useActiveStyles() {
  const editor = useBlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>();
  return useEditorState({
    editor,
    selector: ({ editor }) =>
      editor.isEditable ? (editor.getActiveStyles() as Record<string, any>) : undefined,
  });
}

export function FontFamilySelect() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>();
  const portalElement = usePortalElement();
  const activeStyles = useActiveStyles();

  const current = (activeStyles?.fontFamily as string) || "";

  return (
    <Components.FormattingToolbar.Select
      className="bn-select-font-family"
      portalElement={portalElement}
      items={FONT_FAMILIES.map((f) => ({
        text: f.name,
        icon: (
          <span style={{ fontFamily: f.value || undefined, fontSize: 13 }}>字Aa</span>
        ),
        onClick: () => {
          editor.focus();
          if (f.value) {
            editor.toggleStyles({ fontFamily: f.value } as any);
          } else {
            editor.removeStyles({ fontFamily: current || "x" } as any);
          }
        },
        isSelected: current === f.value,
      }))}
    />
  );
}

export function FontSizeSelect() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>();
  const portalElement = usePortalElement();
  const activeStyles = useActiveStyles();

  const current = (activeStyles?.fontSize as string) || "";
  const custom = current && !FONT_SIZES.includes(current as any);

  return (
    <Components.FormattingToolbar.Select
      className="bn-select-font-size"
      portalElement={portalElement}
      items={[
        // “默认”项保证未设字号时下拉仍然渲染
        {
          text: "默认",
          icon: <span style={{ fontSize: 13 }}>默认</span>,
          onClick: () => {
            editor.focus();
            editor.removeStyles({ fontSize: current || "x" } as any);
          },
          isSelected: !current,
        },
        ...(custom
          ? [
              {
                text: current,
                icon: <span style={{ fontSize: 13 }}>{current}</span>,
                onClick: () => {},
                isSelected: true,
              },
            ]
          : []),
        ...FONT_SIZES.map((size) => ({
          text: size,
          icon: <span style={{ fontSize: 13 }}>{size}</span>,
          onClick: () => {
            editor.focus();
            editor.toggleStyles({ fontSize: size } as any);
          },
          isSelected: current === size,
        })),
      ]}
    />
  );
}

export function SubscriptButton() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>();
  const activeStyles = useActiveStyles();

  const active = !!activeStyles?.subscript;

  return (
    <Components.FormattingToolbar.Button
      className="bn-button-subscript"
      label="下标"
      mainTooltip="下标 (Ctrl+,)"
      isSelected={active}
      onClick={() => {
        editor.focus();
        if (active) {
          editor.removeStyles({ subscript: true } as any);
        } else {
          editor.removeStyles({ superscript: true } as any);
          editor.toggleStyles({ subscript: true } as any);
        }
      }}
    >
      X<sub style={{ fontSize: "0.7em" }}>2</sub>
    </Components.FormattingToolbar.Button>
  );
}

export function SuperscriptButton() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>();
  const activeStyles = useActiveStyles();

  const active = !!activeStyles?.superscript;

  return (
    <Components.FormattingToolbar.Button
      className="bn-button-superscript"
      label="上标"
      mainTooltip="上标 (Ctrl+.)"
      isSelected={active}
      onClick={() => {
        editor.focus();
        if (active) {
          editor.removeStyles({ superscript: true } as any);
        } else {
          editor.removeStyles({ subscript: true } as any);
          editor.toggleStyles({ superscript: true } as any);
        }
      }}
    >
      X<sup style={{ fontSize: "0.7em" }}>2</sup>
    </Components.FormattingToolbar.Button>
  );
}

export function ClearFormattingButton() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>();
  const activeStyles = useActiveStyles();

  const styles = activeStyles ?? {};
  const hasAny = Object.keys(styles).length > 0;

  return (
    <Components.FormattingToolbar.Button
      className="bn-button-clear-formatting"
      label="清除格式"
      mainTooltip="清除格式"
      isDisabled={!hasAny}
      onClick={() => {
        editor.focus();
        editor.removeStyles({ ...styles } as any);
      }}
    >
      <span style={{ textDecoration: "line-through" }}>Tx</span>
    </Components.FormattingToolbar.Button>
  );
}

export function JustifyAlignButton() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>();

  const state = useEditorState({
    editor,
    selector: ({ editor }) => {
      if (!editor.isEditable) return undefined;
      const blocks = editor.getSelection()?.blocks || [
        editor.getTextCursorPosition().block,
      ];
      return {
        blocks,
        active: blocks[0]?.props?.textAlignment === "justify",
      };
    },
  });

  if (!state) return null;

  return (
    <Components.FormattingToolbar.Button
      className="bn-button-justify"
      label="两端对齐"
      mainTooltip="两端对齐"
      isSelected={state.active}
      onClick={() => {
        editor.focus();
        for (const block of state.blocks) {
          if (defaultProps.textAlignment) {
            editor.updateBlock(block, { props: { textAlignment: "justify" } } as any);
          }
        }
      }}
    >
      <span style={{ letterSpacing: 1 }}>≡</span>
    </Components.FormattingToolbar.Button>
  );
}

/* ------------------------------------------------------------------ */
/* 常驻工具栏（固定顶栏）专用控件                          */
/* ------------------------------------------------------------------ */

export function UndoButton() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>();

  return (
    <Components.FormattingToolbar.Button
      className="bn-button-undo"
      label="撤销"
      mainTooltip="撤销 (⌘Z)"
      onClick={() => {
        editor.focus();
        editor.undo();
      }}
    >
      ↺
    </Components.FormattingToolbar.Button>
  );
}

export function RedoButton() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>();

  return (
    <Components.FormattingToolbar.Button
      className="bn-button-redo"
      label="重做"
      mainTooltip="重做 (⇧⌘Z)"
      onClick={() => {
        editor.focus();
        editor.redo();
      }}
    >
      ↻
    </Components.FormattingToolbar.Button>
  );
}

export function InsertPageBreakButton() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>();

  return (
    <Components.FormattingToolbar.Button
      className="bn-button-page-break"
      label="分页符"
      mainTooltip="插入分页符"
      onClick={() => {
        editor.focus();
        const { block } = editor.getTextCursorPosition();
        editor.insertBlocks([{ type: "pageBreak" } as any], block as any, "after");
      }}
    >
      <span style={{ letterSpacing: 0.5 }}>⤓</span>
    </Components.FormattingToolbar.Button>
  );
}

/** 常驻工具栏的 AI 入口：在当前光标块打开 xl-ai 的 AI 菜单。 */
export function RibbonAIButton() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>();

  return (
    <Components.FormattingToolbar.Button
      className="bn-button-ribbon-ai"
      label="AI 编辑"
      mainTooltip="AI 编辑（就地修改，修订高亮可接受/拒绝）"
      onClick={() => {
        editor.focus();
        const em = (editor as any)._extensionManager;
        const ai = em?.extensions?.find(
          (x: any) => typeof x.openAIMenuAtBlock === "function",
        );
        if (!ai) return;
        const { block } = editor.getTextCursorPosition();
        ai.openAIMenuAtBlock(block.id);
      }}
    >
      <span style={{ color: "#4f8ef7", fontWeight: 700 }}>AI</span>
    </Components.FormattingToolbar.Button>
  );
}
