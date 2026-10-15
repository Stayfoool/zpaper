// Runs scripts/docedits.test.ts by bundling it with esbuild (no tsx needed).
import { build } from "esbuild";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const outDir = mkdtempSync(join(tmpdir(), "zpaper-docedits-"));
await build({
  entryPoints: [new URL("./docedits.test.ts", import.meta.url).pathname],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: join(outDir, "test.mjs"),
  logLevel: "silent",
});
await import(pathToFileURL(join(outDir, "test.mjs")).href);
