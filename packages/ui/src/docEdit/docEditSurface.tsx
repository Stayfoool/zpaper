// 文档编辑 pane 的编辑器外观：常驻工具栏（固定顶栏，分组
// 布局：撤销重做 | 样式 | 字体 | 段落 | 插入 | AI）+ 选区浮动工具栏 +
// AI 菜单 + 斜杠菜单。内容由各内容组件（markdown / docx）自行初始化。
//
// 常驻工具栏的控件需要 BlockNoteView 的 React 上下文，但又要显示在编辑器
// 上方 —— 用 portal 把渲染结果送到视图外的 host 容器里。
import { useState } from "react";
import { createPortal } from "react-dom";
import type { BlockNoteEditor } from "@blocknote/core";
import { filterSuggestionItems } from "@blocknote/core/extensions";
import {
  BasicTextStyleButton,
  BlockTypeSelect,
  ColorStyleButton,
  CreateLinkButton,
  FormattingToolbar,
  FormattingToolbarController,
  getDefaultReactSlashMenuItems,
  NestBlockButton,
  SuggestionMenuController,
  TextAlignButton,
  UnnestBlockButton,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { AIMenuController, AIToolbarButton, getAISlashMenuItems } from "@blocknote/xl-ai";
import "@/docEdit/docEdit.css";
import {
  ClearFormattingButton,
  FontFamilySelect,
  FontSizeSelect,
  InsertPageBreakButton,
  JustifyAlignButton,
  RedoButton,
  RibbonAIButton,
  SubscriptButton,
  SuperscriptButton,
  UndoButton,
} from "@/docEdit/toolbarExtras.js";

function RibbonControls() {
  return (
    <>
      <div className="zp-ribbon-group">
        <UndoButton />
        <RedoButton />
      </div>
      <div className="zp-ribbon-group">
        <BlockTypeSelect />
        <FontFamilySelect />
        <FontSizeSelect />
      </div>
      <div className="zp-ribbon-group">
        <BasicTextStyleButton basicTextStyle="bold" />
        <BasicTextStyleButton basicTextStyle="italic" />
        <BasicTextStyleButton basicTextStyle="underline" />
        <BasicTextStyleButton basicTextStyle="strike" />
        <BasicTextStyleButton basicTextStyle="code" />
        <SubscriptButton />
        <SuperscriptButton />
        <ColorStyleButton />
      </div>
      <div className="zp-ribbon-group">
        <TextAlignButton textAlignment="left" />
        <TextAlignButton textAlignment="center" />
        <TextAlignButton textAlignment="right" />
        <JustifyAlignButton />
        <NestBlockButton />
        <UnnestBlockButton />
      </div>
      <div className="zp-ribbon-group">
        <InsertPageBreakButton />
        <CreateLinkButton />
        <ClearFormattingButton />
      </div>
      <div className="zp-ribbon-group zp-ribbon-group-ai">
        <RibbonAIButton />
      </div>
    </>
  );
}

export function DocEditSurface({
  editor,
  dark,
  onChange,
}: {
  editor: BlockNoteEditor<any, any, any>;
  dark: boolean;
  onChange?: () => void;
}) {
  const [ribbonHost, setRibbonHost] = useState<HTMLDivElement | null>(null);

  return (
    <div className="zp-doc-edit">
      {/* 常驻工具栏宿主：吸顶，位于保存栏之下 */}
      <div ref={setRibbonHost} className="zp-doc-edit-ribbon-host" />
      <BlockNoteView
        editor={editor}
        theme={dark ? "dark" : "light"}
        formattingToolbar={false}
        slashMenu={false}
        onChange={onChange}
      >
        {ribbonHost
          ? createPortal(
              <div className="zp-doc-edit-ribbon flex flex-wrap items-center gap-0.5 rounded-lg border border-border bg-background px-1.5 py-1">
                <RibbonControls />
              </div>,
              ribbonHost,
            )
          : null}
        <AIMenuController />
        <FormattingToolbarController
          formattingToolbar={() => (
            <FormattingToolbar>
              <BlockTypeSelect />
              <FontFamilySelect />
              <FontSizeSelect />
              <BasicTextStyleButton basicTextStyle="bold" />
              <BasicTextStyleButton basicTextStyle="italic" />
              <BasicTextStyleButton basicTextStyle="underline" />
              <BasicTextStyleButton basicTextStyle="strike" />
              <BasicTextStyleButton basicTextStyle="code" />
              <SubscriptButton />
              <SuperscriptButton />
              <TextAlignButton textAlignment="left" />
              <TextAlignButton textAlignment="center" />
              <TextAlignButton textAlignment="right" />
              <JustifyAlignButton />
              <ColorStyleButton />
              <NestBlockButton />
              <UnnestBlockButton />
              <CreateLinkButton />
              <ClearFormattingButton />
              <AIToolbarButton />
            </FormattingToolbar>
          )}
        />
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={async (query) =>
            filterSuggestionItems(
              [...getDefaultReactSlashMenuItems(editor)],
              query,
            ).concat(filterSuggestionItems(getAISlashMenuItems(editor), query))
          }
        />
      </BlockNoteView>
    </div>
  );
}
