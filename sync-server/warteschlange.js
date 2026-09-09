"use strict";

const crypto = require("crypto");

const MAX_EINTRAEGE = 100;
/*
 * Jeder hat drei Stimmen, und sie wiegen verschieden: eine zaehlt drei, eine
 * zwei, eine eins. Damit sagt eine Runde nicht nur, was sie sehen will,
 * sondern auch, was ihr am wichtigsten ist - bei einer Stimme je Person
 * standen drei Vorschlaege gleichauf, und die Reihenfolge entschied dann der
 * Zufall des Zeitpunkts.
 *
 * Jedes Gewicht gibt es je Person genau einmal, und je Vorschlag hoechstens
 * eine Stimme: wer sein Dreier woanders hinlegt, nimmt es dort weg.
 */
const GEWICHTE = [3, 2, 1];
const MAX_STIMMEN = 200;
const START_FRIST_MS = 60000;
/*
 * Das Glücksrad dreht sich bei allen zugleich.
 *
 * Deshalb faellt das Los hier und nicht in einer der Oberflaechen: der Raum
 * bekommt eine Auslosung mit Kennung, Feldern, Gewinner und einem Zeitpunkt
 * auf der Serveruhr. Jeder rechnet ihn ueber seinen bekannten Uhrversatz in
 * seine eigene Zeit um und faengt im selben Augenblick an - dieselbe Rechnung
 * wie beim gemeinsamen Start einer Folge.
 *
 * Der Vorlauf gibt der Nachricht Zeit, ueberall anzukommen, bevor sich etwas
 * bewegt.
 */
const LOS_VORLAUF_MS = 600;
// Lang genug, dass es spannend wird - das Fuenffache der urspruenglichen
// gut vier Sekunden. Der Wert gehoert dem Raum und nicht dem einzelnen
// Geraet: alle drehen gleich lange, sonst haelt einer frueher an als der
// andere und beide sehen ein anderes Ergebnis kommen.
const LOS_DAUER_MS = 21000;

function text(wert, laenge) {
  return String(wert == null ? "" : wert).slice(0, laenge).trim();
}

