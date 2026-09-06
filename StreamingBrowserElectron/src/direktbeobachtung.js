"use strict";

const manifest = require("./manifest");
const spur = require("./streamspur");

// Der Hoster kann die Quelle erst per JavaScript erzeugen. Beobachtet wird
// begrenzt und stumm; eine kurze Werbung gilt auch dann nicht als Folge,
// wenn sie vor dem eigentlichen Stream geladen wird.
async function beobachten(umgebung, adresse, referer, signal) {
  const externesSignal = signal;
  const frist = umgebung.frist || 20000;
  let fristSignal = AbortSignal.timeout(frist);
  let arbeitsSignal = externesSignal ? AbortSignal.any([externesSignal, fristSignal]) : fristSignal;
  let ansicht = null;
  let beobachtungen = [];
  const geprueft = new Map();
  let ende = Date.now() + frist;
  const fehlschlag = { ok: false, grund: "Keine spielbare Quelle beobachtet" };
  try {
    if (arbeitsSignal.aborted) return fehlschlag;
    ansicht = await umgebung.oeffnen(adresse, referer, (eintrag) => {
      if (beobachtungen.length < 400) beobachtungen = spur.aufnehmen(beobachtungen, eintrag);
    });
    const schliessen = () => ansicht?.schliessen();
    // Nur ein echter Abbruch schliesst die Ansicht. Die kurze Beobachtungsfrist
    // darf waehrend einer sichtbaren Menschpruefung ablaufen: dafuer bekommt
    // der Zuschauer bewusst mehr Zeit, danach beginnt die Beobachtung neu.
    externesSignal?.addEventListener("abort", schliessen, { once: true });
    try {
      while (!arbeitsSignal.aborted && Date.now() < ende) {
        const lage = await ansicht.lesen().catch(() => ({}));
        if (externesSignal?.aborted) break;
        if (lage.menschentor) {
          if (typeof ansicht.bestaetigen !== "function") {
            return { ...fehlschlag, grund: "Bestätigung erforderlich" };
          }
          const bestaetigt = await ansicht.bestaetigen(externesSignal).catch(() => false);
          if (!bestaetigt) {
            return { ...fehlschlag, grund: "Bestätigung nicht abgeschlossen" };
          }
          // Nach der Bestätigung beginnt die eigentliche Beobachtungsfrist.
          // Das alte Fristsignal kann inzwischen abgelaufen sein und darf den
          // frisch freigegebenen Player nicht sofort wieder beenden.
          fristSignal = AbortSignal.timeout(frist);
          arbeitsSignal = externesSignal ? AbortSignal.any([externesSignal, fristSignal]) : fristSignal;
          ende = Date.now() + frist;
          continue;
        }
        const seite = lage.seite || adresse;
        const origin = new URL(seite).origin;
        const kopfzeilen = { referer: `${origin}/`, origin, "user-agent": umgebung.kennung };
        const kandidaten = beobachtungen.filter((eintrag) =>
          !eintrag.vonWerbung && eintrag.art === "playlist" && /\.m3u8(?:[?#]|$)/i.test(eintrag.adresse));
        for (const kandidat of kandidaten.slice(0, 12)) {
          if (arbeitsSignal.aborted) break;
          if (!geprueft.has(kandidat.adresse)) {
            geprueft.set(kandidat.adresse,
              await playlistPruefen(umgebung.holen, kandidat.adresse, kopfzeilen, arbeitsSignal).catch(() => 0));
          }
        }
        const laufzeiten = Object.fromEntries(geprueft);
        const laenge = Number(lage.dauer) || 0;
        const datei = /^https?:/i.test(lage.currentSrc || "") && spur.art(lage.currentSrc) === "datei"
          && laenge >= spur.MINDESTLAUFZEIT_S;
        const brauchbar = beobachtungen.filter((eintrag) => laufzeiten[eintrag.adresse] >= spur.MINDESTLAUFZEIT_S);
        const wahl = spur.waehlen(brauchbar, {
          currentSrc: datei ? lage.currentSrc : "", rahmen: seite, laufzeiten
        });
        if (wahl.quelle && !arbeitsSignal.aborted) return {
          ok: true,
          quelle: { adresse: wahl.quelle, typ: wahl.art === "playlist" ? "hls" : "datei", hoehe: 0 },
          kopfzeilen,
          stationen: [adresse],
          seite
        };
        await new Promise((fertig) => {
          const aufAbbruch = () => { clearTimeout(uhr); fertig(); };
          const uhr = setTimeout(() => { arbeitsSignal.removeEventListener("abort", aufAbbruch); fertig(); }, 400);
          if (arbeitsSignal.aborted) aufAbbruch();
          else arbeitsSignal.addEventListener("abort", aufAbbruch, { once: true });
        });
      }
    } finally {
      externesSignal?.removeEventListener("abort", schliessen);
    }
    return fehlschlag;
  } finally {
    ansicht?.schliessen();
  }
}

async function playlistPruefen(holen, adresse, kopfzeilen, signal) {
  const koepfe = { Referer: kopfzeilen.referer, Origin: kopfzeilen.origin, "User-Agent": kopfzeilen["user-agent"] };
  const lesen = async (url) => {
    const antwort = await holen(url, { headers: koepfe,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000) });
    if (!antwort.ok || Number(antwort.headers?.get("content-length")) > manifest.HOECHSTZEICHEN) return null;
    const text = await antwort.text();
    if (text.length > manifest.HOECHSTZEICHEN) return null;
    return manifest.lesen(text, antwort.url || url);
  };
  let gelesen = await lesen(adresse);
  if (gelesen?.art === "master") {
    const stufe = manifest.besteStufe(gelesen.stufen);
    gelesen = stufe ? await lesen(stufe.adresse) : null;
  }
  return gelesen?.art === "media" && !gelesen.live ? gelesen.laufzeit : 0;
}

module.exports = { beobachten, playlistPruefen };
