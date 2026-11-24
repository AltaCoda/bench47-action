import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { newer, parse } from "../scripts/bnch-bump.mjs";

describe("bnch-bump", () => {
  it("compares release versions numerically", () => {
    expect(newer("0.19.0", "0.18.2")).toBe(true);
    expect(newer("0.18.10", "0.18.9")).toBe(true);
    expect(newer("0.19.0", "0.19.0")).toBe(false);
    expect(newer("0.18.2", "0.19.0")).toBe(false);
  });

  it("refuses anything that is not X.Y.Z", () => {
    for (const v of ["0.19", "v0.19.0", "0.19.0-rc.1", "0.19.0\nx", "", "0.19.0; rm -rf /"]) {
      expect(() => parse(v)).toThrow(/not a release version/);
    }
  });

  it("pins a bnch that has ci and ci start", () => {
    const src = readFileSync("src/release.ts", "utf8");
    const get = (name: string) => new RegExp(`export const ${name} = "([^"]+)";`).exec(src)![1]!;
    expect(newer(get("CI_SINCE"), get("BNCH_VERSION"))).toBe(false);
    expect(newer(get("START_SINCE"), get("BNCH_VERSION"))).toBe(false);
  });
});
