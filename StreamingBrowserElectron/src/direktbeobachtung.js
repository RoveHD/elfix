"use strict";

const manifest = require("./manifest");
const spur = require("./streamspur");

// Der Hoster kann die Quelle erst per JavaScript erzeugen. Beobachtet wird
// begrenzt und stumm; eine kurze Werbung gilt auch dann nicht als Folge,
// wenn sie vor dem eigentlichen Stream geladen wird.
async function beobachten(umgebung, adresse, referer, signal) {
  const fristSignal = AbortSignal.timeout(umgebung.frist || 20000);
  signal = signal ? AbortSignal.any([signal, fristSignal]) : fristSignal;
  let ansicht = null;
  let beobachtungen = [];
  const geprueft = new Map();
  const ende = Date.now() + (umgebung.frist || 20000);
  const fehlschlag = { ok: false, grund: "Keine spielbare Quelle beobachtet" };
  try {
    if (signal?.aborted) return fehlschlag;
    ansicht = await umgebung.oeffnen(adresse, referer, (eintrag) => {
      if (beobachtungen.length < 400) beobachtungen = spur.aufnehmen(beobachtungen, eintrag);
    });
    const schliessen = () => ansicht?.schliessen();
    signal?.addEventListener("abort", schliessen, { once: true });
    try {
      while (!signal?.aborted && Date.now() < ende) {
        const lage = await ansicht.lesen().catch(() => ({}));
        if (signal?.aborted) break;
        const seite = lage.seite || adresse;
        const origin = new URL(seite).origin;
        const kopfzeilen = { referer: `${origin}/`, origin, "user-agent": umgebung.kennung };
        const kandidaten = beobachtungen.filter((eintrag) =>
          !eintrag.vonWerbung && eintrag.art === "playlist" && /\.m3u8(?:[?#]|$)/i.test(eintrag.adresse));
        for (const kandidat of kandidaten.slice(0, 12)) {
          if (signal?.aborted) break;
          if (!geprueft.has(kandidat.adresse)) {
            geprueft.set(kandidat.adresse,
              await playlistPruefen(umgebung.holen, kandidat.adresse, kopfzeilen, signal).catch(() => 0));
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
        if (wahl.quelle && !signal?.aborted) return {
          ok: true,
          quelle: { adresse: wahl.quelle, typ: wahl.art === "playlist" ? "hls" : "datei", hoehe: 0 },
          kopfzeilen,
          stationen: [adresse],
          seite
        };
        await new Promise((fertig) => {
          const aufAbbruch = () => { clearTimeout(uhr); fertig(); };
          const uhr = setTimeout(() => { signal?.removeEventListener("abort", aufAbbruch); fertig(); }, 400);
          if (signal?.aborted) aufAbbruch();
          else signal?.addEventListener("abort", aufAbbruch, { once: true });
        });
      }
    } finally {
      signal?.removeEventListener("abort", schliessen);
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
