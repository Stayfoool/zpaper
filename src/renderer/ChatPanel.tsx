// ZCode-style conversation sidebar. Free-form multi-turn chat with the
// document attached as read-only context. Two document bridges: the editor's
// live selection is quoted into the input (「选区」chip), and any reply can be
// turned into concrete, undoable document edits via「应用到文档」.
import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { CHAT_WINDOW_API } from "./bridge";
import { requestDocEditPlan, type ApplyResult } from "./docOps";
import type { DocEditPlan } from "../shared/docEdits";

const STORAGE_KEY = "zpaper:chat:messages:v1";

export type DocContext = { docTitle: string; docMarkdown: string; docDir?: string };

type Props = {
  onClose: () => void;
  providerLabel: string;
  getDocContext: () => Promise<DocContext>;
  /** live editor selection text ("" when nothing is selected) */
  getSelection: () => string;
  /** applies a plan to the editor; changes are visible + undoable in place */
  applyEdits: (plan: DocEditPlan) => ApplyResult;
  onStatus?: (status: string) => void;
};

function loadInitialMessages(): any[] {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

export function ChatPanel({ onClose, providerLabel, getDocContext, getSelection, applyEdits, onStatus }: Props) {
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: CHAT_WINDOW_API,
        prepareSendMessagesRequest: async ({ messages }) => ({
          body: {
            messages,
            context: {
              ...(await getDocContext()),
              docSelection: quoteRef.current.text && !quoteRef.current.dismissed ? quoteRef.current.text : undefined,
            },
          },
        }),
      }),
    [getDocContext],
  );
  const chat = useChat({
    transport,
    messages: loadInitialMessages(),
    onFinish: ({ messages: done }) =>
      localStorage.setItem(STORAGE_KEY, JSON.stringify(done.slice(-100))),
    onError: (e) => console.error("[zpaper] chat:", e?.message || e),
  });
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);

  // ── selection quote chip ────────────────────────────────────────────────
  // The editor lives outside React, so poll (same pattern as useAiChanges);
  // dismissed = user hid the chip or the quote was consumed by a send.
  const [quote, setQuote] = useState<{ text: string; dismissed: boolean }>({ text: "", dismissed: false });
  const quoteRef = useRef(quote);
  quoteRef.current = quote;
  useEffect(() => {
    const t = setInterval(() => {
      const text = (getSelection() || "").trim();
      setQuote((q) => {
        if (text === q.text) return q.text && q.dismissed ? q : q.text || text ? { text, dismissed: false } : q;
        return { text, dismissed: false };
      });
    }, 400);
    return () => clearInterval(t);
  }, [getSelection]);
  const activeQuote = quote.text && !quote.dismissed ? quote.text : "";

  // stick to the bottom while streaming
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages]);

  const persist = (msgs: any[]) => localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs.slice(-100)));

  const send = () => {
    const text = input.trim();
    if (!text || chat.status === "submitted" || chat.status === "streaming") return;
    setInput("");
    // consume the quote: it rode along with this message
    setQuote((q) => ({ ...q, dismissed: true }));
    chat.sendMessage({ text });
  };

  // ── chat reply -> document edits ────────────────────────────────────────
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const msgText = (m: any) =>
    (m.parts ?? [])
      .filter((p: any) => p.type === "text" && p.text)
      .map((p: any) => p.text)
      .join("\n")
      .trim();

  const applyFromChat = async (assistantMsg: any) => {
    if (applyingId) return;
    const idx = chat.messages.findIndex((x: any) => x.id === assistantMsg.id);
    const lastUser = [...chat.messages.slice(0, idx < 0 ? chat.messages.length : idx)]
      .reverse()
      .find((m: any) => m.role === "user");
    const instruction = msgText(lastUser);
    const proposal = msgText(assistantMsg);
    if (!instruction && !proposal) return;
    setApplyingId(assistantMsg.id);
    onStatus?.("正在生成文档修改方案…");
    try {
      const ctx = await getDocContext();
      const sel = quoteRef.current.text && !quoteRef.current.dismissed ? quoteRef.current.text : undefined;
      const plan = await requestDocEditPlan({
        instruction: instruction || proposal.slice(0, 500),
        proposal,
        docTitle: ctx.docTitle,
        docMarkdown: ctx.docMarkdown,
        docSelection: sel,
      });
      if (!plan.ops.length) {
        onStatus?.("这轮回复没有可执行的文档修改");
        return;
      }
      const { applied, failed } = applyEdits(plan);
      onStatus?.(
        failed === 0
          ? `已按「${(plan.explanation || instruction).slice(0, 24)}…」修改文档（${applied} 处，Ctrl+Z 可撤销）；保存时将写成 Word 修订`
          : `已应用 ${applied} 处修改，${failed} 处未匹配到原文（Ctrl+Z 可撤销）`,
      );
    } catch (e: any) {
      onStatus?.(`应用失败：${String(e?.message || e).slice(0, 120)}`);
    } finally {
      setApplyingId(null);
    }
  };

  const busy = chat.status === "submitted" || chat.status === "streaming";
  const empty = chat.messages.length === 0;

  return (
    <div className="chat-panel">
      <div className="chat-head">
        <span className="chat-title">
          AI 对话
          <span className="chat-provider" title="对话与文档编辑共用同一模型配置">
            {providerLabel}
          </span>
        </span>
        <span className="chat-head-actions">
          {!empty && (
            <button
              className="link"
              onClick={() => {
                chat.setMessages([]);
                persist([]);
              }}
            >
              清空
            </button>
          )}
          <button className="link" onClick={onClose}>
            关闭
          </button>
        </span>
      </div>

      <div className="chat-body" ref={listRef}>
        {empty && (
          <div className="chat-welcome">
            <p className="chat-welcome-title">和 AI 聊聊这份文档</p>
            <p>我会读到当前打开的文档内容，可以总结、解读、追问、给建议。</p>
            <p className="chat-welcome-dim">
              选中文字后发消息，我会围绕选区回答；讨论出结论后点回复下方的
              「应用到文档」，修改会直接写进文档（可撤销，保存 .docx 时写成 Word 修订）。
            </p>
          </div>
        )}
        {chat.messages.map((m) => (
          <div key={m.id} className={"chat-msg " + (m.role === "user" ? "user" : "assistant")}>
            <div className="chat-role">{m.role === "user" ? "我" : "AI"}</div>
            <div className="chat-content">
              {m.parts
                .filter((p: any) => p.type === "text" && p.text)
                .map((p: any, i: number) => (
                  <Markdown key={i} text={p.text} />
                ))}
            </div>
            {m.role === "assistant" && msgText(m) && (
              <div className="chat-msg-actions">
                <button
                  className="link"
                  disabled={!!applyingId || busy}
                  onClick={() => void applyFromChat(m)}
                  title="把这轮讨论转成结构化修改并写进文档（可撤销）"
                >
                  {applyingId === m.id ? "正在生成修改方案…" : "⤵ 应用到文档"}
                </button>
              </div>
            )}
          </div>
        ))}
        {chat.status === "submitted" && <div className="chat-thinking">正在思考…</div>}
        {chat.error && (
          <div className="chat-error">请求失败：{String((chat.error as any)?.message || chat.error)}</div>
        )}
      </div>

      <div className="chat-input">
        {activeQuote && (
          <div className="chat-quote" title={activeQuote}>
            <span className="chat-quote-label">选区</span>
            <span className="chat-quote-text">{activeQuote.slice(0, 60)}{activeQuote.length > 60 ? "…" : ""}</span>
            <button
              className="chat-quote-close"
              onClick={() => setQuote((q) => ({ ...q, dismissed: true }))}
              title="本条消息不引用选区"
            >
              ×
            </button>
          </div>
        )}
        <div className="chat-input-row">
          <textarea
            value={input}
            rows={3}
            placeholder="问点什么…（Enter 发送，Shift+Enter 换行）"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
          />
          {busy ? (
            <button className="chat-stop" onClick={() => chat.stop()}>
              停止
            </button>
          ) : (
            <button className="chat-send" onClick={send} disabled={!input.trim()}>
              发送
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── minimal safe markdown renderer ────────────────────────────────────────
// Builds React elements directly (no HTML injection): headings, lists, code
// fences, blockquotes, hr and inline bold/italic/code/strike/link.
export function Markdown({ text }: { text: string }) {
  return <>{parseBlocks(text)}</>;
}

function parseBlocks(src: string): any[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: any[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      const lang = line.replace(/^\s*```/, "").trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
      i++; // closing fence
      out.push(
        <pre className="md-pre" key={key++}>
          {lang && <span className="md-lang">{lang}</span>}
          <code>{buf.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) {
      const Tag = `h${h[1].length + 2}` as any; // h3..h6, keep panel hierarchy flat
      out.push(<Tag key={key++}>{parseInline(h[2])}</Tag>);
      i++;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      out.push(<hr key={key++} />);
      i++;
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push(<blockquote key={key++}>{parseBlocks(buf.join("\n"))}</blockquote>);
      continue;
    }
    const ul = /^\s*[-*+]\s+/;
    const ol = /^\s*\d+[.)]\s+/;
    if (ul.test(line) || ol.test(line)) {
      const ordered = ol.test(line);
      const items: string[] = [];
      const re = ordered ? ol : ul;
      while (i < lines.length && re.test(lines[i])) items.push(lines[i++].replace(re, ""));
      const L = ordered ? "ol" : "ul";
      out.push(
        <L key={key++}>
          {items.map((t, n) => (
            <li key={n}>{parseInline(t)}</li>
          ))}
        </L>,
      );
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    // paragraph: consecutive non-empty, non-special lines
    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*```/.test(lines[i]) &&
      !/^(#{1,4})\s/.test(lines[i]) &&
      !ul.test(lines[i]) &&
      !ol.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i])
    ) {
      buf.push(lines[i++]);
    }
    out.push(<p key={key++}>{parseInline(buf.join("\n"))}</p>);
  }
  return out;
}

const INLINE_RE =
  /(`[^`]+`)|(\*\*\*[^*]+\*\*\*)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(~~[^~]+~~)|(\[[^\]]+\]\((https?:\/\/[^)\s]+|#[^)\s]*)\))/g;

function parseInline(text: string): any[] {
  const out: any[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("`")) out.push(<code key={key++}>{t.slice(1, -1)}</code>);
    else if (t.startsWith("***")) out.push(<strong key={key++}><em>{t.slice(3, -3)}</em></strong>);
    else if (t.startsWith("**")) out.push(<strong key={key++}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("~~")) out.push(<del key={key++}>{t.slice(2, -2)}</del>);
    else if (t.startsWith("*")) out.push(<em key={key++}>{t.slice(1, -1)}</em>);
    else {
      const label = t.slice(1, t.indexOf("]"));
      const href = t.slice(t.indexOf("(") + 1, -1);
      out.push(
        <a key={key++} href={href} target="_blank" rel="noreferrer noopener">
          {label}
        </a>,
      );
    }
    last = m.index! + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
