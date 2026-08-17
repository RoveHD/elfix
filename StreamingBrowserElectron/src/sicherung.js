"use strict";

// Sicherung und Wiederherstellung.
//
// Hinein gehoert genau das, was nicht wiederkommt, wenn es weg ist:
// Einstellungen, Watchlist samt Weiterschauen-Staenden und eigenen Bildern, die
// Watchparty-Ablage und die eigenen Anbieter. Die beiden Zwischenspeicher -
// Filterlisten und Geschmacksprofil - bleiben draussen. Sie sind zusammen
// groesser als alles andere und bauen sich von selbst wieder auf.
//
// Das Modul rechnet nur; Dateien und Dialoge bleiben im Hauptprozess. Dadurch
// laesst sich das Heikle daran - was uebernommen wird und was nicht - ohne
// laufende App pruefen.

const KENNUNG = "elfix-sicherung";
const FASSUNG = 1;

// Eine Sicherung aus dem laufenden Zustand.
//
// Die Geraetekennung bleibt bewusst draussen. Sonst gaebe es nach dem Einlesen
// auf einem zweiten Rechner zwei Geraete mit derselben Kennung, und das Relay
// haelt sie fuer eines - Host-Wahl und Leiste waeren dahin. Ein
// wiederhergestelltes Geraet erkennt das Relay ohnehin am Namen wieder und
// zieht seinen Stand auf die neue Kennung um.
function bauen({ settings, favorites, providers, watchparty, programm } = {}) {
  const einstellungen = settings ? JSON.parse(JSON.stringify(settings)) : null;
  if (einstellungen && einstellungen.watchparty) einstellungen.watchparty.deviceId = "";
  return {
    kennung: KENNUNG,
    fassung: FASSUNG,
    erstellt: new Date().toISOString(),
    programm: String(programm || ""),
    settings: einstellungen,
    favorites: Array.isArray(favorites) ? favorites : [],
    providers: Array.isArray(providers) ? providers : [],
    watchparty: watchparty || null
  };
}

// Ist das ueberhaupt eine Sicherung, und eine, die diese Fassung lesen kann?
function pruefen(daten) {
  if (!daten || typeof daten !== "object") return { ok: false, reason: "Das ist keine ELFIX-Sicherung" };
  if (daten.kennung !== KENNUNG) return { ok: false, reason: "Das ist keine ELFIX-Sicherung" };
  const fassung = Number(daten.fassung);
  if (!Number.isFinite(fassung) || fassung < 1) return { ok: false, reason: "Das ist keine ELFIX-Sicherung" };
  if (fassung > FASSUNG) {
    return { ok: false, reason: "Die Sicherung stammt aus einer neueren Version von ELFIX" };
  }
  return { ok: true };
}

// Wie viel steckt drin? Das steht im Dialog vor dem Einlesen - damit niemand
// eine fast leere Sicherung ueber eine volle Ablage legt, ohne es vorher zu
// sehen.
function umfang(daten) {
  const eintraege = Array.isArray(daten?.favorites) ? daten.favorites : [];
  const zahl = (wert) => (Number.isFinite(Number(wert)) && Number(wert) > 0 ? Number(wert) : 0);
  return {
    favoriten: eintraege.length,
    bilder: eintraege.filter((eintrag) => eintrag && eintrag.customThumbnail).length,
    weiterschauen: eintraege.filter((eintrag) => zahl(eintrag?.position) > 0 || zahl(eintrag?.currentTime) > 0).length,
    anbieter: Array.isArray(daten?.providers) ? daten.providers.length : 0,
    raeume: Array.isArray(daten?.settings?.watchparty?.rooms) ? daten.settings.watchparty.rooms.length : 0,
    einstellungen: Boolean(daten?.settings)
  };
}

// Die Einstellungen, wie sie beim Einlesen gelten sollen: alles aus der
// Sicherung, aber mit der Kennung dieses Rechners. Fehlt hier noch eine, bleibt
// sie leer - dann vergibt die App beim naechsten Verbinden eine neue.
function einstellungenUebernehmen(ausSicherung, eigeneKennung) {
  if (!ausSicherung) return null;
  const uebernommen = JSON.parse(JSON.stringify(ausSicherung));
  uebernommen.watchparty = { ...(uebernommen.watchparty || {}), deviceId: String(eigeneKennung || "") };
  return uebernommen;
}

// Ein Dateiname mit Datum - beim zweiten Mal am selben Tag fragt der Dialog von
// selbst nach dem Ueberschreiben.
function dateiname(jetzt = new Date()) {
  const zwei = (wert) => String(wert).padStart(2, "0");
  return `ELFIX-Sicherung-${jetzt.getFullYear()}-${zwei(jetzt.getMonth() + 1)}-${zwei(jetzt.getDate())}.elfix.json`;
}

module.exports = { KENNUNG, FASSUNG, bauen, pruefen, umfang, einstellungenUebernehmen, dateiname };
