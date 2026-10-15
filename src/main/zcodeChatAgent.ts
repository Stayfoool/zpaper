// Chat window answered by a real ZCode agent over the ZCode Protocol — the
// same architecture as the desktop app: zpaper acts as the host, spawns the
// locally installed ZCode CLI's app-server (stdio, line-delimited JSON) and
// drives a persistent read-only plan-mode session. The agent streams tokens
// back over part.delta events and can read the workspace around the document
// ("ZCode 负责读和想").
//
// A standalone app-server has an empty model registry because the desktop
// host normally pushes the account layer. zpaper reproduces the host's three
// responsibilities ("宿主三件套"):
//   1. spawn with ZCODE_BUILTIN_PROVIDER_CONFIG_FILE (endpoint-materialized
//      builtin) + ZCODE_PERSONAL_PROVIDER_CONFIG_FILE;
//   2. provider/updateAccountConfig — the account provider rules + states,
//      reconstructed from the desktop's latest delivery log entry;
//   3. interaction/requestProviderRuntimeHeaders — answered with the active
//      zpaper provider's API key (same channel/key as document editing).
//
// Any failure before the first streamed token (CLI missing, no desktop logs,
// no key configured, provider/billing errors) falls back to the plain
// provider pipeline. ZPAPER_NO_ZCODE_CHAT=1 disables this path entirely.
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { detectZcodeCli, type ZcodeCli } from "./zcodeAgent";
import { loadSettings } from "./settings";

type Json = Record<string, any>;

const REQUEST_TIMEOUT_MS = 30_000;
const TURN_TIMEOUT_MS = 180_000;
const MAX_DOC_CHARS = 30_000;
const MAX_SEED_CHARS = 6_000;
const MAX_SELECTION_CHARS = 4_000;
const ZCODE_V2_DIR = path.join(os.homedir(), ".zcode", "v2");
// preferred model on the account providers (cheap/fast on the coding plans)
const PREFERRED_MODEL_ID = "GLM-5.3-Flash";

type PendingReq = {
  resolve: (v: Json) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
};

type AgentState = {
  cli: ZcodeCli;
  child: ChildProcess;
  nextId: number;
  pending: Map<number, PendingReq>;
  markReady: (() => void) | null;
  accountPushed: boolean;
  sessionId: string | null;
  modelSelection: Json | null;
  // the single in-flight turn (serialized by `chain`)
  turn: { queue: DeltaQueue; timer: NodeJS.Timeout } | null;
};

let state: AgentState | null = null;
let starting: Promise<AgentState | null> | null = null;
let accountPayload: Json | null | undefined; // undefined = not loaded yet
// emitted-text tracker for coalesced part snapshots (key -> full text so far)
const textSeen = new Map<string, string>();
// turns must never overlap within one session
let chain: Promise<unknown> = Promise.resolve();

/** Emits only the suffix of `full` that hasn't been streamed under `key`. */
function pushTextSuffix(queue: DeltaQueue, key: string, full: string) {
  const prev = textSeen.get(key) ?? "";
  if (full.length > prev.length) {
    queue.push(full.slice(prev.length));
    textSeen.set(key, full);
  }
}

// ── async queue bridging protocol events into the SSE response stream ─────
class DeltaQueue {
  private items: string[] = [];
  private closed = false;
  private error: string | null = null;
  private notify: (() => void) | null = null;
  private closeWaiters: (() => void)[] = [];
  private opened = false;

  push(text: string) {
    this.opened = true;
    this.items.push(text);
    const n = this.notify;
    this.notify = null;
    n?.();
  }
  get started() {
    return this.opened;
  }
  close(err: string | null) {
    this.closed = true;
    this.error = err;
    const n = this.notify;
    this.notify = null;
    n?.();
    for (const w of this.closeWaiters.splice(0)) w();
  }
  async *drain(): AsyncGenerator<string | null> {
    for (;;) {
      while (this.items.length) yield this.items.shift()!;
      if (this.closed) {
        yield null;
        return;
      }
      await new Promise<void>((r) => (this.notify = r));
    }
  }
  get errorText() {
    return this.error;
  }
  /** Resolves once close() has been called. */
  waitClosed(): Promise<void> {
    if (this.closed) return Promise.resolve();
    return new Promise((r) => this.closeWaiters.push(r));
  }
}

