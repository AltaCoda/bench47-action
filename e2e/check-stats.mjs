// Checks what the fake server saw, after the end-to-end steps ran:
//   - the good bnch archive was downloaded once (the later runs used the tool cache);
//   - the tampered archive was downloaded but bnch never ran for it;
//   - the API key reached bnch only on the step that set it.
// Usage: node e2e/check-stats.mjs <port> <os> <arch>

const [port, os, arch] = process.argv.slice(2);
const stats = await (await fetch(`http://127.0.0.1:${port}/__stats`)).json();
const fail = (msg) => {
  console.error(`::error::${msg}\n${JSON.stringify(stats, null, 2)}`);
  process.exit(1);
};

const file = `bnch_${os}_${arch}.tar.gz`;
if (stats.downloads[`0.19.0/${file}`] !== 1) fail(`expected one download of 0.19.0/${file}`);
if (stats.downloads[`0.99.0/${file}`] !== 1) fail(`expected the tampered 0.99.0/${file} to be downloaded once`);

const gates = stats.calls.filter((c) => c[1] === "gate").map((c) => c[2]);
if (gates.includes("tamper-check")) fail("bnch ran for the tampered archive");
const keyed = stats.calls.filter((c) => c.includes("api-key=present")).map((c) => c[2]);
if (JSON.stringify(keyed) !== JSON.stringify(["release-ready"])) fail(`api key seen on ${keyed}`);
console.log("fake server saw what it should:", JSON.stringify(stats.calls.map((c) => c.slice(1, 3).join(" "))));
