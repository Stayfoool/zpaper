// Bundle the Electron main process and preload with esbuild.
import esbuild from "esbuild";
import { inlineJsdomStylesheet } from "./esbuild-plugins.mjs";

const common = {
  bundle: true,
  // keep the SuperDoc SDK external: at runtime it require.resolve()s its
  // platform host binary from node_modules (must stay on disk, not inlined)
  external: ["electron", "@superdoc-dev/sdk"],
  sourcemap: false,
  logLevel: "info",
  plugins: [inlineJsdomStylesheet()],
};

await esbuild.build({
  ...common,
  entryPoints: ["src/main/main.ts"],
  outfile: "dist/main/main.js",
  format: "esm",
  platform: "node",
  target: "node20",
  // ESM output shims CJS deps (node builtins + __dirname used by AI SDK / mammoth)
  banner: {
    js: [
      `import { createRequire as __createRequire } from "node:module";`,
      `import { fileURLToPath as __fltp } from "node:url";`,
      `import { dirname as __dirname_fn } from "node:path";`,
      `const require = __createRequire(import.meta.url);`,
      `const __filename = __fltp(import.meta.url);`,
      `const __dirname = __dirname_fn(__filename);`,
    ].join("\n"),
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
