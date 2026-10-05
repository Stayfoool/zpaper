// Integration with the locally installed ZCode CLI (headless mode).
// Used as the "research" phase of agent mode: the agent reads the user's
// workspace (read-only, --mode plan) and returns a context digest which is
// injected into the document-editing request.
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const CANDIDATES = [
  "/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs",
  "/opt/ZCode.app/Contents/Resources/glm/zcode.cjs",
];

export type ZcodeCli = { kind: "bundle" | "path"; command: string; args: string[] };

export function detectZcodeCli(): ZcodeCli | null {
  // test/CI override: point at a stub CLI to exercise the pipeline
  const envCli = process.env.ZPAPER_ZCODE_CLI;
  if (envCli && fs.existsSync(envCli)) {
    return { kind: "bundle", command: process.execPath, args: [envCli] };
  }
  for (const p of CANDIDATES) {
    if (fs.existsSync(p)) return { kind: "bundle", command: process.execPath, args: [p] };
  }
  const onPath = [
    "/usr/local/bin/zcode",
    "/opt/homebrew/bin/zcode",
    path.join(process.env.HOME || "", ".local/bin/zcode"),
  ].find((p) => fs.existsSync(p));
  if (onPath) return { kind: "path", command: onPath, args: [] };
  return null;
}

export type AgentResult = { ok: boolean; output: string; ms: number };

/** Run one headless ZCode prompt (read-only plan mode) and capture stdout. */
export function runAgent(opts: {
  cli: ZcodeCli;
  cwd: string;
  prompt: string;
  timeoutMs?: number;
  files?: string[];
}): Promise<AgentResult> {
  const { cli, cwd, prompt, timeoutMs = 180_000, files = [] } = opts;
  const args = [...cli.args, "-p", prompt, "--cwd", cwd, "--mode", "plan"];
  for (const f of files) args.push("--attach", f);
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(cli.command, args, {
      cwd,
      env:
        cli.kind === "bundle"
          ? // the "command" is the Electron binary — run it as plain Node
            { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
          : process.env,
    });
    let out = "";
    let err = "";
    let done = false;
    const finish = (ok: boolean, output: string) => {
      if (done) return;
      done = true;
      clearTimeout(killer);
      resolve({ ok, output: output.trim().slice(0, 8000), ms: Date.now() - started });
    };
    const killer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(false, "ZCode agent timed out");
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => finish(false, String(e)));
    child.on("exit", (code) => {
      if (code === 0 && out.trim()) finish(true, out);
      else finish(false, (err || out || `exit ${code}`).slice(0, 500));
    });
  });
}

/** Build the research prompt and gather a workspace context digest. */
export async function gatherWorkspaceContext(opts: {
  workspacePath: string;
  instruction: string;
  docTitle: string;
}): Promise<AgentResult & { digest: string }> {
  const cli = detectZcodeCli();
  if (!cli) {
    return { ok: false, digest: "", output: "未找到 ZCode CLI", ms: 0 };
  }
  const prompt = [
    `你在为一份文档的 AI 改写任务收集背景资料。`,
    `文档标题：《${opts.docTitle}》。`,
    `用户的修改要求：「${opts.instruction}」。`,
    `请阅读当前目录下与该要求相关的文件（如 README、文档、笔记、代码等），`,
    `然后输出一份简明的背景摘要（不超过 300 字）：与修改要求相关的项目事实、术语、数据、风格约定。`,
    `只输出摘要正文，不要解释你的过程。`,
  ].join("\n");
  const r = await runAgent({ cli, cwd: opts.workspacePath, prompt });
  return { ...r, digest: r.ok ? r.output : "" };
}
