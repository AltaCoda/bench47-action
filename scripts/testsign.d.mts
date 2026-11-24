import type { KeyObject } from "node:crypto";

export interface TestKey {
  publicKey: string;
  keyId: Buffer;
  privateKey: KeyObject;
}

export function newKey(): TestKey;
export function signMinisign(
  key: TestKey,
  data: Buffer,
  trustedComment: string,
  opts?: { legacy?: boolean },
): string;
