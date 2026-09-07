"use strict";

// Alte Protokolltests sprechen das Relay absichtlich direkt an. Ihre festen
// Kennungen bleiben lesbar, bekommen im Testprozess aber denselben geheimen
// Besitznachweis, den die echte App aus ihrer privaten Ablage mitbringt.

const crypto = require("node:crypto");
const WebSocket = require("../../sync-server/node_modules/ws");

const senden = WebSocket.prototype.send;
const ausloesen = WebSocket.prototype.emit;
WebSocket.prototype.send = function sicherSenden(daten, ...rest) {
  if (typeof daten !== "string") return senden.call(this, daten, ...rest);
  let nachricht;
  try {
    nachricht = JSON.parse(daten);
  } catch {
    return senden.call(this, daten, ...rest);
  }
  if (!nachricht || nachricht.type !== "join" || nachricht.deviceProof) {
    return senden.call(this, daten, ...rest);
  }
  const marke = String(nachricht.deviceId || `socket-${crypto.randomUUID()}`);
  nachricht.deviceProof = crypto.createHash("sha256")
    .update(`elfix-relay-test:${marke}`)
    .digest("base64url");
  if (typeof nachricht.konto === "string" && /^[0-9a-f]{32}$/.test(nachricht.konto)) {
    nachricht.accountProof = crypto.createHash("sha256")
      .update(`elfix-relay-test-account:${nachricht.konto}`)
      .digest("base64url");
    delete nachricht.konto;
  }
  return senden.call(this, JSON.stringify(nachricht), ...rest);
};

// Direkte Relay-Alttests erwarten beim Folgenwechsel noch das fruehere
// `control/navigate`. Die Produktionsclients pruefen die neue Ladebarriere in
// relayidentitytest, mitschauentest, direktpartytest und der Matrix. Nur fuer
// die uebrigen Protokollfixtures wird die Vorbereitung hier in deren alte
// Beobachtungsform uebersetzt und als sofort bereit bestaetigt.
WebSocket.prototype.emit = function testNachrichtAusloesen(ereignis, ...argumente) {
  if (ereignis !== "message") return ausloesen.call(this, ereignis, ...argumente);
  let nachricht;
  try {
    nachricht = JSON.parse(String(argumente[0]));
  } catch {
    return ausloesen.call(this, ereignis, ...argumente);
  }
  if (nachricht?.type !== "syncprepare" || nachricht.reason !== "episode-change"
    || !nachricht.syncId || !nachricht.key) {
    return ausloesen.call(this, ereignis, ...argumente);
  }
  queueMicrotask(() => {
    if (this.readyState !== WebSocket.OPEN) return;
    this.send(JSON.stringify({ type: "syncready", key: nachricht.key, syncId: nachricht.syncId }));
  });
  argumente[0] = Buffer.from(JSON.stringify({
    ...nachricht,
    type: "control",
    action: "navigate"
  }));
  return ausloesen.call(this, ereignis, ...argumente);
};
