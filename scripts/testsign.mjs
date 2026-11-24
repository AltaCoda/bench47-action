// Test-only minisign signing: a fresh Ed25519 key pair in minisign's formats
// and signatures in both algorithms. Used by the unit tests and by
// e2e/make-release.mjs. The Action itself only verifies.

import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";

/** A new key: { publicKey: "<base64 line>", keyId: Buffer, privateKey: KeyObject }. */
export function newKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url");
  const keyId = randomBytes(8);
  const line = Buffer.concat([Buffer.from("Ed", "latin1"), keyId, raw]).toString("base64");
  return { publicKey: line, keyId, privateKey };
}

/** The .minisig text for data, prehashed ("ED", minisign's default) unless legacy is set. */
export function signMinisign(key, data, trustedComment, { legacy = false } = {}) {
  const alg = legacy ? "Ed" : "ED";
  const message = legacy ? data : createHash("blake2b512").update(data).digest();
  const sig = sign(null, message, key.privateKey);
  const global = sign(null, Buffer.concat([sig, Buffer.from(trustedComment, "utf8")]), key.privateKey);
  return [
    "untrusted comment: signature from minisign secret key",
    Buffer.concat([Buffer.from(alg, "latin1"), key.keyId, sig]).toString("base64"),
    `trusted comment: ${trustedComment}`,
    global.toString("base64"),
    "",
  ].join("\n");
}
