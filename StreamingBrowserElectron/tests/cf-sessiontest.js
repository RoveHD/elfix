"use strict";
const assert = require("node:assert/strict");
const cf = require("../src/cf-session");
const direktlauf = require("../src/direktlauf");

async function main() {
  const html = '<html><title>Just a moment...</title><form id="challenge-form"><script src="/cdn-cgi/challenge-platform/test"></script></form></html>';
  for (const status of [200, 403, 503]) {
    assert.equal(cf.klassifizieren({ status, headers: { "Content-Type": "text/html" }, body: html }).challenge, true);
  }
  assert.equal(cf.klassifizieren({ status: 200, headers: new Headers({ "cf-mitigated": "challenge" }) }).challenge, true);
  for (const body of ["Forbidden", '<html><title>Home</title><script src="/cdn-cgi/challenge-platform/jsd/main.js"></script></html>',
    '<html><title>Just a moment</title>Loading video</html>']) {
    assert.equal(cf.klassifizieren({ status: 403, headers: { "cf-ray": "example", "content-type": "text/html" }, body }).challenge, false);
  }
  const widget = '<html><form><div class="cf-turnstile"></div></form></html>';
  assert.equal(cf.klassifizieren({ status: 200, headers: { "cf-ray": "example" }, body: widget }).challenge, false);
  assert.equal(cf.klassifizieren({ status: 403, body: widget }).challenge, false);
  assert.equal(cf.klassifizieren({ status: 403, headers: { "cf-ray": "example" }, body: widget }).challenge, true);
  assert.equal(cf.klassifizieren({ headers: { "content-type": "text/html" }, body: "<html>Login</html>", expected: "stream" }).unexpectedHtml, true);
  for (const [body, contentType, type] of [["#EXTM3U\n", "text/plain", "HLS"], ["<MPD></MPD>", "application/xml", "DASH"],
    ["", "video/mp4", "MP4"], ['{"ok":true}', "application/json", "JSON"]]) {
    assert.equal(cf.klassifizieren({ body, headers: { "content-type": contentType } }).type, type);
  }
  const log = cf.diagnose("challenge detected", {
    url: "https://username:password@example.test/watch?token=SECRET_QUERY#SECRET_HASH",
    headers: { "set-cookie": "cf_clearance=SECRET_RESPONSE", location: "https://example.test/?SECRET_REDIRECT" },
    requestHeaders: { Cookie: "cf_clearance=SECRET_COOKIE; session=SECRET_SESSION", Referer: "https://example.test/?SECRET_REFERER" }
  });
  assert.ok(log.startsWith("[CF] challenge detected"));
  assert.ok(!/SECRET|username|password/.test(log));
  assert.deepEqual(JSON.parse(log.slice(log.indexOf("{"))).cookieNames, ["cf_clearance", "session"]);
  assert.deepEqual(cf.cookieNames([{ name: "cf_clearance", value: "SECRET" }, { name: "session", value: "SECRET" }]), ["cf_clearance", "session"]);

  const logs = [];
  let verified = false;
  let calls = 0;
  const resolver = direktlauf.erstellen({ kennung: "SameAgent/1", diagnose: line => logs.push(line), holen: async (url, init) => {
    calls++;
    assert.equal(init.headers["user-agent"], "SameAgent/1");
    return new Response(verified ? '<video src="https://cdn.example/video.mp4"></video>' : html, {
      status: verified ? 200 : 403, headers: { "content-type": "text/html" }
    });
  } });
  const gate = await resolver.aufloesen("https://provider.example/watch?token=SECRET");
  assert.equal(gate.challenge, true);
  assert.equal(gate.seite, "https://provider.example/watch?token=SECRET");
  assert.equal(gate.status, 403);
  assert.equal(gate.typ, "Challenge");
  assert.equal(calls, 1, "resolver must not auto-solve or loop");
  verified = true; // Test fixture representing completion by the human in the browser.
  const retried = await resolver.aufloesen("https://provider.example/watch?token=SECRET");
  assert.equal(retried.ok, true);
  assert.equal(calls, 2);
  assert.ok(logs.every(line => !line.includes("SECRET")));
  const redirected = direktlauf.erstellen({ diagnose: () => {}, holen: async () => ({
    status: 200, ok: true, url: "https://hoster.example/protected", headers: new Headers({ "cf-mitigated": "challenge" }),
    text: async () => { throw new Error("header evidence must not consume the response body"); }
  }) });
  assert.equal((await redirected.aufloesen("https://provider.example/link")).seite, "https://hoster.example/protected");
  const forbidden = direktlauf.erstellen({ diagnose: () => {}, holen: async () => new Response("Forbidden", { status: 403 }) });
  const denied = await forbidden.aufloesen("https://provider.example/link");
  assert.equal(denied.grund, "HTTP 403");
  assert.equal(denied.seite, "");
  assert.equal(Boolean(denied.challenge), false);
  console.log("OK CF response evidence, safe diagnostics, challenge handoff and original-request retry");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
