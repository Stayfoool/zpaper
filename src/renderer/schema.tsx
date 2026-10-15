// Custom editor schema: everything BlockNote 0.55 ships by default, plus the
// Word/Google-Docs-grade extras zpaper was missing — font family, font size,
// sub/superscript text styles and callout / table-of-contents blocks.
import {
  BlockNoteSchema,
  defaultProps,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
  withPageBreak,
} from "@blocknote/core";
import {
  createReactBlockSpec,
  createReactStyleSpec,
  useEditorChange,
  type ReactCustomBlockRenderProps,
} from "@blocknote/react";
import { useState } from "react";

/* ------------------------------------------------------------------ */
/* Text styles: font family / size, subscript, superscript            */
/* ------------------------------------------------------------------ */

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
    render: (props) => (
      <span ref={props.contentRef} style={{ fontFamily: props.value }} />
    ),
  },
);

export const fontSizeStyle = createReactStyleSpec(
  {
    type: "fontSize",
    propSchema: "string",
    parse: (element: HTMLElement) => element.style.fontSize || undefined,
  },
  {
    render: (props) => (
      <span ref={props.contentRef} style={{ fontSize: props.value }} />
    ),
  },
);

export const subscriptStyle = createReactStyleSpec(
  {
    type: "subscript",
    propSchema: "boolean" as const,
    parse: (element: HTMLElement) =>
      element.tagName === "SUB" || element.style.verticalAlign === "sub"
        ? true
        : undefined,
  },
  {
    render: (props) => (
      <sub ref={props.contentRef} style={{ verticalAlign: "sub" }} />
    ),
  },
);

export const superscriptStyle = createReactStyleSpec(
  {
    type: "superscript",
    propSchema: "boolean" as const,
    parse: (element: HTMLElement) =>
      element.tagName === "SUP" || element.style.verticalAlign === "super"
        ? true
        : undefined,
  },
  {
    render: (props) => (
      <sup ref={props.contentRef} style={{ verticalAlign: "super" }} />
    ),
  },
);

/* ------------------------------------------------------------------ */
/* Callout block（提示块）                                             */
/* ------------------------------------------------------------------ */

export const CALLOUT_TYPES = {
  info: { emoji: "💡", bg: "#e8f1ff", border: "#2f6fed" },
  success: { emoji: "✅", bg: "#e8f6ea", border: "#2f9e44" },
  warning: { emoji: "⚠️", bg: "#fff8e1", border: "#f2a900" },
  error: { emoji: "❌", bg: "#fdecec", border: "#d64541" },
} as const;

type CalloutType = keyof typeof CALLOUT_TYPES;

function CalloutRender(props: any) {
  const type = (props.block.props.type as CalloutType) || "info";
  const preset = CALLOUT_TYPES[type] ?? CALLOUT_TYPES.info;
  const [picking, setPicking] = useState(false);

  const pick = (t: CalloutType) => {
    props.editor.updateBlock(props.block, { props: { type: t } });
    setPicking(false);
  };

  return (
    <div
      className="zp-callout"
      style={{ background: preset.bg, borderLeftColor: preset.border }}
    >
      <span className="zp-callout-wrap">
        <button
          className="zp-callout-emoji"
          contentEditable={false}
          title="点击更换类型"
          onClick={(e) => {
            e.preventDefault();
            setPicking((v) => !v);
          }}
        >
          {preset.emoji}
        </button>
        {picking && (
          <div
            className="zp-callout-picker"
            contentEditable={false}
            onMouseLeave={() => setPicking(false)}
          >
            {(Object.keys(CALLOUT_TYPES) as CalloutType[]).map((t) => (
              <button key={t} title={t} onClick={() => pick(t)}>
                {CALLOUT_TYPES[t].emoji}
              </button>
            ))}
          </div>
        )}
      </span>
      <div className="zp-callout-content" ref={props.contentRef} />
    </div>
  );
}

export const calloutBlock = createReactBlockSpec(
  {
    type: "callout",
    propSchema: {
      type: {
        default: "info",
        values: ["info", "success", "warning", "error"],
      },
      textAlignment: defaultProps.textAlignment,
      textColor: defaultProps.textColor,
    },
    content: "inline",
  },
  {
    render: CalloutRender,
    toExternalHTML: (props: any) => {
      const t = (props.block.props.type as CalloutType) || "info";
      const preset = CALLOUT_TYPES[t] ?? CALLOUT_TYPES.info;
      return (
        <div
          className="zp-callout"
          data-callout={t}
          style={{
            background: preset.bg,
            borderLeft: `4px solid ${preset.border}`,
            padding: "10px 14px",
            borderRadius: 8,
          }}
        >
          <span contentEditable={false}>{preset.emoji} </span>
          <div ref={props.contentRef} />
        </div>
      );
    },
    parse: (element: HTMLElement) => {
      if (element.classList.contains("zp-callout")) {
        const t = element.getAttribute("data-callout") as CalloutType | null;
        return {
          props: { type: t && t in CALLOUT_TYPES ? t : "info" },
        };
      }
      return undefined;
    },
  } as any,
);

/* ------------------------------------------------------------------ */
/* Table of contents block（目录）                                     */
/* ------------------------------------------------------------------ */

function TocRender(props: ReactCustomBlockRenderProps<any>) {
  const { editor } = props;
  const [version, setVersion] = useState(0);
  useEditorChange(() => setVersion((v) => v + 1), editor);

  const headings: { id: string; text: string; level: number }[] = [];
  const walk = (blocks: any[]) => {
    for (const b of blocks) {
      if (b.type === "heading") {
        const text = (b.content ?? [])
          .map((c: any) => c.text ?? "")
          .join("")
          .trim();
        headings.push({ id: b.id, text: text || "无标题", level: b.props.level });
      }
      if (Array.isArray(b.children)) walk(b.children);
    }
  };
  walk(editor.document);

  return (
    <div className="zp-toc" contentEditable={false}>
      <div className="zp-toc-title">目录</div>
      {headings.length === 0 ? (
        <div className="zp-toc-empty">暂无标题，插入「标题」后自动生成</div>
      ) : (
        headings.map((h) => (
          <a
            key={`${h.id}-${version}`}
            className={`zp-toc-item lvl-${h.level}`}
            onClick={(e) => {
              e.preventDefault();
              editor.setTextCursorPosition(h.id, "start");
              const el = editor.domElement?.querySelector(
                `[data-id="${h.id}"]`,
              ) as HTMLElement | null;
              el?.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
          >
            {h.text}
          </a>
        ))
      )}
    </div>
  );
}

export const tableOfContentsBlock = createReactBlockSpec(
  { type: "tableOfContents", propSchema: {}, content: "none" },
  {
    render: TocRender,
    toExternalHTML: () => (
      <div className="zp-toc" data-toc="true" contentEditable={false}>
        <div className="zp-toc-title">目录</div>
        <div className="zp-toc-empty">（目录在 zpaper 中自动生成）</div>
      </div>
    ),
    parse: (element: HTMLElement) =>
      element.getAttribute("data-toc") === "true" ||
      element.classList.contains("zp-toc")
        ? {}
        : undefined,
  } as any,
);

/* ------------------------------------------------------------------ */
/* The schema                                                          */
/* ------------------------------------------------------------------ */

export const zpaperSchema = withPageBreak(
  BlockNoteSchema.create({
    blockSpecs: {
      ...defaultBlockSpecs,
      callout: calloutBlock(),
      tableOfContents: tableOfContentsBlock(),
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
