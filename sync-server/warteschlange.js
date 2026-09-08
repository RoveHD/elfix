"use strict";

const crypto = require("crypto");

const MAX_EINTRAEGE = 100;
const MAX_STIMMEN = 200;
const START_FRIST_MS = 60000;

function text(wert, laenge) {
  return String(wert == null ? "" : wert).slice(0, laenge).trim();
}

function akteurSaeubern(akteur) {
  const principal = text(akteur?.principal, 80);
  const id = text(akteur?.id, 64);
  if (!principal || !id) return null;
  return { principal, id, name: text(akteur?.name, 40) || "Gerät" };
}

class AbstimmungsWarteschlange {
  constructor(optionen = {}) {
    this.art = text(optionen.art, 20) || "titel";
    this.saeubern = optionen.saeubern || ((wert) => wert);
    this.schluessel = optionen.schluessel || ((wert) => text(wert?.key, 300));
    this.fristMs = Number(optionen.fristMs) || START_FRIST_MS;
    this.aufAenderung = optionen.onChange || (() => {});
    this.aufStart = optionen.onStart || (() => {});
    this.aufBereit = optionen.onReady || (() => {});
    this.aufAbbruch = optionen.onCancel || (() => {});
    this.rev = 0;
    this.eintraege = [];
    this.pending = null;
    this.timer = null;
  }

  laden(roh) {
    this.rev = Math.max(0, Number(roh?.rev) || 0);
    this.eintraege = [];
    const kandidaten = [];
    if (roh?.pending?.entry) kandidaten.push(roh.pending.entry);
    if (Array.isArray(roh?.items)) kandidaten.push(...roh.items);
    const gesehen = new Set();
    for (const kandidat of kandidaten.slice(0, MAX_EINTRAEGE + 1)) {
      const daten = this.saeubern(kandidat?.data);
      const dedupe = daten && this.schluessel(daten);
      const id = text(kandidat?.id, 64);
      if (!daten || !dedupe || !id || gesehen.has(dedupe)) continue;
      gesehen.add(dedupe);
      const stimmen = new Map();
      for (const [principal, stimme] of Array.isArray(kandidat?.votes) ? kandidat.votes : []) {
        const key = text(principal, 80);
        const sid = text(stimme?.id, 64);
        if (!key || !sid || stimmen.size >= MAX_STIMMEN) continue;
        stimmen.set(key, { id: sid, name: text(stimme?.name, 40) || "Gerät", at: Number(stimme?.at) || 0 });
      }
      this.eintraege.push({
        id,
        dedupe,
        data: daten,
        proposedBy: text(kandidat?.proposedBy, 80),
        proposedById: text(kandidat?.proposedById, 64),
        proposedByName: text(kandidat?.proposedByName, 40) || "Gerät",
        proposedAt: Number(kandidat?.proposedAt) || Date.now(),
        votes: stimmen
      });
    }
    // Ein Start kann einen Relay-Neustart nicht ueberleben. Der Eintrag selbst
    // bleibt durch das Voranstellen oben erhalten und darf erneut beansprucht werden.
    this.pending = null;
  }

  serialisieren() {
    const items = this.eintraege.slice();
    if (this.pending?.entry) items.unshift(this.pending.entry);
    return {
      rev: this.rev,
      items: items.map((eintrag) => ({
        id: eintrag.id,
        data: eintrag.data,
        proposedBy: eintrag.proposedBy,
        proposedById: eintrag.proposedById,
        proposedByName: eintrag.proposedByName,
        proposedAt: eintrag.proposedAt,
        votes: [...eintrag.votes.entries()]
      }))
    };
  }

  sortiert() {
    return this.eintraege.slice().sort((a, b) => (
      b.votes.size - a.votes.size
      || a.proposedAt - b.proposedAt
      || a.id.localeCompare(b.id)
    ));
  }

  hatInhalt() {
    return this.eintraege.length > 0 || Boolean(this.pending);
  }

  nachAussen(eintrag, akteur) {
    return {
      id: eintrag.id,
      kind: this.art,
      ...eintrag.data,
      proposedBy: eintrag.proposedByName,
      proposedById: eintrag.proposedById,
      proposedAt: eintrag.proposedAt,
      votes: eintrag.votes.size,
      voted: Boolean(akteur && eintrag.votes.has(akteur.principal)),
      mine: Boolean(akteur && eintrag.proposedBy === akteur.principal)
    };
  }

  zustand(akteur, zusatz = {}) {
    const actor = akteurSaeubern(akteur);
    const sortiert = this.sortiert();
    return {
      rev: this.rev,
      items: sortiert.map((eintrag) => this.nachAussen(eintrag, actor)),
      selectedId: sortiert[0]?.id || "",
      pending: this.pending ? {
        startId: this.pending.startId,
        item: this.nachAussen(this.pending.entry, actor),
        ...this.pending.context,
        at: this.pending.at,
        expiresAt: this.pending.expiresAt
      } : null,
      ...zusatz
    };
  }

