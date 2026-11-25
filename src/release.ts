// What this release of the Action trusts and pins. The bnch-bump workflow
// raises BNCH_VERSION (and package.json's patch version) when a newer bnch is
// published; merging that PR releases the Action (release.yml).

/**
 * The bnch version this release of the Action runs when `version` is not
 * given. It is never below CI_SINCE and START_SINCE.
 */
export const BNCH_VERSION = "0.19.2";

/**
 * The first bnch versions with `bnch ci` and with `bnch ci start`. Older
 * versions are refused with a line saying which version is needed. Both
 * arrived in bnch 0.19.0.
 */
export const CI_SINCE = "0.19.0";
export const START_SINCE = "0.19.0";

/**
 * The minisign public key every bnch release archive is signed with (key id
 * 120603FBC15897DB). It is the same value as PublicKey in the bench47 repo's
 * backend/cmd/bnch/internal/release/release.go. The test bundle
 * (scripts/build.mjs --test-key) swaps this module for one holding a key the
 * tests generate; the published dist/index.js always holds this one.
 */
export const PUBLIC_KEY = "RWTbl1jB+wMGEtA2BV7rzC0x0YHydUXFkTqAN1HLHp04eUT8gxdZyNZf";

/** Where hosted bnch releases live: <base>/releases/<version>/<file>. */
export const HOSTED_RELEASE_BASE = "https://get.bench47.com/bnch";

/** The hosted API's hosts; a `server` naming one of them still downloads from HOSTED_RELEASE_BASE. */
export const HOSTED_API_HOSTS = ["api.bench47.com", "api.markbase.cloud"];
