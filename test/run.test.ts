// The Action end to end inside one process: real tool cache (in a temporary
// directory), real archive extraction and a real child process (a fake bnch
// shell script), with downloads served from memory.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { newKey, signMinisign } from "../scripts/testsign.mjs";

const root = mkdtempSync(path.join(tmpdir(), "bench47-action-"));
process.env.RUNNER_TOOL_CACHE = path.join(root, "toolcache");
process.env.RUNNER_TEMP = path.join(root, "temp");

const tc = await import("@actions/tool-cache");
const bnchMod = await import("../src/bnch.js");
const { run, tooOld, compareVersions } = await import("../src/main.js");
const { readPlan } = await import("../src/inputs.js");

const key = newKey();
const VERSION = "0.19.0";
const platform = process.platform === "darwin" ? "darwin" : "linux";
const arch = process.arch === "arm64" ? "arm64" : "amd64";
const FILE = `bnch_${platform}_${arch}.tar.gz`;

// A fake bnch: records its arguments and BENCH47_API_KEY, writes a step
// output, and exits with FAKE_BNCH_EXIT.
const FAKE_BNCH = `#!/bin/sh
printf '%s\\n' "$@" > "$FAKE_BNCH_LOG"
printf 'key=%s\\n' "$BENCH47_API_KEY" >> "$FAKE_BNCH_LOG"
exit "\${FAKE_BNCH_EXIT:-0}"
`;

let archive: Buffer;
beforeAll(() => {
  const src = mkdtempSync(path.join(root, "src-"));
  writeFileSync(path.join(src, "bnch"), FAKE_BNCH, { mode: 0o755 });
  const out = path.join(root, FILE);
  execFileSync("tar", ["-czf", out, "-C", src, "bnch"]);
  archive = readFileSync(out);
});

interface Served {
  [url: string]: Buffer | string;
}

function fetcherFor(served: Served, hits: string[]): import("../src/bnch.js").Fetcher {
  return {
    async text(url) {
      hits.push(url);
      const v = served[url];
      if (v === undefined) throw new Error(`404 ${url}`);
      return v.toString();
    },
    async file(url) {
      hits.push(url);
      const v = served[url];
      if (v === undefined) throw new Error(`404 ${url}`);
      const f = path.join(mkdtempSync(path.join(root, "dl-")), "download");
      writeFileSync(f, v);
      return f;
    },
  };
}

function release(base: string, version: string, data: Buffer, sigData = data): Served {
  const url = `${base}/releases/${version}/${FILE}`;
  return {
    [url]: data,
    [`${url}.minisig`]: signMinisign(key, sigData, `bnch ${version} ${FILE}`),
  };
}

let log: string;
const savedEnv = { ...process.env };
beforeEach(() => {
  log = path.join(mkdtempSync(path.join(root, "log-")), "args");
  process.env.FAKE_BNCH_LOG = log;
  process.env.GITHUB_PATH = path.join(root, "github_path");
  writeFileSync(process.env.GITHUB_PATH, "");
});
afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
  Object.assign(process.env, savedEnv);
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

// core.setFailed writes "::error::<message>" to stdout; collect the messages.
function captureErrors() {
  const seen = vi.fn();
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    const m = /^::error::(.*)$/m.exec(chunk.toString());
    if (m) seen(m[1]);
    return true;
  });
  return seen;
}

function setInputs(m: Record<string, string>) {
  for (const [k, v] of Object.entries(m)) process.env[`INPUT_${k.toUpperCase()}`] = v;
}

function deps(served: Served, hits: string[], over: Partial<import("../src/main.js").RunDeps> = {}) {
  const extract = vi.fn((a: string) => tc.extractTar(a));
  return {
    d: {
      ...bnchMod.defaultDeps,
      fetcher: fetcherFor(served, hits),
      extract,
      publicKey: key.publicKey,
      platform: process.platform,
      arch: process.arch,
      exec: (bin: string, args: string[], env: Record<string, string>) =>
        Promise.resolve(
          (() => {
            try {
              execFileSync(bin, args, { env, stdio: "ignore" });
              return 0;
            } catch (e) {
              return (e as { status: number }).status;
            }
          })(),
        ),
      ...over,
    },
    extract,
  };
}