function sendRaw(s: AgentState, obj: Json) {
  s.child.stdin!.write(JSON.stringify(obj) + "\n");
}

function request(s: AgentState, method: string, params: Json, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Json> {
  return new Promise((resolve, reject) => {
    const id = s.nextId++;
    const timer = setTimeout(() => {
      s.pending.delete(id);
      reject(new Error(`ZCode 请求超时: ${method}`));
    }, timeoutMs);
    s.pending.set(id, { resolve, reject, timer });
    try {
      sendRaw(s, { id, method, params });
    } catch (e) {
      clearTimeout(timer);
      s.pending.delete(id);
      reject(e as Error);
    }
  });
}

/** The api key zpaper answers runtime-header requests with (doc-edit channel). */
function activeApiKey(): string | null {
  const settings = loadSettings();
  const p = (settings.providers || []).find((x: any) => x.id === settings.activeProviderId);
  return p?.apiKey?.trim() ? p.apiKey : null;
}

function handleLine(s: AgentState, line: string) {
  if (!line.trim()) return;
  let msg: Json;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  // responses to our requests
  if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
    const p = s.pending.get(msg.id);
    if (!p) return;
    s.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) {
      const e = msg.error as Json;
      p.reject(new Error(String(e.message ?? JSON.stringify(e)).slice(0, 300)));
    } else p.resolve(msg.result as Json);
    return;
  }
  const method: string | undefined = msg.method;
  if (!method) return;
  // ── reverse requests: the server asks the host — answer in place ──
  if (msg.id !== undefined) {
    let result: Json = {};
    if (method === "session/requestRuntimePreferences") {
      result = {
        nativeSearchEnhancementsEnabled: true,
        memoryEnabled: false,
        askUserQuestionAutoResolutionEnabled: true,
      };
    } else if (method === "interaction/requestUserInput") {
      result = { cancelled: true };
    } else if (method === "interaction/requestPermission") {
      // the chat session is plan-mode and read-only; deny any tool escalation
      result = { decision: "deny", reason: "zpaper 对话窗口只读，不执行工具" };
    } else if (method === "interaction/requestProviderRuntimeHeaders") {
      // host responsibility #3: hand the agent the request auth material
      const apiKey = activeApiKey();
      result = apiKey
        ? { headersApplied: true, requestAuth: { apiKey } }
        : { headersApplied: false, errorMessage: "zpaper 未配置模型 API Key" };
    }
    try {
      sendRaw(s, { id: msg.id, result });
    } catch {
      /* child gone */
    }
    return;
  }
  // startup readiness signal
  if (method === "startup/storageState" && msg.params?.phase === "ready") {
    s.markReady?.();
    return;
  }
  // ── turn events for the active session ──
  const turn = s.turn;
  if (!turn || msg.params?.sessionId !== s.sessionId) return;
  const type = msg.params.type ?? method;
  if (process.env.ZPAPER_DEBUG_CHAT === "1") {
    console.log("[zpaper:chat-ev]", type, JSON.stringify(msg.params?.payload ?? {}).slice(0, 120));
  }
  if (type === "part.delta") {
    const payload = msg.params.payload ?? {};
    // stream assistant text only; reasoning deltas stay hidden
    if (payload.delta && (payload.field === undefined || payload.field === "text")) {
      const key = "p:" + payload.partId;
      textSeen.set(key, (textSeen.get(key) ?? "") + payload.delta);
      turn.queue.push(payload.delta);
    }
  } else if (type === "model.streaming") {
    // the actual token stream in desktop-continuous delivery:
    // {assistantMessageId, delta, kind: "text_delta"|"reasoning_delta"|..., done}
    const p = msg.params.payload ?? {};
    if (p.delta && (p.kind === undefined || p.kind === "text_delta")) {
      turn.queue.push(p.delta);
    }
  } else if (type === "part.upserted" || type === "part.started") {
    // coalesced delivery: the part snapshot carries the full text so far —
    // emit only the newly appended suffix
    const part = msg.params.payload?.part;
    if (part?.type === "text" && typeof part.text === "string") {
      pushTextSuffix(turn.queue, "p:" + part.partId, part.text);
    }
  } else if (type === "turn.completed") {
    clearTimeout(turn.timer);
    s.turn = null;
    turn.queue.close(null);
  } else if (type === "turn.failed") {
    const e = msg.params.payload?.error;
    clearTimeout(turn.timer);
    s.turn = null;
    turn.queue.close(String(e?.message || e?.code || "ZCode agent 执行失败"));
  }
}

