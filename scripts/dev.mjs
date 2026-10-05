// Dev launcher: start the vite dev server for the renderer, then launch
// Electron pointed at it. Main/preload are rebuilt once up front.
import { spawn } from "node:child_process";
import { build } from "esbuild";

await build({
  bundle: true,
  external: ["electron"],
  entryPoints: ["src/main/main.ts"],
  outfile: "dist/main/main.js",
  format: "esm",
  platform: "node",
  target: "node20",
  logLevel: "warning",
  banner: {
    js: `import { createRequire as __createRequire } from "node:module";\nconst require = __createRequire(import.meta.url);`,
  },
});
await build({
  bundle: true,
  external: ["electron"],
  entryPoints: ["src/preload/preload.ts"],
  outfile: "dist/main/preload.cjs",
  format: "cjs",
  platform: "node",
  target: "node20",
  logLevel: "warning",
});

const vite = spawn("npx", ["vite", "--port", "5174", "--strictPort"], {
  stdio: "inherit",
});
// wait for the dev server
await new Promise((r) => setTimeout(r, 4000));

const electron = spawn("npx", ["electron", "."], {
  stdio: "inherit",
  env: { ...process.env, ELECTRON_RENDERER_URL: "http://localhost:5174" },
});
electron.on("exit", (code) => {
  vite.kill();
  process.exit(code ?? 0);
});
