// 文档编辑 pane 的公共编辑器外观：BlockNote 视图 + AI 菜单 + 格式工具栏 +
// 斜杠菜单。内容由各内容组件（markdown / docx）自行初始化。
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
import {
  ClearFormattingButton,
  FontFamilySelect,
  FontSizeSelect,
  JustifyAlignButton,
  SubscriptButton,
  SuperscriptButton,
} from "@/docEdit/toolbarExtras.js";
import "@/docEdit/docEdit.css";

export function DocEditSurface({
  editor,
  dark,
  onChange,
}: {
  editor: BlockNoteEditor<any, any, any>;
  dark: boolean;
  onChange?: () => void;
}) {
  return (
    <div className="zp-doc-edit">
      <BlockNoteView
      editor={editor}
      theme={dark ? "dark" : "light"}
      formattingToolbar={false}
      slashMenu={false}
      onChange={onChange}
    >
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