describe("run", () => {
  const server = "https://bench47.acme.test";
  const base = `${server}/dispatch/bnch`;

  it("downloads, verifies, caches and runs bnch, then uses the cache", async () => {
    setInputs({ org: "acme", gate: "release-ready", inputs: "sha=abc", server, version: VERSION, "api-key": "mb_k" });
    const hits: string[] = [];
    const { d, extract } = deps(release(base, VERSION, archive), hits);

    expect(await run(d)).toBe(0);
    expect(readFileSync(log, "utf8").split("\n")).toEqual([
      "ci", "gate", "release-ready", "--server", server, "--org", "acme", "--input", "sha=abc", "key=mb_k", "",
    ]);
    expect(hits).toEqual([`${base}/releases/${VERSION}/${FILE}`, `${base}/releases/${VERSION}/${FILE}.minisig`]);
    expect(extract).toHaveBeenCalledTimes(1);
    expect(tc.find("bnch", VERSION, arch)).not.toBe("");

    // Second run on the same runner: nothing downloaded or extracted.
    const hits2: string[] = [];
    const second = deps({}, hits2);
    expect(await run(second.d)).toBe(0);
    expect(hits2).toEqual([]);
    expect(second.extract).not.toHaveBeenCalled();
  });

  it("passes bnch's exit code through", async () => {
    setInputs({ gate: "release-ready", server, version: VERSION });
    process.env.FAKE_BNCH_EXIT = "1";
    expect(await run(deps({}, []).d)).toBe(1);
    process.env.FAKE_BNCH_EXIT = "2";
    expect(await run(deps({}, []).d)).toBe(2);
  });

  it("fails on a tampered archive before anything is extracted or run", async () => {
    const v = "0.19.1";
    setInputs({ gate: "release-ready", server, version: v });
    const tampered = Buffer.from(archive);
    tampered[tampered.length - 10]! ^= 0xff;
    const exec = vi.fn();
    const { d, extract } = deps(release(base, v, tampered, archive), [], { exec });
    const failed = captureErrors();

    expect(await run(d)).toBe(2);
    expect(failed).toHaveBeenCalledWith(expect.stringMatching(/bnch 0\.19\.1 failed its signature check, so nothing was run/));
    expect(extract).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
    expect(tc.find("bnch", v, arch)).toBe("");
    expect(existsSync(log)).toBe(false);
  });

  it("fails on a signature for another version", async () => {
    const v = "0.19.2";
    setInputs({ gate: "g", server, version: v });
    const url = `${base}/releases/${v}/${FILE}`;
    const served = { [url]: archive, [`${url}.minisig`]: signMinisign(key, archive, `bnch 0.19.0 ${FILE}`) };
    const exec = vi.fn();
    captureErrors();
    expect(await run(deps(served, [], { exec }).d)).toBe(2);
    expect(exec).not.toHaveBeenCalled();
  });

  it("reads a self-host's version from its latest.json", async () => {
    const v = "0.19.3";
    setInputs({ gate: "g", server });
    const hits: string[] = [];
    const served = { ...release(base, v, archive), [`${base}/releases/latest.json`]: JSON.stringify({ version: v }) };
    expect(await run(deps(served, hits).d)).toBe(0);
    expect(hits[0]).toBe(`${base}/releases/latest.json`);
    expect(hits[1]).toBe(`${base}/releases/${v}/${FILE}`);
  });

  it("refuses Windows with one line", async () => {
    setInputs({ gate: "g", version: VERSION });
    const failed = captureErrors();
    const exec = vi.fn();
    expect(await run(deps({}, [], { platform: "win32", arch: "x64", exec }).d)).toBe(2);
    expect(failed).toHaveBeenCalledWith("bnch has no Windows build; run this step on a Linux or macOS runner.");
    expect(exec).not.toHaveBeenCalled();
  });

  it("refuses a bnch without ci, and a start before ci start exists", async () => {
    setInputs({ gate: "g", version: "0.18.2" });
    const failed = captureErrors();
    const hits: string[] = [];
    expect(await run(deps({}, hits).d)).toBe(2);
    expect(failed).toHaveBeenCalledWith(expect.stringMatching(/^`gate` needs bnch 0\.19\.0 or later; this step would run bnch 0\.18\.2/));
    expect(hits).toEqual([]);
    expect(tooOld(readPlan((n) => ({ start: "h" })[n] ?? ""), "0.18.9")).toMatch(/^`start` needs bnch/);
  });
});

describe("bnch", () => {
  it("maps platforms", () => {
    expect(bnchMod.platformOf("linux", "x64")).toEqual({ os: "linux", arch: "amd64" });
    expect(bnchMod.platformOf("darwin", "arm64")).toEqual({ os: "darwin", arch: "arm64" });
    expect(() => bnchMod.platformOf("linux", "ia32")).toThrow(/x64 and arm64/);
  });

  it("downloads from the hosted channel unless a self-host is named", () => {
    expect(bnchMod.releaseBase(undefined)).toBe("https://get.bench47.com/bnch");
    expect(bnchMod.releaseBase("https://api.bench47.com")).toBe("https://get.bench47.com/bnch");
    expect(bnchMod.releaseBase("https://bench47.acme.com/")).toBe("https://bench47.acme.com/dispatch/bnch");
  });

  it("pins the hosted version without asking the network", async () => {
    const hits: string[] = [];
    expect(await bnchMod.resolveVersion(undefined, undefined, fetcherFor({}, hits))).toMatch(/^\d+\.\d+\.\d+$/);
    expect(await bnchMod.resolveVersion("1.0.0", "https://x.test", fetcherFor({}, hits))).toBe("1.0.0");
    expect(hits).toEqual([]);
  });

  it("compares versions", () => {
    expect(compareVersions("0.19.0", "0.18.12")).toBeGreaterThan(0);
    expect(compareVersions("0.19.0", "0.19.0")).toBe(0);
    expect(compareVersions("0.9.0", "0.19.0")).toBeLessThan(0);
  });
});
