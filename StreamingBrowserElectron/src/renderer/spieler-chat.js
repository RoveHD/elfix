"use strict";

/*
 * Die Chat-Schublade des eigenen Players.
 *
 * Der Hauptprozess besitzt Raum und Nachrichten. Diese Seite bekommt nur die
 * bereits bereinigte Statusansicht und Textzeilen; Namen und Texte werden
 * ausnahmslos mit textContent eingesetzt. Damit bleibt eine Chatzeile Text,
 * auch wenn jemand darin HTML tippt.
 */
(() => {
  const bruecke = window.elfixSpieler || {
    chatStatus: () => Promise.resolve({ active: false, messages: [] }),
    chatSenden: () => Promise.resolve({ ok: false }),
    aufChat() {}
  };
  const knopf = document.getElementById("chatKnopf");
  const panel = document.getElementById("chatPanel");
  const zu = document.getElementById("chatZu");
  const statusText = document.getElementById("chatStatus");
  const liste = document.getElementById("chatListe");
  const form = document.getElementById("chatForm");
  const eingabe = document.getElementById("chatEingabe");
  const senden = document.getElementById("chatSenden");

  let aktiv = false;
  let verbunden = false;
  let raum = "";
  let ungelesen = 0;
  let sendet = false;
  let raumGeneration = 0;
  const gesehen = new Set();
  const gesehenReihenfolge = [];
  const MAX_NACHRICHTEN = 100;

  const text = (wert, laenge = 500) => String(wert || "").trim().slice(0, laenge);
  const nachrichtenSchluessel = (nachricht) => text(nachricht?.id, 120)
    || [text(nachricht?.deviceId, 120), text(nachricht?.at, 40), text(nachricht?.name, 80), text(nachricht?.text, 500)].join("|");

  function ungelesenZeigen() {
    if (!ungelesen) knopf.removeAttribute("data-ungelesen");
    else knopf.dataset.ungelesen = String(Math.min(99, ungelesen));
  }

  function statusZeigen(fehler = "") {
    if (fehler) {
      statusText.textContent = fehler;
      return;
    }
    if (!aktiv) statusText.textContent = "Für diesen Player ist keine Watchparty verbunden. Öffne den Titel über „Gemeinsam weiterschauen“.";
    else if (!verbunden) statusText.textContent = "Verbindung wird hergestellt …";
    else statusText.textContent = "Mit der Runde verbunden";
  }

  function leeren() {
    gesehen.clear();
    gesehenReihenfolge.length = 0;
    liste.replaceChildren();
  }

  function uhrzeit(wert) {
    let zeitstempel = Number(wert);
    if (!Number.isFinite(zeitstempel) || zeitstempel <= 0) return "";
    // Der Relay-Zeitstempel ist Millisekunden; Sekunden bleiben fuer ältere
    // Nachrichten trotzdem lesbar.
    if (zeitstempel < 1e12) zeitstempel *= 1000;
    const datum = new Date(zeitstempel);
    if (!Number.isFinite(datum.getTime())) return "";
    return datum.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  }

  function istNaheAmEnde() {
    return liste.scrollHeight - liste.scrollTop - liste.clientHeight < 32;
  }

  function nachrichtHinzufuegen(nachricht, neu = false) {
    const schluessel = nachrichtenSchluessel(nachricht);
    const inhalt = text(nachricht?.text);
    if (!schluessel || !inhalt || gesehen.has(schluessel)) return false;
    const amEnde = istNaheAmEnde();
    gesehen.add(schluessel);
    gesehenReihenfolge.push(schluessel);
    const zeile = document.createElement("article");
    zeile.className = "chatNachricht";
    const name = document.createElement("span");
    name.className = "chatName";
    name.textContent = text(nachricht?.name, 80) || "Gerät";
    const nachrichtText = document.createElement("span");
    nachrichtText.className = "chatText";
    nachrichtText.textContent = inhalt;
    const uhr = document.createElement("time");
    uhr.className = "chatZeit";
    uhr.textContent = uhrzeit(nachricht?.at);
    zeile.append(name, nachrichtText, uhr);
    liste.append(zeile);
    while (gesehenReihenfolge.length > MAX_NACHRICHTEN) {
      gesehen.delete(gesehenReihenfolge.shift());
      liste.firstElementChild?.remove();
    }
    if (amEnde) liste.scrollTop = liste.scrollHeight;
    if (neu && panel.hidden) {
      ungelesen += 1;
      ungelesenZeigen();
    }
    return true;
  }

  function oeffnen() {
    panel.hidden = false;
    if (typeof schichtenZeigen === "function") schichtenZeigen();
    knopf.setAttribute("aria-expanded", "true");
    ungelesen = 0;
    ungelesenZeigen();
    (aktiv ? eingabe : zu).focus();
  }

  function schliessen() {
    if (panel.hidden) return;
    panel.hidden = true;
    knopf.setAttribute("aria-expanded", "false");
    knopf.focus();
  }

  function statusUebernehmen(status) {
    const naechsterRaum = text(status?.room, 160);
    if (raum !== naechsterRaum) {
      raumGeneration += 1;
      leeren();
      eingabe.value = "";
      ungelesen = 0;
      ungelesenZeigen();
    }
    raum = naechsterRaum;
    aktiv = Boolean(status?.active);
    verbunden = Boolean(status?.connected);
    knopf.hidden = false;
    knopf.disabled = false;
    eingabe.disabled = !aktiv;
    senden.disabled = !aktiv || sendet;
    if (!aktiv) {
      ungelesen = 0;
      ungelesenZeigen();
    }
    statusZeigen();
    if (Array.isArray(status?.messages)) {
      for (const nachricht of status.messages) nachrichtHinzufuegen(nachricht, false);
    }
  }

  knopf.addEventListener("click", () => { if (panel.hidden) oeffnen(); else schliessen(); });
  zu.addEventListener("click", schliessen);
  panel.addEventListener("keydown", (ereignis) => {
    if (ereignis.key !== "Escape") return;
    ereignis.preventDefault();
    ereignis.stopPropagation();
    schliessen();
  });
  form.addEventListener("submit", async (ereignis) => {
    ereignis.preventDefault();
    if (sendet || !aktiv) return;
    const nachricht = text(eingabe.value);
    if (!nachricht) return;
    const generation = raumGeneration;
    const entwurf = eingabe.value;
    sendet = true;
    senden.disabled = true;
    statusZeigen();
    try {
      const antwort = await bruecke.chatSenden(nachricht);
      if (generation !== raumGeneration) return;
      if (!antwort?.ok) {
        statusZeigen(text(antwort?.error, 160) || "Nachricht konnte nicht gesendet werden.");
        return;
      }
      if (eingabe.value === entwurf) eingabe.value = "";
      statusZeigen();
    } catch (_) {
      if (generation === raumGeneration) statusZeigen("Nachricht konnte nicht gesendet werden.");
    } finally {
      sendet = false;
      senden.disabled = !aktiv;
      if (generation === raumGeneration && !panel.hidden) eingabe.focus();
    }
  });

  bruecke.aufChat((ereignis) => {
    if (ereignis?.type === "status") statusUebernehmen(ereignis);
    else if (ereignis?.type === "message") {
      const nachrichtenRaum = text(ereignis.room, 160);
      if (!aktiv || !raum || nachrichtenRaum !== raum) return;
      nachrichtHinzufuegen(ereignis.message, true);
    }
  });
  Promise.resolve(bruecke.chatStatus()).then(statusUebernehmen).catch(() => statusZeigen("Chatstatus nicht verfügbar."));

  window.ElfixSpielerChat = { oeffnen, schliessen, istOffen: () => !panel.hidden };
})();
