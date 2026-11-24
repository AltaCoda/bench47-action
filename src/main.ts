// The Action: check inputs, get a verified bnch, run `bnch ci …` and pass its
// exit code through. bnch itself writes the step outputs, the job summary and
// the error annotation.

import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { chmod } from "node:fs/promises";
import * as path from "node:path";
import {
  SetupError,
  defaultDeps,
  locateBnch,
  platformOf,
  releaseBase,
  resolveVersion,
  type Deps,
} from "./bnch.js";
import { InputError, readPlan, type Plan } from "./inputs.js";
import { CI_SINCE, START_SINCE } from "./release.js";

/** Compares two x.y.z versions (pre-release suffixes ignored); NaN if either is not one. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => /^(\d+)\.(\d+)\.(\d+)/.exec(v)?.slice(1).map(Number);
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return NaN;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return 0;
}

/** The line refusing a bnch too old for the command, or undefined when it is new enough. */
export function tooOld(plan: Plan, version: string): string | undefined {
  const since = plan.command === "start" ? START_SINCE : CI_SINCE;
  const what = plan.command === "start" ? "`start`" : `\`${plan.command}\``;
  if (compareVersions(version, since) < 0) {
    return `${what} needs bnch ${since} or later; this step would run bnch ${version}. Set \`version\` to ${since} or later${plan.server ? ", or upgrade the Bench47 server" : ", or use a newer release of the Action"}.`;
  }
  return undefined;
}

export interface RunDeps extends Deps {
  platform: string;
  arch: string;
  exec: (bin: string, args: string[], env: Record<string, string>) => Promise<number>;
}

const defaultRunDeps: RunDeps = {
  ...defaultDeps,
  platform: process.platform,
  arch: process.arch,
  exec: (bin, args, env) => exec.exec(bin, args, { ignoreReturnCode: true, env }),
};

/** Runs the Action and returns the exit code the step should end with. */
export async function run(deps: RunDeps = defaultRunDeps): Promise<number> {
  try {
    const plan = readPlan((name) => core.getInput(name));
    if (plan.apiKey) core.setSecret(plan.apiKey);

    const p = platformOf(deps.platform, deps.arch);
    const version = await resolveVersion(plan.version, plan.server, deps.fetcher);
    const old = tooOld(plan, version);
    if (old) throw new InputError(old);

    const bnch = await locateBnch(version, releaseBase(plan.server), p, deps);
    core.info(bnch.cached ? `Using bnch ${version} from the tool cache` : `Cached bnch ${version}`);
    await chmod(bnch.bin, 0o755).catch(() => undefined);
    // Later steps in the job can call bnch too.
    core.addPath(path.dirname(bnch.bin));

    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    if (plan.apiKey) env.BENCH47_API_KEY = plan.apiKey;

    return await deps.exec(bnch.bin, plan.args, env);
  } catch (e) {
    if (e instanceof InputError || e instanceof SetupError) {
      core.setFailed(e.message);
      return 2;
    }
    core.setFailed(`The Bench47 Action failed: ${(e as Error).message}`);
    return 2;
  }
}