/** Newest endpoint-materialized builtin provider config on this machine. */
function findBuiltinConfigFile(): string | null {
  const runtimeDir = path.join(ZCODE_V2_DIR, "runtime", "provider");
  try {
    const candidates: { file: string; mtime: number }[] = [];
    for (const arch of fs.readdirSync(runtimeDir)) {
      for (const ver of fs.readdirSync(path.join(runtimeDir, arch))) {
        const verDir = path.join(runtimeDir, arch, ver);
        for (const ep of fs.readdirSync(verDir)) {
          const file = path.join(verDir, ep, "zcode-builtin.json");
          try {
            candidates.push({ file, mtime: fs.statSync(file).mtimeMs });
          } catch {
            /* not a config dir */
          }
        }
      }
    }
    candidates.sort((a, b) => b.mtime - a.mtime);
    if (candidates[0]) return candidates[0].file;
  } catch {
    /* fall through */
  }
  const bundled = "/Applications/ZCode.app/Contents/Resources/config/provider/zcode-builtin.json";
  return fs.existsSync(bundled) ? bundled : null;
}

/**
 * Host responsibility #1: provider config file paths. The builtin file is the
 * endpoint-materialized active copy the desktop keeps under ~/.zcode/v2.
 */
function agentSpawnEnv(cli: ZcodeCli): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv =
    cli.kind === "bundle" ? { ...process.env, ELECTRON_RUN_AS_NODE: "1" } : { ...process.env };
  const builtin = findBuiltinConfigFile();
  const personal = process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE?.trim()
    || path.join(ZCODE_V2_DIR, "provider_config.json");
  if (builtin && fs.existsSync(builtin)) {
    env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE = builtin;
    env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE = personal;
  }
  return env;
}

/**
 * Host responsibility #2: the account layer. A standalone app-server's model
 * registry is empty because the desktop host pushes account provider config
 * over the protocol. We reconstruct the latest delivery from the desktop's
 * own logs (provider rules + entitlement states) and replay it.
 */
function loadAccountPayload(): Json {
  if (accountPayload !== undefined) return accountPayload;
  accountPayload = null;
  try {
    const logDir = path.join(ZCODE_V2_DIR, "logs");
    const files = fs
      .readdirSync(logDir)
      .filter((f) => f.endsWith(".log"))
      .sort()
      .reverse();
    for (const f of files) {
      const lines = fs.readFileSync(path.join(logDir, f), "utf8").split("\n");
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (!line.includes("account provider config 已交付")) continue;
        const key = 'receivedRevision":"';
        const start = line.indexOf(key);
        if (start < 0) continue;
        const from = start + key.length;
        const end = line.indexOf('","status":"received"', from);
        if (end < 0) continue;
        const revision = line.slice(from, end).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
        const [builtinTag, rules, states] = JSON.parse(revision.replace(/^account:/, ""));
        accountPayload = {
          revision,
          basedOnZCodeBuiltinRevision: builtinTag,
          providers: Object.fromEntries(rules.map((r: any) => [r.providerId, r.config])),
          states,
        };
        return accountPayload;
      }
    }
  } catch {
    /* no logs / unreadable — treated as unavailable below */
  }
  return accountPayload!;
}

