"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const cfSession = require("../src/cf-session");
const spielerNetz = require("../src/spieler-netz");
const main = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8").replace(/\r\n/g, "\n");
const start = main.indexOf("async function cfGeschuetzteAnfragePruefen(");
assert.ok(start >= 0);
const proof = main.slice(start, main.indexOf("\n}", start) + 2);

async function run() {
  const cases = [
    { status: 403, body: "Forbidden", type: "text/plain", ok: false },
    { status: 500, body: "Server error", type: "text/plain", ok: false },
    { status: 204, body: null, type: "application/vnd.apple.mpegurl", ok: false },
    { status: 200, body: '{"error":"denied"}', type: "application/json", ok: false },
    { status: 200, body: "<html><body>Login</body></html>", type: "text/html", ok: false },
    { status: 200, body: "<html><title>Just a moment</title><form id='challenge-form'></form></html>", type: "text/html", ok: false },
    { status: 200, body: "#EXTM3U\n#EXTINF:1400,\nvideo.ts\n", type: "text/plain", ok: true },
    { status: 200, body: "local-binary-fixture", type: "application/octet-stream", expected: "mp4", ok: true }
  ];
  for (const item of cases) {
    const context = vm.createContext({ Headers, AbortSignal, URL, cfSession, spielerNetz,
      providerModel: { isHttpUrl: url => /^https?:/.test(url) },
      browserSession: { getUserAgent: () => "SessionAgent/1", fetch: async (_url, options) => {
        assert.equal(options.credentials, "include");
        assert.equal(options.headers.get("user-agent"), "SessionAgent/1");
        assert.equal(options.headers.get("referer"), "https://hoster.example/");
        return new Response(item.body, { status: item.status,
          headers: { "content-type": item.type, "content-length": String(item.body?.length || 0) } });
      } }
    });
    vm.runInContext(proof, context);
    const result = await context.cfGeschuetzteAnfragePruefen({ url: "https://cdn.example/stream.m3u8",
      expected: item.expected || "hls", referer: "https://hoster.example/" });
    assert.equal(result.ok, item.ok, `proof ${item.status} ${item.type}`);
  }

  const events = [];
  const bodies = ["#EXTM3U\n#EXTINF:1400,\nvideo.ts\n", "<html><title>Just a moment</title><form id='challenge-form'></form></html>"];
  for (let i = 0; i < bodies.length; i++) {
    const handler = spielerNetz.medienHandler(async () => new Response(bodies[i], {
      status: 200, headers: { "content-type": i ? "text/html" : "application/vnd.apple.mpegurl" }
    }), { onChallenge: details => events.push({ challenge: true, details }),
      onResponse: details => events.push({ challenge: false, details }) });
    const result = await handler(new Request("https://cdn.example/stream.m3u8", { headers: { origin: "null" } }));
    assert.equal(await result.text(), bodies[i], "sampling must preserve the actual response body");
    assert.equal(result.headers.get("access-control-allow-origin"), "null");
    assert.equal(events[i].challenge, Boolean(i));
  }
  assert.equal(events.length, 2, "one response callback per request");
  const forbidden = spielerNetz.medienHandler(async () => { throw new Error("must not reach transport"); });
  assert.equal((await forbidden(new Request("https://cdn.example/stream.m3u8", { headers: { origin: "https://foreign.example" } }))).status, 403);
  console.log("OK CF protected-response proof, invalid success rejection, body preservation and response callbacks");
}
run().catch(error => { console.error(error); process.exitCode = 1; });
