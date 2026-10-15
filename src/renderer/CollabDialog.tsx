import { useEffect, useState } from "react";

export type CollabConfig = { server: string; room: string; name: string; color: string };

const KEY = "zpaper:collab";

export function loadCollab(): CollabConfig | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "") as CollabConfig;
  } catch {
    return null;
  }
}

export function saveCollab(cfg: CollabConfig | null) {
  if (cfg) localStorage.setItem(KEY, JSON.stringify(cfg));
  else localStorage.removeItem(KEY);
}

const COLORS = ["#4f8ef7", "#e8a13a", "#2fa86e", "#c2549a", "#8460d6", "#d65454"];

function randomName() {
  return "用户" + Math.floor(1000 + Math.random() * 9000);
}

export function CollabDialog(props: {
  current: CollabConfig | null;
  onClose: () => void;
}) {
  const [server, setServer] = useState(props.current?.server || "ws://localhost:1234");
  const [room, setRoom] = useState(props.current?.room || "main");
  const [name, setName] = useState(props.current?.name || randomName());
  const [color] = useState(() => COLORS[Math.floor(Math.random() * COLORS.length)]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [props]);

  const join = () => {
    if (!server || !room) return;
    saveCollab({ server, room, name, color });
    window.location.reload(); // collaboration is set up at editor creation
  };

  const leave = () => {
    saveCollab(null);
    window.location.reload();
  };

  return (
    <div className="modal-overlay" onClick={props.onClose}>
      <div className="modal" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
        <h2>多人协作（实验性）</h2>
        <p className="hint">
          加入同一「协作服务器 + 房间」的人实时共编同一份文档，可见彼此光标。
          需要一台协作服务器：zpaper 仓库自带 <code>node server/collab-server.mjs</code>（默认端口 1234，文档自动落盘）。
          {props.current && (
            <>
              <br />
              当前已加入房间 <b>{props.current.room}</b>。
            </>
          )}
        </p>
        <div className="provider-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <label>
            服务器
            <input value={server} onChange={(e) => setServer(e.target.value)} placeholder="ws://localhost:1234" />
          </label>
          <label>
            房间
            <input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="main" />
          </label>
          <label>
            你的名字
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        </div>
        <div className="modal-foot">
          {props.current && (
            <button className="danger" onClick={leave}>
              断开并退出协作
            </button>
          )}
          <button onClick={props.onClose}>取消</button>
          <button className="primary" onClick={join}>
            {props.current ? "重新加入" : "加入协作"}
          </button>
        </div>
      </div>
    </div>
  );
}