function pickModelSelection(snapshot: Json | null): Json | null {
  const available: any[] = snapshot?.settings?.model?.available ?? [];
  if (!available.length) return null;
  const entry =
    available.find((m) => m.ref?.modelId === PREFERRED_MODEL_ID) ??
    available.find((m) => m.ref?.providerId?.startsWith("account:")) ??
    available[0];
  const levels: string[] | undefined = entry.reasoning?.levels?.map((l: any) => l.value);
  const reasoning = levels?.length
    ? levels.includes("low")
      ? "low"
      : entry.reasoning.defaultLevel
    : undefined;
  const selection: Json = {
    providerId: entry.ref.providerId,
    modelId: entry.ref.modelId,
  };
  if (reasoning) selection.options = { reasoningLevel: reasoning };
  return selection;
}

function spawnAgent(cli: ZcodeCli): Promise<AgentState> {
  return new Promise((resolve, reject) => {
    const child = spawn(cli.command, [...cli.args, "app-server", "--stdio"], {
      env: agentSpawnEnv(cli),
      stdio: ["pipe", "pipe", "pipe"],
    });
    const s: AgentState = {
      cli,
      child,
      nextId: 1,
      pending: new Map(),
      markReady: null,
      accountPushed: false,
      sessionId: null,
      modelSelection: null,
      turn: null,
    };
    let buf = "";
    child.stdout!.on("data", (d: Buffer) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        try {
          handleLine(s, line);
        } catch {
          /* never let one bad frame kill the pump */
        }
      }
    });
    child.stderr!.on("data", () => {
      /* diagnostics only; app-server is quiet on stderr */
    });
    child.on("error", reject);
    child.on("exit", () => {
      const err = new Error("ZCode app-server 进程退出");
      for (const p of s.pending.values()) {
        clearTimeout(p.timer);
        p.reject(err);
      }
      s.pending.clear();
      if (s.turn) {
        clearTimeout(s.turn.timer);
        s.turn.queue.close("ZCode agent 进程退出");
        s.turn = null;
      }
      if (state === s) state = null;
    });
    // ready = storage bootstrapped (or a generous fallback so a missing
    // notification can never wedge the first message)
    const t = setTimeout(() => s.markReady?.(), 10_000);
    void t;
    s.markReady = () => {
      s.markReady = null;
      resolve(s);
    };
  });
}

async function ensureAgent(): Promise<AgentState | null> {
  if (state) return state;
  if (!starting) {
    starting = (async () => {
      const cli = detectZcodeCli();
      if (!cli) return null;
      try {
        state = await spawnAgent(cli);
        return state;
      } catch (e) {
        console.warn("[zpaper] chat-window: ZCode agent spawn failed:", String(e).slice(0, 150));
        return null;
      }
    })();
    starting.finally(() => {
      starting = null;
    });
  }
  return starting;
}

async function ensureSession(s: AgentState, workspacePath: string): Promise<void> {
  if (s.sessionId) return;
  // host responsibility #2: push the account layer before creating a session
  if (!s.accountPushed) {
    const payload = loadAccountPayload();
    if (!payload) throw new Error("未找到桌面端的账号配置交付记录（无法点亮模型注册表）");
    const r = await request(s, "provider/updateAccountConfig", payload);
    s.accountPushed = true;
    console.log(`[zpaper] chat-window: account config delivered (providers: ${r?.providerCount})`);
  }
  const created = await request(s, "session/create", {
    workspace: { workspacePath, workspaceKey: workspacePath },
    mode: "plan", // the chat window reads and reasons; edits happen in the editor flow
    persistence: "immediate",
  });
  const sessionId = created?.session?.sessionId ?? created?.sessionId;
  if (!sessionId) throw new Error("session/create 未返回 sessionId");
  const sub = await request(s, "session/subscribe", {
    sessionId,
    deliveryKind: "desktop-continuous",
    includeSnapshot: true,
  });
  s.sessionId = sessionId;
  s.modelSelection = pickModelSelection(sub?.snapshot ?? null);
  if (!s.modelSelection) throw new Error("模型注册表为空（账号配置不可用）");
  console.log(
    `[zpaper] chat-window: model ${s.modelSelection.providerId}/${s.modelSelection.modelId}` +
      `(reasoning: ${s.modelSelection.options?.reasoningLevel ?? "default"})`,
  );
}

