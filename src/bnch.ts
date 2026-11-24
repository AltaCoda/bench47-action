// Finds bnch in the runner's tool cache, or downloads it, checks its minisign
// signature against the key built into the Action, and caches it.

import * as core from "@actions/core";
import * as tc from "@actions/tool-cache";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { verifyMinisign } from "./minisign.js";
import { BNCH_VERSION, HOSTED_API_HOSTS, HOSTED_RELEASE_BASE, PUBLIC_KEY } from "./release.js";

export const TOOL_NAME = "bnch";

export interface Platform {
  os: "linux" | "darwin";
  arch: "amd64" | "arm64";
}

export class SetupError extends Error {}

export function platformOf(platform: string, arch: string): Platform {
  if (platform === "win32") {
    throw new SetupError(
      "bnch has no Windows build; run this step on a Linux or macOS runner.",
    );
  }
  if (platform !== "linux" && platform !== "darwin") {
    throw new SetupError(`bnch has no build for ${platform}; run this step on a Linux or macOS runner.`);
  }
  const a = arch === "x64" ? "amd64" : arch === "arm64" ? "arm64" : undefined;
  if (!a) throw new SetupError(`bnch has no build for ${platform} on ${arch}; it runs on x64 and arm64.`);
  return { os: platform, arch: a };
}

export function archiveName(p: Platform): string {
  return `bnch_${p.os}_${p.arch}.tar.gz`;
}

/**
 * The release channel to download from: the hosted one, or a self-host's own
 * `<server>/dispatch/bnch` so its client matches its server.
 */
export function releaseBase(server: string | undefined): string {
  if (server === undefined) return HOSTED_RELEASE_BASE;
  const host = new URL(server).hostname.toLowerCase();
  if (HOSTED_API_HOSTS.includes(host)) return HOSTED_RELEASE_BASE;
  return `${server.replace(/\/+$/, "")}/dispatch/bnch`;
}

export interface Fetcher {
  text(url: string): Promise<string>;
  /** Downloads url to a temporary file and returns its path. */
  file(url: string): Promise<string>;
}

export const httpFetcher: Fetcher = {
  async text(url) {
    const res = await fetch(url, { headers: { "user-agent": "bench47-action" }, redirect: "follow" });
    if (!res.ok) throw new SetupError(`${url} answered ${res.status}`);
    return res.text();
  },
  async file(url) {
    try {
      return await tc.downloadTool(url);
    } catch (e) {
      throw new SetupError(`could not download ${url}: ${(e as Error).message}`);
    }
  },
};

/**
 * The bnch version to run: the `version` input; else, on a self-host, the one
 * release its server carries (latest.json); else the Action's pinned one.
 */
export async function resolveVersion(
  requested: string | undefined,
  server: string | undefined,
  fetcher: Fetcher,
): Promise<string> {
  if (requested) return requested;
  const base = releaseBase(server);
  if (base === HOSTED_RELEASE_BASE) return BNCH_VERSION;
  const url = `${base}/releases/latest.json`;
  let doc: unknown;
  try {
    doc = JSON.parse(await fetcher.text(url));
  } catch (e) {
    throw new SetupError(
      `could not read which bnch ${server} carries (${url}): ${(e as Error).message}. Set \`version\`, or check \`server\`.`,
    );
  }
  const v = (doc as { version?: unknown })?.version;
  if (typeof v !== "string" || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(v)) {
    throw new SetupError(`${url} names no bnch version.`);
  }
  return v;
}

export interface Located {
  /** Path of the bnch executable. */
  bin: string;
  version: string;
  cached: boolean;
}

export interface Deps {
  fetcher: Fetcher;
  find: (tool: string, version: string, arch: string) => string;
  extract: (archive: string) => Promise<string>;
  cache: (dir: string, tool: string, version: string, arch: string) => Promise<string>;
  publicKey: string;
}

export const defaultDeps: Deps = {
  fetcher: httpFetcher,
  find: (tool, version, arch) => tc.find(tool, version, arch),
  extract: (archive) => tc.extractTar(archive),
  cache: (dir, tool, version, arch) => tc.cacheDir(dir, tool, version, arch),
  publicKey: PUBLIC_KEY,
};

/**
 * Returns bnch `version` for p from the tool cache, or downloads it from
 * base, verifies it and caches it. Nothing is extracted, cached or run unless
 * the signature checks out.
 */
export async function locateBnch(
  version: string,
  base: string,
  p: Platform,
  deps: Deps = defaultDeps,
): Promise<Located> {
  const cachedDir = deps.find(TOOL_NAME, version, p.arch);
  if (cachedDir) {
    return { bin: path.join(cachedDir, "bnch"), version, cached: true };
  }

  const file = archiveName(p);
  const url = `${base}/releases/${version}/${file}`;
  core.info(`Downloading bnch ${version} from ${url}`);
  const archive = await deps.fetcher.file(url);
  const minisig = await deps.fetcher.text(`${url}.minisig`).catch((e: Error) => {
    throw new SetupError(`could not download the signature ${url}.minisig: ${e.message}`);
  });

  // The trusted comment binds the signature to bnch, this version and this
  // file (bnch-release.yml signs "bnch <version> <file>"), so a genuine but
  // different archive cannot stand in for this one.
  try {
    verifyMinisign(await readFile(archive), minisig, deps.publicKey, `bnch ${version} ${file}`);
  } catch (e) {
    throw new SetupError(`bnch ${version} failed its signature check, so nothing was run: ${(e as Error).message}.`);
  }
  core.info(`Signature checked: bnch ${version} ${file}`);

  const dir = await deps.extract(archive);
  const cachedTo = await deps.cache(dir, TOOL_NAME, version, p.arch);
  return { bin: path.join(cachedTo, "bnch"), version, cached: false };
}
