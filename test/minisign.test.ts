import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { newKey, signMinisign } from "../scripts/testsign.mjs";
import {
  SignatureError,
  parsePublicKey,
  verifyMinisign,
  verifyMinisignDigest,
} from "../src/minisign.js";
import { PUBLIC_KEY } from "../src/release.js";

const fixture = (name: string) => new URL(`./fixtures/${name}`, import.meta.url);

describe("a real bnch release", () => {
  // bnch 0.18.2's linux/amd64 signature as published, and the archive's
  // BLAKE2b-512 digest (the archive itself is 7 MB and not committed). Checked
  // with `minisign -Vm` against the same key when the fixture was taken.
  const minisig = readFileSync(fixture("bnch-0.18.2-linux-amd64.tar.gz.minisig"), "utf8");
  const digest = Buffer.from(
    readFileSync(fixture("bnch-0.18.2-linux-amd64.digests.txt"), "utf8").split("\n")[0]!,
    "hex",
  );

  it("verifies under the Action's built-in key", () => {
    expect(() =>
      verifyMinisignDigest(digest, minisig, PUBLIC_KEY, "bnch 0.18.2 bnch_linux_amd64.tar.gz"),
    ).not.toThrow();
  });

  it("refuses another archive", () => {
    const other = Buffer.from(digest);
    other[0]! ^= 1;
    expect(() =>
      verifyMinisignDigest(other, minisig, PUBLIC_KEY, "bnch 0.18.2 bnch_linux_amd64.tar.gz"),
    ).toThrow(/does not match its signature/);
  });

  it("refuses the right archive offered as another version or file", () => {
    expect(() =>
      verifyMinisignDigest(digest, minisig, PUBLIC_KEY, "bnch 0.19.0 bnch_linux_amd64.tar.gz"),
    ).toThrow(/is for "bnch 0.18.2 bnch_linux_amd64.tar.gz"/);
    expect(() =>
      verifyMinisignDigest(digest, minisig, PUBLIC_KEY, "bnch 0.18.2 bnch_darwin_arm64.tar.gz"),
    ).toThrow(SignatureError);
  });

  it("parses the key id minisign prints", () => {
    expect(Buffer.from(parsePublicKey(PUBLIC_KEY).keyId).reverse().toString("hex").toUpperCase()).toBe(
      "120603FBC15897DB",
    );
  });
});

describe("verifyMinisign", () => {
  const key = newKey();
  const data = Buffer.from("an archive");
  const comment = "bnch 1.2.3 bnch_linux_amd64.tar.gz";

  it("accepts prehashed and legacy signatures", () => {
    expect(() => verifyMinisign(data, signMinisign(key, data, comment), key.publicKey, comment)).not.toThrow();
    expect(() =>
      verifyMinisign(data, signMinisign(key, data, comment, { legacy: true }), key.publicKey, comment),
    ).not.toThrow();
  });

  it("refuses a tampered archive", () => {
    const sig = signMinisign(key, data, comment);
    expect(() => verifyMinisign(Buffer.from("an archivE"), sig, key.publicKey, comment)).toThrow(
      /does not match its signature/,
    );
  });

  it("refuses an edited trusted comment", () => {
    const sig = signMinisign(key, data, comment).replace(comment, "bnch 9.9.9 bnch_linux_amd64.tar.gz");
    expect(() => verifyMinisign(data, sig, key.publicKey, "bnch 9.9.9 bnch_linux_amd64.tar.gz")).toThrow(
      /trusted comment has been altered/,
    );
  });

  it("refuses another key", () => {
    const other = newKey();
    expect(() => verifyMinisign(data, signMinisign(other, data, comment), key.publicKey, comment)).toThrow(
      /signed with key/,
    );
    // Same key id, different key: the signature itself fails.
    const forged = { ...other, keyId: key.keyId };
    expect(() => verifyMinisign(data, signMinisign(forged, data, comment), key.publicKey, comment)).toThrow(
      /does not match/,
    );
  });

  it("refuses garbage", () => {
    expect(() => verifyMinisign(data, "not a signature", key.publicKey, comment)).toThrow(SignatureError);
    expect(() => verifyMinisign(data, signMinisign(key, data, comment), "RWQ=", comment)).toThrow(SignatureError);
  });
});