function resolveWorkspace(context: any): string {
  const candidates: string[] = [context?.docDir, loadSettings()?.workspace?.path].filter(
    (x): x is string => typeof x === "string" && x.length > 0,
  );
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isDirectory()) return c;
    } catch {
      /* try next */
    }
  }
  return os.homedir();
}

function buildContent(body: any, freshSession: boolean): string {
  const messages: any[] = Array.isArray(body?.messages) ? body.messages : [];
  const context = body?.context ?? {};
  const lastUser = [...messages].reverse().find((m: any) => m.role === "user");
  const question = (lastUser?.parts ?? [])
    .filter((p: any) => p.type === "text")
    .map((p: any) => p.text)
    .join("\n");

  const docMd = String(context.docMarkdown || "").trim();
  const docBlock = docMd
    ? `【当前文档：${context.docTitle || "未命名"}】${docMd.length > MAX_DOC_CHARS ? "（内容过长，仅保留前一部分）" : ""}\n${docMd.slice(0, MAX_DOC_CHARS)}`
    : "【当前文档】（未打开文档或内容为空）";
  // the user's live selection in the editor — questions usually refer to it
  const sel = String(context.docSelection || "").trim();
  const selBlock = sel ? `\n\n【用户当前选中的文档片段】\n${sel.slice(0, MAX_SELECTION_CHARS)}` : "";

  // a fresh agent session (app restart / respawn) has no server-side history;
  // carry the visible transcript over once so it can pick up mid-conversation
  let seed = "";
  if (freshSession && messages.length > 1) {
    const lines = messages
      .slice(0, -1)
      .map((m: any) => {
        const who = m.role === "user" ? "用户" : "AI";
        const t = (m.parts ?? [])
          .filter((p: any) => p.type === "text")
          .map((p: any) => p.text)
          .join(" ");
        return t ? `${who}：${t}` : "";
      })
      .filter(Boolean)
      .join("\n\n");
    if (lines) seed = `【此前对话记录（供你了解上下文）】\n${lines.slice(-MAX_SEED_CHARS)}\n【记录结束】\n\n`;
  }
  return `${seed}${docBlock}${selBlock}\n\n用户说：${question}`;
}

function stopTurn(s: AgentState) {
  if (s.sessionId) {
    // best-effort cancel of the running turn
    request(s, "session/stop", { sessionId: s.sessionId }).catch(() => {});
  }
}

/** Runs one turn; resolves true once text streams, false on pre-output failure. */
function runTurn(s: AgentState, workspace: string, body: any, queue: DeltaQueue): Promise<boolean> {
  return (async () => {
    const wasFresh = !s.sessionId;
    await ensureSession(s, workspace);
    if (!s.modelSelection) throw new Error("无可用模型");
    const content = buildContent(body, wasFresh);
    textSeen.clear();
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        if (s.turn) {
          s.turn = null;
          queue.close("ZCode agent 回合超时");
          stopTurn(s);
        }
      }, TURN_TIMEOUT_MS);
      s.turn = { queue, timer };
      // send rejection closes the queue; completion/failure events close it
      // from the event pump — either way waitClosed() fires the resolution
      request(s, "session/send", { sessionId: s.sessionId, content, modelSelection: s.modelSelection }).catch(
        (e) => {
          if (s.turn) {
            clearTimeout(timer);
            s.turn = null;
            queue.close(String((e as Error).message || e));
          }
        },
      );
      void queue.waitClosed().then(() => {
        clearTimeout(timer);
        if (s.turn) s.turn = null;
        resolve(queue.started);
      });
    });
  })();
}

