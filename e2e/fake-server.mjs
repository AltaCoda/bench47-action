// The recorded Bench47 server for the end-to-end workflow:
//
//   GET  /dispatch/bnch/releases/latest.json        e2e/out/releases/latest.json
//   GET  /dispatch/bnch/releases/<version>/<file>   e2e/out/releases/<version>/<file>
//   POST /api/v1/fake-ci                            the fake bnch's call; answered from recorded.json
//   GET  /__stats                                   what was downloaded and called, for the workflow's checks
//
// Usage: node e2e/fake-server.mjs <port>

import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const releases = path.join(here, "out", "releases");
const recorded = JSON.parse(readFileSync(path.join(here, "recorded.json"), "utf8"));
const port = Number(process.argv[2] ?? 8747);

const stats = { downloads: {}, calls: [] };

createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const rel = /^\/dispatch\/bnch\/releases\/(latest\.json|\d+\.\d+\.\d+\/bnch_[a-z]+_[a-z0-9]+\.tar\.gz(\.minisig)?)$/.exec(url.pathname);
  if (req.method === "GET" && rel) {
    const file = path.join(releases, rel[1]);
    if (!existsSync(file)) return send(res, 404, "not found");
    stats.downloads[rel[1]] = (stats.downloads[rel[1]] ?? 0) + 1;
    return send(res, 200, readFileSync(file));
  }
  if (req.method === "GET" && url.pathname === "/__stats") {
    return send(res, 200, JSON.stringify(stats), "application/json");
  }
  if (req.method === "POST" && url.pathname === "/api/v1/fake-ci") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const args = body.split("\n").filter((l) => l !== "");
      stats.calls.push(args);
      // args: ci <command> <name> …
      const answer = recorded[`${args[1]} ${args[2]}`];
      if (!answer) return send(res, 200, "say no recording for this call\nexit 2\n");
      const lines = [`say ${answer.say}`, `summary ${answer.say}`];
      for (const [k, v] of Object.entries(answer.outputs)) lines.push(`output ${k}=${v}`);
      lines.push(`exit ${answer.exit}`);
      send(res, 200, lines.join("\n") + "\n");
    });
    return;
  }
  send(res, 404, "not found");
}).listen(port, "127.0.0.1", () => console.log(`fake Bench47 server on http://127.0.0.1:${port}`));

function send(res, status, body, type = "application/octet-stream") {
  res.writeHead(status, { "content-type": type });
  res.end(body);
}