/** Nur die drei erlaubten Gewichte; alles andere ist keine Stimme. */
function gewichtLesen(wert) {
  const zahl = Number(wert);
  return GEWICHTE.includes(zahl) ? zahl : 0;
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
    this.los = null;
  }

  /**
   * Ein Los fuer den ganzen Raum.
   *
   * Die Felder reisen mit: wer eine Umdrehung hinterherhinkt, soll trotzdem
   * dieselbe Scheibe sehen wie alle anderen. Aus seiner eigenen Liste zu
   * zeichnen hiesse, dass zwei Geraete verschiedene Segmente drehen und der
   * Zeiger am Ende auf verschiedene Namen zeigt.
   */
  auslosen(akteur) {
    const actor = akteurSaeubern(akteur);
    if (!actor) return { ok: false, reason: "identity-required" };
    if (this.pending) return { ok: false, reason: "already-pending" };
    const sortiert = this.sortiert();
    if (sortiert.length < 2) return { ok: false, reason: "not-enough-items" };
    const jetzt = Date.now();
    if (this.los && jetzt < this.los.endsAt) return { ok: false, reason: "already-spinning" };

    // Ein Vorschlag ohne Stimme darf nicht aus dem Rad fallen - sonst koennte
    // das Los nur bestaetigen, was die Rangliste ohnehin sagt.
    const felder = sortiert.map((eintrag) => ({
      id: eintrag.id,
      title: text(eintrag.data?.title, 240) || text(eintrag.data?.url, 300),
      weight: this.punkte(eintrag) + 1
    }));
    const gesamt = felder.reduce((summe, feld) => summe + feld.weight, 0);
    let rest = Math.random() * gesamt;
    let gewinner = felder[felder.length - 1];
    for (const feld of felder) {
      rest -= feld.weight;
      if (rest <= 0) { gewinner = feld; break; }
    }
    this.los = {
      spinId: crypto.randomUUID(),
      by: actor.name,
      byId: actor.id,
      fields: felder,
      winnerId: gewinner.id,
      // Wo genau im gewonnenen Feld der Zeiger stehenbleibt. Auch das gehoert
      // allen gemeinsam, sonst haelt jede Scheibe woanders.
      landing: Math.random(),
      startAt: jetzt + LOS_VORLAUF_MS,
      duration: LOS_DAUER_MS,
      endsAt: jetzt + LOS_VORLAUF_MS + LOS_DAUER_MS
    };
    this.geaendert("spin");
    return { ok: true, spinId: this.los.spinId };
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
        stimmen.set(key, { id: sid, name: text(stimme?.name, 40) || "Gerät",
          at: Number(stimme?.at) || 0,
          // Aeltere Ablagen kennen kein Gewicht. Ihre Stimmen zaehlen eins -
          // genau das bedeuteten sie bisher.
          gewicht: gewichtLesen(stimme?.gewicht) || 1 });
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

  /** Was ein Vorschlag zusammengerechnet wiegt. */
  punkte(eintrag) {
    let summe = 0;
    for (const stimme of eintrag.votes.values()) summe += gewichtLesen(stimme?.gewicht) || 1;
    return summe;
  }

  sortiert() {
    return this.eintraege.slice().sort((a, b) => (
      this.punkte(b) - this.punkte(a)
      || b.votes.size - a.votes.size
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
      votes: this.punkte(eintrag),
      voters: eintrag.votes.size,
      // Was dieses Geraet hier liegen hat - 0 heisst: nichts.
      myVote: akteur ? gewichtLesen(eintrag.votes.get(akteur.principal)?.gewicht) || 0 : 0,
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
      // Welche Gewichte dieses Geraet noch frei hat. Die Oberflaeche muss die
      // Regel damit nicht selbst kennen.
      // Eine laufende Auslosung gehoert in den Zustand: sie erreicht damit auch
      // den, der mitten in der Drehung dazukommt oder neu verbindet.
      spin: this.los && Date.now() < this.los.endsAt ? { ...this.los } : null,
      weights: GEWICHTE.slice(),
      freeWeights: actor ? GEWICHTE.filter((gewicht) => !this.eintraege
        .some((eintrag) => gewichtLesen(eintrag.votes.get(actor.principal)?.gewicht) === gewicht))
        : GEWICHTE.slice(),
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
    if (eintrag) return { ok: true, id: eintrag.id, unchanged: true };
    if (this.eintraege.length >= MAX_EINTRAEGE) return { ok: false, reason: "queue-full" };
    eintrag = {
      id: crypto.randomUUID(), dedupe, data: daten,
      proposedBy: actor.principal, proposedById: actor.id, proposedByName: actor.name,
      proposedAt: Date.now(), votes: new Map()
    };
    this.eintraege.push(eintrag);
    // Ein Vorschlag ist noch keine Stimme. Wer drei gewichtete Stimmen hat,
    // soll selbst entscheiden, ob und wie schwer er den eigenen Vorschlag
    // waehlt - vorher war die erste Stimme immer schon vergeben.
    this.geaendert("propose");
    return { ok: true, id: eintrag.id };
  }

  /** Welche Gewichte dieses Geraet gerade nirgends liegen hat. */
  freieGewichte(principal) {
    return GEWICHTE.filter((gewicht) => !this.eintraege
      .some((item) => gewichtLesen(item.votes.get(principal)?.gewicht) === gewicht));
  }

  /**
   * Eine der drei Stimmen setzen oder zuruecknehmen.
   *
   * `wert` ist ein Gewicht (3, 2 oder 1) oder `false`. Jedes Gewicht liegt
   * hoechstens einmal, und je Vorschlag zaehlt hoechstens eine Stimme je
   * Person: ein Gewicht, das woanders lag, wandert mit.
   */
  abstimmen(id, wert, akteur) {
    const actor = akteurSaeubern(akteur);
    const eintrag = this.eintraege.find((item) => item.id === text(id, 64));
    if (!actor || !eintrag) return { ok: false, reason: "not-found" };
    const vorher = gewichtLesen(eintrag.votes.get(actor.principal)?.gewicht);
    if (wert === false) {
      if (!eintrag.votes.has(actor.principal)) return { ok: true, unchanged: true };
      eintrag.votes.delete(actor.principal);
      this.geaendert("vote");
      return { ok: true };
    }
    // Ohne ausdrueckliches Gewicht gilt die leichteste freie Stimme. Damit
    // bleibt ein schlichtes "dafuer" moeglich, ohne dass jemand rechnet.
    const gewicht = gewichtLesen(wert) || this.freieGewichte(actor.principal).pop();
    if (!gewicht) return { ok: false, reason: "no-votes-left" };
    if (vorher === gewicht) return { ok: true, unchanged: true };
    if (!eintrag.votes.has(actor.principal) && eintrag.votes.size >= MAX_STIMMEN) {
      return { ok: false, reason: "too-many-votes" };
    }
    // Dasselbe Gewicht kann nicht zweimal liegen.
    for (const anderer of this.eintraege) {
      if (anderer !== eintrag
        && gewichtLesen(anderer.votes.get(actor.principal)?.gewicht) === gewicht) {
        anderer.votes.delete(actor.principal);
      }
    }
    eintrag.votes.set(actor.principal,
      { id: actor.id, name: actor.name, at: Date.now(), gewicht });
    this.geaendert("vote");
    return { ok: true, gewicht };
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
    // Gestartet wird der Vorschlag, den der Knopf nennt - nicht zwingend der
    // oben stehende. Die Abstimmung ordnet die Liste; sie soll aber nicht
    // verbieten, bewusst etwas anderes zu waehlen.
    if (!this.eintraege.length) return { ok: false, reason: "empty" };
    const gesucht = text(expectedId, 64);
    const gewaehlt = gesucht
      ? this.eintraege.find((item) => item.id === gesucht)
      : this.sortiert()[0];
    if (!gewaehlt) return { ok: false, reason: "selection-changed" };
    this.eintraege = this.eintraege.filter((item) => item !== gewaehlt);
    // Was gestartet wird, muss nicht mehr ausgelost werden.
    this.los = null;
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
