// Shared esbuild plugin: jsdom reads its browser default stylesheet from disk
// relative to __dirname, which breaks inside an ESM bundle. Inline the file
// contents at build time instead.
import * as fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export function inlineJsdomStylesheet() {
  return {
    name: "inline-jsdom-stylesheet",
    setup(build) {
      build.onLoad(
        { filter: /jsdom[\\/]+lib[\\/]+jsdom[\\/]+living[\\/]+css[\\/]+helpers[\\/]+computed-style\.js$/ },
        async (args) => {
          let src = await fs.promises.readFile(args.path, "utf8");
          let css = "";
          try {
            const require_ = createRequire(args.path);
            const cssPath = require_.resolve(
              "jsdom/lib/jsdom/browser/default-stylesheet.css",
            );
            css = fs.readFileSync(cssPath, "utf8");
          } catch (e) {
            css = "";
          }
          src = src.replace(
            /fs\.readFileSync\(\s*path\.resolve\(__dirname,\s*"\.\.\/\.\.\/\.\.\/browser\/default-stylesheet\.css"\s*\)\s*,\s*\{\s*encoding:\s*"utf-8"\s*\}\s*\)/g,
            JSON.stringify(css),
          );
          return { contents: src, loader: "js" };
        },
      );
    },
  };
}
