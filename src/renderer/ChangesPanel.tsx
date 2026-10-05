import type { ChangeEntry } from "./useAiChanges";
import { jumpToBlock } from "./useAiChanges";

const STATUS_LABEL: Record<ChangeEntry["status"], { text: string; cls: string }> = {
  reviewing: { text: "审查中", cls: "reviewing" },
  accepted: { text: "已接受", cls: "accepted" },
  reverted: { text: "已恢复", cls: "reverted" },
};

function snippet(s: string, n = 60) {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "…" : t || "（空）";
}

export function ChangesPanel(props: {
  entries: ChangeEntry[];
  onClose: () => void;
  onClear: () => void;
}) {
  return (
    <aside className="changes-panel">
      <div className="changes-head">
        <span>变更记录（{props.entries.length}）</span>
        <span>
          <button className="link" onClick={props.onClear}>
            清空
          </button>
          <button className="link" onClick={props.onClose}>
            收起
          </button>
        </span>
      </div>
      {props.entries.length === 0 && (
        <div className="changes-empty">还没有 AI 修改记录。选中文字 → 点「AI 编辑」试一次。</div>
      )}
      <div className="changes-list">
        {props.entries.map((e) => {
          const st = STATUS_LABEL[e.status];
          return (
            <div
              key={e.id}
              className="change-entry"
              onClick={() => e.jumpToId && jumpToBlock(e.jumpToId)}
              title="点击跳转到修改位置"
            >
              <div className="change-line1">
                <span className={`chip ${st.cls}`}>{st.text}</span>
                <span className="change-time">
                  {new Date(e.time).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              <div className="change-instr">{e.instruction}</div>
              <div className="change-count">涉及 {e.changes.length} 处 · 点击跳转</div>
              {e.changes.slice(0, 2).map((c) => (
                <div key={c.id} className="change-snippet">
                  {c.kind !== "added" && <div className="del">− {snippet(c.before)}</div>}
                  {c.kind !== "removed" && <div className="ins">+ {snippet(c.after)}</div>}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
