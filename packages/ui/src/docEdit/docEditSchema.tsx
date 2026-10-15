// 文档编辑 pane 的扩展 schema：BlockNote 0.55 默认全量 + Word/Google-Docs
// 级文本样式（字体、字号、上下标）+ 分页块。移植自 zpaper 已验证实现
// （src/renderer/schema.tsx），使编辑 pane 具备 Word 级格式化能力。
import {
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
  withPageBreak,
} from "@blocknote/core";
import { createReactStyleSpec } from "@blocknote/react";

export const FONT_FAMILIES = [
  { name: "默认", value: "" },
  { name: "宋体 SimSun", value: "SimSun, 宋体, serif" },
  { name: "黑体 SimHei", value: "SimHei, 黑体, sans-serif" },
  { name: "楷体 KaiTi", value: "KaiTi, 楷体, serif" },
  { name: "仿宋 FangSong", value: "FangSong, 仿宋, serif" },
  { name: "微软雅黑", value: "'Microsoft YaHei', 微软雅黑, sans-serif" },
  { name: "苹方 PingFang", value: "'PingFang SC', sans-serif" },
  { name: "Arial", value: "Arial, Helvetica, sans-serif" },
  { name: "Times New Roman", value: "'Times New Roman', Times, serif" },
  { name: "Courier New", value: "'Courier New', Courier, monospace" },
  { name: "Georgia", value: "Georgia, serif" },
  { name: "Verdana", value: "Verdana, sans-serif" },
] as const;

export const FONT_SIZES = [
  "10pt", "10.5pt", "11pt", "12pt", "14pt", "16pt", "18pt", "20pt",
  "22pt", "24pt", "26pt", "28pt", "36pt", "48pt", "72pt",
] as const;

export const fontFamilyStyle = createReactStyleSpec(
  {
    type: "fontFamily",
    propSchema: "string",
    parse: (element: HTMLElement) => element.style.fontFamily || undefined,
  },
  {
    render: (props) => <span ref={props.contentRef} style={{ fontFamily: props.value }} />,
  },
);

export const fontSizeStyle = createReactStyleSpec(
  {
    type: "fontSize",
    propSchema: "string",
    parse: (element: HTMLElement) => element.style.fontSize || undefined,
  },
  {
    render: (props) => <span ref={props.contentRef} style={{ fontSize: props.value }} />,
  },
);

export const subscriptStyle = createReactStyleSpec(
  {
    type: "subscript",
    propSchema: "boolean" as const,
    parse: (element: HTMLElement) =>
      element.tagName === "SUB" || element.style.verticalAlign === "sub" ? true : undefined,
  },
  {
    render: (props) => <sub ref={props.contentRef} style={{ verticalAlign: "sub" }} />,
  },
);

export const superscriptStyle = createReactStyleSpec(
  {
    type: "superscript",
    propSchema: "boolean" as const,
    parse: (element: HTMLElement) =>
      element.tagName === "SUP" || element.style.verticalAlign === "super" ? true : undefined,
  },
  {
    render: (props) => <sup ref={props.contentRef} style={{ verticalAlign: "super" }} />,
  },
);

export const docEditSchema = withPageBreak(
  BlockNoteSchema.create({
    blockSpecs: {
      ...defaultBlockSpecs,
    },
    styleSpecs: {
      ...defaultStyleSpecs,
      fontFamily: fontFamilyStyle,
      fontSize: fontSizeStyle,
      subscript: subscriptStyle,
      superscript: superscriptStyle,
    },
    inlineContentSpecs: {
      ...defaultInlineContentSpecs,
    },
  }),
);