function uiStreamResponse(opts: {
  tag: string;
  body: any;
  /** resolves once the turn either streamed its first token or failed silently */
  attempt: () => Promise<{ committed: true; queue: DeltaQueue } | { committed: false }>;
  fallback: (body: any) => Promise<Response>;
}): Response {
  const enc = new TextEncoder();
  let interrupted = false;
  const stream = new ReadableStream({
    async start(controller) {
      const push = (chunk: Json) => {
        if (!interrupted) controller.enqueue(enc.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      };
      try {
        const r = await opts.attempt();
        if (r.committed) {
          push({ type: "start" });
          push({ type: "start-step" });
          const textId = "zc1";
          let opened = false;
          let any = false;
          for await (const delta of r.queue.drain()) {
            if (interrupted) break;
            if (delta === null) break;
            if (!opened) {
              push({ type: "text-start", id: textId });
              opened = true;
            }
            any = true;
            push({ type: "text-delta", id: textId, delta });
          }
          if (opened) push({ type: "text-end", id: textId });
          const err = r.queue.errorText;
          if (err) {
            if (any) push({ type: "text-delta", id: textId, delta: `\n\n（ZCode agent 出错：${err}）` });
            else push({ type: "error", errorText: err });
          }
          push({ type: "finish-step" });
          push({ type: "finish", finishReason: "stop" });
          controller.enqueue(enc.encode("data: [DONE]\n\n"));
        } else {
          // the agent failed (or is unusable) before any output — pipe the
          // provider pipeline's own UI stream through this one unchanged
          const fb = await opts.fallback(opts.body);
          if (fb.body) {
            await fb.body.pipeTo(
              new WritableStream({ write: (c) => !interrupted && controller.enqueue(c) }),
              { preventCancel: true },
            );
          }
        }
      } catch (e) {
        push({ type: "error", errorText: String((e as Error).message || e).slice(0, 200) });
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
      }
      controller.close();
    },
    cancel() {
      interrupted = true;
      if (state?.turn) {
        clearTimeout(state.turn.timer);
        state.turn = null;
        stopTurn(state);
      }
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-vercel-ai-ui-message-stream": "v1",
      "x-accel-buffering": "no",
      "x-zpaper-agent": opts.tag,
    },
  });
}

export async function handleZcodeChatWindow(
  req: Request,
  fallback: (body: any) => Promise<Response>,
): Promise<Response> {
  let body: any;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  if (!detectZcodeCli()) return fallback(body);

  const queue = new DeltaQueue();
  // NOTE: the Response must be returned immediately — Electron's protocol
  // layer fails requests whose handler stays pending (net::ERR_FAILED). The
  // attempt/fallback decision therefore happens inside the stream: the SSE
  // stays silent until the agent's first token, and a pre-output failure
  // pipes the provider pipeline's stream through unchanged.
  return uiStreamResponse({
    tag: "zcode",
    body,
    attempt: async () => {
      const s = await ensureAgent();
      if (!s) return { committed: false };
      const workspace = resolveWorkspace(body?.context);
      let started = false;
      const task = () => runTurn(s, workspace, body, queue).then((v) => (started = v));
      await chain.then(task, task);
      console.log(
        started
          ? "[zpaper] chat-window: serving via ZCode agent (app-server)"
          : `[zpaper] chat-window: ZCode turn failed early — ${(queue.errorText || "unknown").slice(0, 160)} — falling back to provider pipeline`,
      );
      return started ? { committed: true, queue } : { committed: false };
    },
    fallback,
  });
}

export function disposeZcodeChatAgent() {
  if (state) {
    state.child.kill("SIGTERM");
    state = null;
  }
  starting = null;
}
