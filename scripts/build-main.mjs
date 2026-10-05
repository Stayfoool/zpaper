// Bundle the Electron main process and preload with esbuild.
import esbuild from "esbuild";

const common = {
  bundle: true,
  external: ["electron"],
  sourcemap: false,
  logLevel: "info",
};

await esbuild.build({
  ...common,
  entryPoints: ["src/main/main.ts"],
  outfile: "dist/main/main.js",
  format: "esm",
  platform: "node",
  target: "node20",
  // ESM output shims CJS deps (node builtins required by AI SDK packages)
  banner: {
    js: `import { createRequire as __createRequire } from "node:module";\nconst require = __createRequire(import.meta.url);`,
  },
});

await esbuild.build({
  ...common,
  entryPoints: ["src/preload/preload.ts"],
  outfile: "dist/main/preload.cjs",
  format: "cjs",
  platform: "node",
  target: "node20",
});
