// A minisign verifier on node:crypto alone (Ed25519 and BLAKE2b-512 are both
// built into Node), so the Action carries no third-party crypto.
//
// Formats (https://jedisct1.github.io/minisign/):
//   public key line:  base64("Ed" | key id (8) | public key (32))
//   .minisig file:    untrusted comment: …
//                     base64(algorithm (2) | key id (8) | signature (64))
//                     trusted comment: <text>
//                     base64(global signature (64))
// The algorithm is "ED" (prehashed: the signature is over BLAKE2b-512 of the
// file, minisign's default since 0.10 and what the bnch release pipeline
// produces) or "Ed" (legacy: over the file itself). The global signature is
// over signature | trusted comment, which binds the comment to the file.

import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto";

export interface PublicKey {
  keyId: Buffer;
  key: KeyObject;
}

export interface Signature {
  algorithm: "Ed" | "ED";
  keyId: Buffer;
  signature: Buffer;
  trustedComment: string;
  globalSignature: Buffer;
}

export class SignatureError extends Error {}

function ed25519Key(raw: Buffer): KeyObject {
  return createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x: raw.toString("base64url") },
    format: "jwk",
  });
}

function decode(line: string, want: number, what: string): Buffer {
  const b = Buffer.from(line.trim(), "base64");
  if (b.length !== want || b.toString("base64") !== line.trim()) {
    throw new SignatureError(`${what} is not valid minisign base64`);
  }
  return b;
}

export function parsePublicKey(text: string): PublicKey {
  // Accept the bare base64 line or a whole .pub file.
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
  const line = lines.find((l) => !l.startsWith("untrusted comment:"));
  if (!line) throw new SignatureError("public key is empty");
  const b = decode(line, 42, "public key");
  if (b.subarray(0, 2).toString("latin1") !== "Ed") {
    throw new SignatureError("public key is not an Ed25519 minisign key");
  }
  return { keyId: b.subarray(2, 10), key: ed25519Key(b.subarray(10, 42)) };
}

export function parseSignature(text: string): Signature {
  const lines = text.split(/\r?\n/);
  if (lines.length < 4 || !lines[0]!.startsWith("untrusted comment:")) {
    throw new SignatureError("signature file is not in minisign format");
  }
  const sig = decode(lines[1]!, 74, "signature");
  const algorithm = sig.subarray(0, 2).toString("latin1");
  if (algorithm !== "Ed" && algorithm !== "ED") {
    throw new SignatureError(`signature algorithm ${JSON.stringify(algorithm)} is not supported`);
  }
  const prefix = "trusted comment: ";
  if (!lines[2]!.startsWith(prefix)) {
    throw new SignatureError("signature file has no trusted comment");
  }
  return {
    algorithm,
    keyId: sig.subarray(2, 10),
    signature: sig.subarray(10, 74),
    trustedComment: lines[2]!.slice(prefix.length),
    globalSignature: decode(lines[3]!, 64, "global signature"),
  };
}

/**
 * Verifies data against a minisign signature and public key, and that the
 * trusted comment is exactly wantComment. Throws SignatureError on any
 * mismatch; returns nothing on success.
 */
export function verifyMinisign(
  data: Buffer,
  signatureText: string,
  publicKeyText: string,
  wantComment: string,
): void {
  const sig = parseSignature(signatureText);
  const message = sig.algorithm === "ED" ? createHash("blake2b512").update(data).digest() : data;
  verifyMessage(message, sig, publicKeyText, wantComment);
}

/**
 * Verifies a prehashed ("ED") signature given the file's BLAKE2b-512 digest
 * rather than the file, for checking a real release without its archive.
 */
export function verifyMinisignDigest(
  blake2b512: Buffer,
  signatureText: string,
  publicKeyText: string,
  wantComment: string,
): void {
  const sig = parseSignature(signatureText);
  if (sig.algorithm !== "ED") throw new SignatureError("not a prehashed signature");
  verifyMessage(blake2b512, sig, publicKeyText, wantComment);
}

function verifyMessage(message: Buffer, sig: Signature, publicKeyText: string, wantComment: string): void {
  const pk = parsePublicKey(publicKeyText);
  if (!sig.keyId.equals(pk.keyId)) {
    throw new SignatureError(
      `signed with key ${hexId(sig.keyId)}, not the Action's key ${hexId(pk.keyId)}`,
    );
  }
  if (!verify(null, message, pk.key, sig.signature)) {
    throw new SignatureError("the archive does not match its signature");
  }
  const global = Buffer.concat([sig.signature, Buffer.from(sig.trustedComment, "utf8")]);
  if (!verify(null, global, pk.key, sig.globalSignature)) {
    throw new SignatureError("the signature's trusted comment has been altered");
  }
  if (sig.trustedComment !== wantComment) {
    throw new SignatureError(
      `the signature is for "${sig.trustedComment}", not "${wantComment}"`,
    );
  }
}

// minisign prints key ids little-endian, as uppercase hex.
function hexId(id: Buffer): string {
  return Buffer.from(id).reverse().toString("hex").toUpperCase();
}
