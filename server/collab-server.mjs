// zpaper collaboration server — a tiny y-websocket compatible server.
// Run:  node server/collab-server.mjs   (PORT=1234 by default)
// Then in zpaper: 协作 → 服务器 ws://<这台机器的IP>:1234 → 加入房间。
import * as fs from "node:fs";
import * as path from "node:path";
import * as http from "node:http";
import { WebSocketServer } from "ws";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";

const PORT = Number(process.env.PORT || 1234);
const PERSIST_DIR = process.env.ZPAPER_COLLAB_DIR || path.join(process.env.HOME || ".", ".zpaper-collab");

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

const wsReadyState = { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 };

/** rooms by name */
const rooms = new Map();

class Room {
  constructor(name) {
    this.name = name;
    this.doc = new Y.Doc();
    this.conns = new Map(); // conn -> Set of controlled awareness clientIds
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.awareness.setLocalState(null);
    this.doc.on("update", (update, origin) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      this.broadcast(encoding.toUint8Array(encoder), /* filtered */ null);
      this.persist();
    });
    this.awareness.on("update", ({ added, updated, removed }, origin) => {
      const changed = added.concat(updated, removed);
      if (origin !== this.awareness.local) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed));
        this.broadcast(encoding.toUint8Array(encoder), /* except */ null);
      }
    });
    // debounce-persist to disk so documents survive server restarts
    this.persistTimer = null;
  }

  persist() {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      try {
        fs.mkdirSync(PERSIST_DIR, { recursive: true });
        const safe = this.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        fs.writeFileSync(path.join(PERSIST_DIR, `${safe}.ydoc`), Y.encodeStateAsUpdate(this.doc));
      } catch (e) {
        console.error("[collab] persist failed:", e.message);
      }
    }, 2000);
  }

  broadcast(message, exceptConn) {
    for (const [conn] of this.conns) {
      if (conn !== exceptConn && conn.readyState === wsReadyState.OPEN) {
        conn.send(message, {}, (err) => {
          if (err) this.closeConn(conn);
        });
      }
    }
  }

  closeConn(conn) {
    const controlled = this.conns.get(conn);
    if (controlled) {
      awarenessProtocol.removeAwarenessStates(this.awareness, [...controlled], null);
      this.conns.delete(conn);
    }
  }
}

function getRoom(name) {
  let room = rooms.get(name);
  if (!room) {
    room = new Room(name);
    rooms.set(name, room);
    // restore persisted state if any
    const safe = name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const file = path.join(PERSIST_DIR, `${safe}.ydoc`);
    if (fs.existsSync(file)) {
      try {
        Y.applyUpdate(room.doc, new Uint8Array(fs.readFileSync(file)));
        console.log(`[collab] room "${name}" restored from disk`);
      } catch (e) {
        console.error("[collab] restore failed:", e.message);
      }
    }
    console.log(`[collab] room "${name}" created`);
  }
  return room;
}

function messageListener(room, conn) {
  return (data, isBinary) => {
    if (isBinary) return;
    const message = new Uint8Array(data);
    const decoder = decoding.createDecoder(message);
    const messageType = decoding.readVarUint(decoder);
    switch (messageType) {
      case MESSAGE_SYNC: {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, room.doc, conn);
        if (encoding.length(encoder) > 1) conn.send(encoding.toUint8Array(encoder));
        break;
      }
      case MESSAGE_AWARENESS: {
        awarenessProtocol.applyAwarenessUpdate(room.awareness, decoding.readVarUint8Array(decoder), conn);
        break;
      }
    }
  };
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("zpaper collab server is running\n");
});

const wss = new WebSocketServer({ server });
wss.on("connection", (conn, req) => {
  // room name = the path part of the ws url: ws://host:port/<room>
  const roomName = decodeURIComponent((req.url || "/default").slice(1).split("?")[0]) || "default";
  const room = getRoom(roomName);
  room.conns.set(conn, new Set());
  conn.binaryType = "arraybuffer";

  // initial sync: state vector exchange
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(encoder, room.doc);
  conn.send(encoding.toUint8Array(encoder));
  // current awareness states
  const awEncoder = encoding.createEncoder();
  encoding.writeVarUint(awEncoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(
    awEncoder,
    awarenessProtocol.encodeAwarenessUpdate(room.awareness, [...room.awareness.getStates().keys()]),
  );
  conn.send(encoding.toUint8Array(awEncoder));

  const listener = messageListener(room, conn);
  conn.on("message", listener);
  conn.on("close", () => room.closeConn(conn));
});

server.listen(PORT, () => {
  console.log(`zpaper collab server listening on ws://0.0.0.0:${PORT}/<房间名>`);
  console.log(`documents persisted under ${PERSIST_DIR}`);
});
