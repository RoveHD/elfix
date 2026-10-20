"use strict";

// Echte Chromium-Netzanfragen und echte lokale Pipe, ohne installierte Apps,
// oeffentliche Hoster, Benutzerprofile oder sichtbare Fenster zu verwenden.
const { app, BrowserWindow, session } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const assert = require("node:assert/strict");
const { erstellen, pipeName } = require("../src/dynex-video");
const directory = process.env.DYNEX_MEDIA_TEST_DIRECTORY || fs.mkdtempSync(path.join(os.tmpdir(), "elfix-dynex-media-"));
app.setPath("userData", path.join(directory, "profile"));
app.disableHardwareAcceleration();
for (const stream of [process.stdout, process.stderr]) stream.on("error", () => app.exit(1));
const external = process.env.DYNEX_MEDIA_EXTERNAL_RECEIVER === "1";
const encrypted = Boolean(process.env.DYNEX_MEDIA_TEST_CERT && process.env.DYNEX_MEDIA_TEST_KEY);
const transport = encrypted ? require("node:https") : require("node:http");
const serverOptions = encrypted ? {
  cert: fs.readFileSync(process.env.DYNEX_MEDIA_TEST_CERT), key: fs.readFileSync(process.env.DYNEX_MEDIA_TEST_KEY)
} : {};
const servers = [], clients = new Set(), frames = [], observations = [];
let win, reporter, pipe;
const deadline = setTimeout(() => finish(new Error("DYNEX media integration timed out")), 30000);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(condition) {
  const end = Date.now() + 15000;
  while (Date.now() < end) { if (condition()) return; await pause(40); }
  throw new Error("actual media evidence did not arrive");
}
async function serve(handler) {
  const server = transport.createServer(serverOptions, handler);
  servers.push(server);
  server.on("connection", socket => { clients.add(socket); socket.once("close", () => clients.delete(socket)); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return (encrypted ? "https" : "http") + "://127.0.0.1:" + server.address().port;
}
function finish(error) {
  clearTimeout(deadline);
  reporter?.schliessen();
  win?.destroy();
  for (const socket of clients) socket.destroy();
  for (const server of servers) server.close();
  pipe?.close();
  if (error) {
    fs.writeFileSync(path.join(directory, "electron-result.json"), JSON.stringify({ ok: false, error: error.message }));
    console.error(error.stack); app.exit(1);
  } else app.exit(0);
}
app.whenReady().then(async () => {
  if (process.platform !== "win32") { console.log("SKIP: Windows named-pipe integration"); return finish(); }
  if (!external) {
    pipe = net.createServer(socket => {
      let text = "";
      socket.on("data", chunk => {
        text += chunk.toString("utf8");
        while (text.includes("\n")) {
          const end = text.indexOf("\n"); frames.push(JSON.parse(text.slice(0, end))); text = text.slice(end + 1);
        }
      });
    });
    await new Promise((resolve, reject) => { pipe.once("error", reject); pipe.listen("\\\\.\\pipe\\" + pipeName(directory), resolve); });
  }
  const positive = await serve((request, response) => {
    if (request.url === "/") { response.writeHead(200, { "Content-Type": "text/html" }); response.end("<!doctype html><title>Isolated media test</title>"); return; }
    response.writeHead(206, { "Content-Type": "video/mp4", "Cache-Control": "no-store" });
    response.write(Buffer.alloc(1024));
    const timer = setInterval(() => { if (!response.destroyed) response.write(Buffer.alloc(1024)); }, 100);
    const end = setTimeout(() => { clearInterval(timer); response.end(); }, 4000);
    response.once("close", () => { clearInterval(timer); clearTimeout(end); });
  });
  const negative = await serve((request, response) => {
    const mime = request.url === "/html" ? "text/html" : request.url === "/update" ? "application/octet-stream" : "video/mp4";
    response.writeHead(request.url === "/error" ? 404 : 200, {
      "Content-Type": mime, "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store",
      ...(request.url === "/download" ? { "Content-Disposition": "attachment; filename=fixture.mp4" } : {})
    });
    response.end("fixture");
  });
  const ses = session.fromPartition("dynex-media-integration-" + process.pid, { cache: false });
  if (encrypted) ses.setCertificateVerifyProc(({ hostname }, callback) => callback(hostname === "127.0.0.1" ? 0 : -3));
  reporter = erstellen({ localAppData: directory, prozesse: () => [process.pid, ...app.getAppMetrics().filter(p => p.type === "Utility").map(p => p.pid)] });
  reporter.beobachten(ses, { antwortSchonBelegt: true });
  ses.webRequest.onResponseStarted(details => {
    observations.push({ resourceType: details.resourceType, hasActualIp: net.isIP(details.ip || "") > 0, statusCode: details.statusCode,
      nativePlayer: details.url.endsWith("/native") });
    reporter.antwort(ses, details);
  });
  win = new BrowserWindow({ show: false, webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await win.loadURL(positive);
  for (const name of ["html", "update", "error", "download"]) {
    await win.webContents.executeJavaScript("fetch(" + JSON.stringify(negative + "/" + name) + ").then(r=>r.text())");
  }
  assert.equal(frames.some(frame => frame.connections?.length), false, "nonmedia and attachment responses never send media evidence");
  const fetchVideo = win.webContents.executeJavaScript("fetch(" + JSON.stringify(positive + "/video?private=local-fixture") + ").then(r=>r.arrayBuffer()).then(b=>b.byteLength)");
  const endpoint = { address: "127.0.0.1", port: Number(new URL(positive).port) };
  fs.writeFileSync(path.join(directory, "endpoint.tmp"), JSON.stringify(endpoint));
  fs.renameSync(path.join(directory, "endpoint.tmp"), path.join(directory, "endpoint.json"));
  await until(() => external ? fs.existsSync(path.join(directory, "receiver-ok")) : frames.some(frame => frame.connections.some(c => c.address === endpoint.address && c.port === endpoint.port)));
  assert.ok(observations.some(value => value.statusCode === 206 && value.hasActualIp), "actual Chromium response IP is available for media");
  const bytes = await fetchVideo;
  assert.ok(bytes > 1024);
  const playerResponse = await require("../src/spieler-netz").medienAbruf(new Request(positive + "/native"), ses);
  const playerBytes = (await playerResponse.arrayBuffer()).byteLength;
  assert.ok(playerBytes > 1024);
  assert.ok(observations.some(value => value.nativePlayer && value.hasActualIp && value.statusCode === 206), "own player net.request also supplies actual media response IP");
  for (const frame of frames) {
    assert.ok(frame.connections.every(c => c.port === endpoint.port), "other server never inherits priority");
    assert.equal(JSON.stringify(frame).includes("private"), false);
  }
  const result = { ok: true, electron: process.versions.electron, encrypted, actualResponseIp: true,
    endpoint, mediaBytes: bytes, nativePlayerBytes: playerBytes, frames: frames.length, externalReceiver: external };
  fs.writeFileSync(path.join(directory, "electron-result.json"), JSON.stringify(result));
  console.log("PASS: real Chromium " + (encrypted ? "HTTPS" : "HTTP") + " media, actual server IP, optional DYNEX pipe and download exclusions");
  finish();
}).catch(finish);
