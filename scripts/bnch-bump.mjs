// Raises BNCH_VERSION in src/release.ts to the latest published bnch.
//
//   node scripts/bnch-bump.mjs [--latest <version>]
//
// Reads <HOSTED_RELEASE_BASE>/releases/latest.json unless --latest is given.
// Writes `current`, `latest` and `bumped` (true|false) to $GITHUB_OUTPUT when
// set. It changes only src/release.ts; the workflow bumps package.json.
// A new bnch major is not bumped: the Action's code may need changes for it,
// so it fails with a line saying so and a person decides.

import { readFile, writeFile, appendFile } from "node:fs/promises";
import { parseArgs } from "node:util";

const RELEASE_TS = "src/release.ts";
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export function parse(v) {
  const m = SEMVER.exec(v);
  if (!m) throw new Error(`not a release version: ${JSON.stringify(v)}`);
  return m.slice(1).map(Number);
}

export function newer(a, b) {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

function constant(src, name) {
  const m = new RegExp(`export const ${name} = "([^"]+)";`).exec(src);
  if (!m) throw new Error(`${name} not found in ${RELEASE_TS}`);
  return m[1];
}

async function main() {
  const { values } = parseArgs({ options: { latest: { type: "string" } } });
  const src = await readFile(RELEASE_TS, "utf8");
  const current = constant(src, "BNCH_VERSION");

  let latest = values.latest;
  if (!latest) {
    const url = `${constant(src, "HOSTED_RELEASE_BASE")}/releases/latest.json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    latest = (await res.json()).version;
  }
  parse(latest);

  let bumped = false;
  if (newer(latest, current)) {
    if (parse(latest)[0] !== parse(current)[0]) {
      throw new Error(`bnch ${latest} is a new major (pinned: ${current}); bump it by hand after checking the Action works with it`);
    }
    await writeFile(RELEASE_TS, src.replace(`export const BNCH_VERSION = "${current}";`, `export const BNCH_VERSION = "${latest}";`));
    bumped = true;
  }

  console.log(bumped ? `BNCH_VERSION ${current} -> ${latest}` : `BNCH_VERSION ${current} is current (latest ${latest})`);
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `current=${current}\nlatest=${latest}\nbumped=${bumped}\n`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`::error::${err.message}`);
    process.exit(1);
  });
}
