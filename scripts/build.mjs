// Bundles src/ into one file GitHub runs with no node_modules.
//
//   node scripts/build.mjs                         → dist/index.js (the published Action)
//   node scripts/build.mjs --test-key <key> --out <file>
//       → the same code with PUBLIC_KEY replaced by a test key, for the
//         end-to-end run against the fake server (e2e/). Never committed.

import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { "test-key": { type: "string" }, out: { type: "string" } },
});
const testKey = values["test-key"];
const outfile = values.out ?? "dist/index.js";
if (testKey && outfile === "dist/index.js") {
  throw new Error("a test-key build must not overwrite dist/index.js");
}

const swapKey = {
  name: "swap-key",
  setup(b) {
    b.onLoad({ filter: /src[\\/]release\.ts$/ }, async (args) => {
      const src = await readFile(args.path, "utf8");
      const out = src.replace(/export const PUBLIC_KEY = "[^"]+";/, `export const PUBLIC_KEY = ${JSON.stringify(testKey)};`);
      if (out === src) throw new Error("PUBLIC_KEY not found in src/release.ts");
      return { contents: out, loader: "ts" };
    });
  },
};

await build({
  entryPoints: ["src/index.ts"],
  outfile,
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  legalComments: "eof",
  // Some bundled dependencies still call require().
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  plugins: testKey ? [swapKey] : [],
  logLevel: "info",
});

// The bundle is an ES module; say so next to it, so Node reads it as one
// wherever the action directory is.
await writeFile(path.join(path.dirname(outfile), "package.json"), '{ "type": "module" }\n');