  vorschlagen(roh, akteur) {
    const actor = akteurSaeubern(akteur);
    const daten = this.saeubern(roh);
    const dedupe = daten && this.schluessel(daten);
    if (!actor || !daten || !dedupe) return { ok: false, reason: "invalid-item" };
    let eintrag = this.eintraege.find((item) => item.dedupe === dedupe);
    if (!eintrag && this.pending?.entry?.dedupe === dedupe) return { ok: false, reason: "already-starting" };
    if (!eintrag) {
      if (this.eintraege.length >= MAX_EINTRAEGE) return { ok: false, reason: "queue-full" };
      eintrag = {
        id: crypto.randomUUID(), dedupe, data: daten,
        proposedBy: actor.principal, proposedById: actor.id, proposedByName: actor.name,
        proposedAt: Date.now(), votes: new Map()
      };
      this.eintraege.push(eintrag);
    }
    if (eintrag.votes.has(actor.principal)) return { ok: true, id: eintrag.id, unchanged: true };
    eintrag.votes.set(actor.principal, { id: actor.id, name: actor.name, at: Date.now() });
    this.geaendert("propose");
    return { ok: true, id: eintrag.id };
  }

  abstimmen(id, wert, akteur) {
    const actor = akteurSaeubern(akteur);
    const eintrag = this.eintraege.find((item) => item.id === text(id, 64));
    if (!actor || !eintrag) return { ok: false, reason: "not-found" };
    const hat = eintrag.votes.has(actor.principal);
    if ((wert === false && !hat) || (wert !== false && hat)) return { ok: true, unchanged: true };
    if (wert === false) eintrag.votes.delete(actor.principal);
    else eintrag.votes.set(actor.principal, { id: actor.id, name: actor.name, at: Date.now() });
    this.geaendert("vote");
    return { ok: true };
  }

  entfernen(id, akteur) {
    const actor = akteurSaeubern(akteur);
    const index = this.eintraege.findIndex((item) => item.id === text(id, 64));
    if (!actor || index < 0) return { ok: false, reason: "not-found" };
    if (this.eintraege[index].proposedBy !== actor.principal) return { ok: false, reason: "not-owner" };
    this.eintraege.splice(index, 1);
    this.geaendert("remove");
    return { ok: true };
  }

  starten(expectedId, context, zielIds, akteur) {
    const actor = akteurSaeubern(akteur);
    if (!actor) return { ok: false, reason: "identity-required" };
    if (this.pending) return { ok: false, reason: "already-pending" };
    const gewaehlt = this.sortiert()[0];
    if (!gewaehlt) return { ok: false, reason: "empty" };
    if (!expectedId || gewaehlt.id !== text(expectedId, 64)) {
      return { ok: false, reason: "selection-changed" };
    }
    this.eintraege = this.eintraege.filter((item) => item !== gewaehlt);
    const at = Date.now();
    const targets = new Set(Array.from(zielIds || []).map((wert) => text(wert, 64)).filter(Boolean));
    targets.add(actor.id);
    this.pending = {
      startId: crypto.randomUUID(), entry: gewaehlt, context: { ...(context || {}) },
      at, expiresAt: at + this.fristMs, targets, ready: new Set(), failed: new Set()
    };
    this.geaendert("advance");
    this.aufStart(this.pending);
    this.startTimer();
    return { ok: true, startId: this.pending.startId };
  }

  gestartet(startId, ok, geraetId) {
    const pending = this.pending;
    const id = text(geraetId, 64);
    if (!pending || pending.startId !== text(startId, 64) || !pending.targets.has(id)) {
      return { ok: false, reason: "stale-start" };
    }
    if (!ok) {
      pending.failed.add(id);
      this.zuruecklegen("start-failed");
      return { ok: true, requeued: true };
    }
    pending.ready.add(id);
    if ([...pending.targets].every((ziel) => pending.ready.has(ziel))) {
      return this.abschliessen();
    }
    this.geaendert("start-ready");
    return { ok: true, waiting: true };
  }

  startNachricht(akteur, zusatz = {}) {
    if (!this.pending) return null;
    return {
      startId: this.pending.startId,
      item: this.nachAussen(this.pending.entry, akteurSaeubern(akteur)),
      ...this.pending.context,
      at: this.pending.at,
      expiresAt: this.pending.expiresAt,
      ...zusatz
    };
  }

  istStartZiel(geraetId) {
    return Boolean(this.pending?.targets.has(text(geraetId, 64)));
  }

  startTimer() {
    this.timerLoeschen();
    const startId = this.pending?.startId;
    if (!startId) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.pending?.startId !== startId) return;
      this.zuruecklegen("lease-expired");
    }, this.fristMs);
    this.timer.unref?.();
  }

  zuruecklegen(reason) {
    if (!this.pending) return;
    const abgebrochen = this.pending;
    // Die Zielgeraete haben zu diesem Zeitpunkt den neuen Inhalt bereits
    // pausiert geladen. Der Abbruch muss sie erreichen, solange Startkennung
    // und Zielkreis noch eindeutig feststehen.
    this.aufAbbruch(abgebrochen, reason);
    this.eintraege.unshift(abgebrochen.entry);
    this.pending = null;
    this.timerLoeschen();
    this.geaendert(reason);
  }

  abschliessen() {
    if (!this.pending) return { ok: false, reason: "stale-start" };
    if (!this.pending.ready.size) {
      this.zuruecklegen("all-failed");
      return { ok: true, requeued: true };
    }
    const fertig = this.pending;
    this.pending = null;
    this.timerLoeschen();
    this.aufBereit(fertig, new Set(fertig.ready));
    this.geaendert("started");
    return { ok: true, done: true };
  }

  timerLoeschen() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  geaendert(reason) {
    this.rev += 1;
    this.aufAenderung(reason);
  }
}

module.exports = { AbstimmungsWarteschlange, MAX_EINTRAEGE, START_FRIST_MS };
