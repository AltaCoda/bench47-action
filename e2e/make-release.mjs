// Builds everything the end-to-end workflow needs, into e2e/out/:
//
//   releases/<version>/bnch_<os>_<arch>.tar.gz(.minisig)  a fake bnch, signed with a fresh test key
//   releases/latest.json                                  names GOOD_VERSION
//   action/                                               the Action built with the test key
//
// GOOD_VERSION is signed honestly. TAMPERED_VERSION is served with bytes that
// differ from what was signed, so the Action must refuse it.

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { newKey, signMinisign } from "../scripts/testsign.mjs";

export const GOOD_VERSION = "0.19.0";
export const TAMPERED_VERSION = "0.99.0";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.dirname(here);
const out = path.join(here, "out");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const key = newKey();
const stage = path.join(out, "stage");
mkdirSync(stage);
copyFileSync(path.join(here, "fake-bnch.sh"), path.join(stage, "bnch"));
execFileSync("chmod", ["0755", path.join(stage, "bnch")]);

for (const os of ["linux", "darwin"]) {
  for (const arch of ["amd64", "arm64"]) {
    const file = `bnch_${os}_${arch}.tar.gz`;
    for (const version of [GOOD_VERSION, TAMPERED_VERSION]) {
      const dir = path.join(out, "releases", version);
      mkdirSync(dir, { recursive: true });
      const target = path.join(dir, file);
      execFileSync("tar", ["-czf", target, "-C", stage, "bnch"]);
      const signed = readFileSync(target);
      writeFileSync(`${target}.minisig`, signMinisign(key, signed, `bnch ${version} ${file}`));
      if (version === TAMPERED_VERSION) {
        const bad = Buffer.from(signed);
        bad[bad.length - 8] ^= 0xff;
        writeFileSync(target, bad);
      }
    }
  }
}
writeFileSync(path.join(out, "releases", "latest.json"), JSON.stringify({ version: GOOD_VERSION }));

// The Action, built from the same source with the test key in place of the
// real one, laid out as an action directory `uses: ./e2e/out/action` runs.
const action = path.join(out, "action");
mkdirSync(action);
execFileSync(process.execPath, [path.join(repo, "scripts/build.mjs"), "--test-key", key.publicKey, "--out", path.join(action, "index.js")], {
  cwd: repo,
  stdio: "inherit",
});
const yml = readFileSync(path.join(repo, "action.yml"), "utf8").replace(/main: dist\/index\.js/, "main: index.js");
if (!yml.includes("main: index.js")) throw new Error("action.yml has no `main: dist/index.js`");
writeFileSync(path.join(action, "action.yml"), yml);
console.log(`e2e release ready in ${out}`);
