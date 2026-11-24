import { describe, expect, it } from "vitest";
import { InputError, parseInputLines, readPlan } from "../src/inputs.js";

const from = (m: Record<string, string>) => (name: string) => m[name] ?? "";

describe("readPlan", () => {
  it("builds a gate command", () => {
    const plan = readPlan(
      from({
        org: "acme",
        gate: "release-ready",
        inputs: "sha=abc123\n\n  release = v1.2.3 \n",
        wait: "5m",
        "api-key": " mb_secret ",
      }),
    );
    expect(plan.command).toBe("gate");
    expect(plan.args).toEqual([
      "ci", "gate", "release-ready",
      "--org", "acme",
      "--input", "sha=abc123",
      "--input", "release= v1.2.3",
      "--wait", "5m",
    ]);
    expect(plan.apiKey).toBe("mb_secret");
    expect(plan.server).toBeUndefined();
    expect(plan.version).toBeUndefined();
  });

  it("builds a sign-off command", () => {
    const plan = readPlan(
      from({
        signoff: "qa",
        subject: "release:v1.2.3",
        state: "refused",
        summary: "Smoke test failed",
        link: "https://ci.example/run/1",
        server: "https://bench47.acme.com/",
        version: "v0.19.0",
      }),
    );
    expect(plan.args).toEqual([
      "ci", "signoff", "qa",
      "--server", "https://bench47.acme.com",
      "--subject", "release:v1.2.3",
      "--state", "refused",
      "--summary", "Smoke test failed",
      "--link", "https://ci.example/run/1",
    ]);
    expect(plan.server).toBe("https://bench47.acme.com");
    expect(plan.version).toBe("0.19.0");
  });

  it("builds a start command", () => {
    expect(readPlan(from({ start: "release-notes", inputs: "tag=v1", wait: "20m" })).args).toEqual([
      "ci", "start", "release-notes", "--input", "tag=v1", "--wait", "20m",
    ]);
  });

  it("needs exactly one of gate, signoff and start", () => {
    expect(() => readPlan(from({}))).toThrow("Set one of `gate`, `signoff` or `start`.");
    expect(() => readPlan(from({ gate: "a", start: "b" }))).toThrow(
      "Set only one of `gate`, `signoff` or `start`; this step sets `gate` and `start`.",
    );
  });

  it("keeps sign-off fields to sign-offs", () => {
    expect(() => readPlan(from({ gate: "g", subject: "s", link: "l" }))).toThrow(
      "`subject`, `link` are for `signoff` only.",
    );
    expect(() => readPlan(from({ signoff: "qa", subject: "s", inputs: "a=b" }))).toThrow(InputError);
    expect(() => readPlan(from({ signoff: "qa", subject: "s", wait: "1m" }))).toThrow(InputError);
    expect(() => readPlan(from({ signoff: "qa" }))).toThrow("A sign-off needs `subject`.");
    expect(() => readPlan(from({ signoff: "qa", subject: "s", state: "ok" }))).toThrow(
      "`state` is `given` or `refused`.",
    );
  });

  it("checks server and version", () => {
    expect(() => readPlan(from({ gate: "g", server: "bench47.acme.com" }))).toThrow(/not a URL/);
    expect(() => readPlan(from({ gate: "g", server: "ftp://x" }))).toThrow(/http or https/);
    expect(() => readPlan(from({ gate: "g", version: "latest" }))).toThrow(/not a bnch version/);
  });
});

describe("parseInputLines", () => {
  it("refuses a line without a key", () => {
    expect(() => parseInputLines("sha")).toThrow("Each line of `inputs` is key=value; this one is not: sha");
    expect(() => parseInputLines("=x")).toThrow(InputError);
  });
  it("keeps = inside values", () => {
    expect(parseInputLines("q=a=b")).toEqual(["q=a=b"]);
  });
});
