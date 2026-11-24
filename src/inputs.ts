// The Action's inputs, checked and turned into one `bnch ci …` command line.
// Pure: it reads inputs through a getter so tests need no environment.

export type Command = "gate" | "signoff" | "start";

export interface Plan {
  command: Command;
  /** Arguments after `bnch`. */
  args: string[];
  /** BENCH47_API_KEY for the child, when the `api-key` input is set. */
  apiKey?: string;
  /** The `server` input, trimmed of a trailing slash; undefined = hosted. */
  server?: string;
  /** The `version` input with any leading "v"; undefined = the pinned one. */
  version?: string;
}

export class InputError extends Error {}

const SIGNOFF_ONLY = ["subject", "state", "summary", "link"] as const;

export function readPlan(get: (name: string) => string): Plan {
  const val = (name: string) => get(name).trim();

  const chosen = (["gate", "signoff", "start"] as const).filter((c) => val(c) !== "");
  if (chosen.length !== 1) {
    throw new InputError(
      chosen.length === 0
        ? "Set one of `gate`, `signoff` or `start`."
        : `Set only one of \`gate\`, \`signoff\` or \`start\`; this step sets ${chosen.map((c) => `\`${c}\``).join(" and ")}.`,
    );
  }
  const command = chosen[0]!;
  const target = val(command);

  const args = ["ci", command, target];

  const server = val("server").replace(/\/+$/, "") || undefined;
  if (server !== undefined) {
    let u: URL;
    try {
      u = new URL(server);
    } catch {
      throw new InputError(`\`server\` is not a URL: ${server}`);
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") {
      throw new InputError("`server` must be an http or https URL.");
    }
    args.push("--server", server);
  }
  const org = val("org");
  if (org !== "") args.push("--org", org);

  const inputs = parseInputLines(get("inputs"));
  const wait = val("wait");

  if (command === "signoff") {
    if (inputs.length > 0) throw new InputError("`inputs` is for `gate` and `start`, not `signoff`.");
    if (wait !== "") throw new InputError("`wait` is for `gate` and `start`, not `signoff`.");
    const subject = val("subject");
    if (subject === "") throw new InputError("A sign-off needs `subject`.");
    args.push("--subject", subject);
    const state = val("state");
    if (state !== "") {
      if (state !== "given" && state !== "refused") {
        throw new InputError("`state` is `given` or `refused`.");
      }
      args.push("--state", state);
    }
    const summary = val("summary");
    if (summary !== "") args.push("--summary", summary);
    const link = val("link");
    if (link !== "") args.push("--link", link);
  } else {
    const stray = SIGNOFF_ONLY.filter((n) => val(n) !== "");
    if (stray.length > 0) {
      throw new InputError(
        `${stray.map((n) => `\`${n}\``).join(", ")} ${stray.length === 1 ? "is" : "are"} for \`signoff\` only.`,
      );
    }
    for (const kv of inputs) args.push("--input", kv);
    if (wait !== "") args.push("--wait", wait);
  }

  const apiKey = get("api-key").trim() || undefined;
  const version = val("version").replace(/^v/, "") || undefined;
  if (version !== undefined && !/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version)) {
    throw new InputError(`\`version\` is not a bnch version such as 0.19.0: ${version}`);
  }
  return { command, args, apiKey, server, version };
}

/** One `key=value` per line; blank lines are skipped. */
export function parseInputLines(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;
    const eq = line.indexOf("=");
    if (eq <= 0) {
      throw new InputError(`Each line of \`inputs\` is key=value; this one is not: ${line}`);
    }
    out.push(`${line.slice(0, eq).trim()}=${line.slice(eq + 1)}`);
  }
  return out;
}
