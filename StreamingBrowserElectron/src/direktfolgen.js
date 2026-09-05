"use strict";

/*
 * Die Folgenliste, wie der Player sie braucht.
 *
 * Gelesen wird sie aus der Anbieterseite (seitendaten.uebersichtSkript), und
 * was dabei herauskommt, ist die Sicht des Anbieters: eine Reihe Eintraege mit
 * Staffel, Nummer, Adresse und dem Vermerk, ob dahinter ueberhaupt eine eigene
 * Folge liegt. Was der Player daraus macht - welche gerade laeuft, welche als
 * naechste kommt, wie sie beschriftet wird -, steht hier.
 *
 * <h2>Warum das ein eigenes Modul ist</h2>
 *
 * Weil es die Stelle ist, an der man sich vertut. "Nummer plus eins" sieht
 * richtig aus und ist es nicht: es gibt Staffeln mit Luecken, es gibt Nummern,
 * hinter denen nur der Hinweis auf eine Doppelfolge steht, und es gibt das Ende
 * einer Staffel, nach dem die naechste anfaengt. Jeder dieser Faelle ist eine
 * eigene Zeile in tests/direktfolgentest.js - und keiner davon laesst sich am
 * laufenden Player nachstellen, ohne eine Serie zu Ende zu schauen.
 */

/** Eine Folge, auf die man wirklich springen kann. */
function spielbar(eintrag) {
  return Boolean(eintrag && eintrag.url && !eintrag.gesperrt);
}

/** Die Reihenfolge, in der geschaut wird: nach Staffel, dann nach Nummer. */
function geordnet(folgen) {
  return (Array.isArray(folgen) ? folgen : [])
    .filter((eintrag) => eintrag && Number.isFinite(Number(eintrag.folge)))
    .slice()
    .sort((links, rechts) => (Number(links.staffel) - Number(rechts.staffel))
      || (Number(links.folge) - Number(rechts.folge)));
}

/** Ist dieser Eintrag die Folge, die gerade laeuft? */
function istLaufende(eintrag, jetzt) {
  if (!eintrag || !jetzt) return false;
  return Number(eintrag.staffel) === Number(jetzt.season)
    && Number(eintrag.folge) === Number(jetzt.episode);
}

/**
 * Die Folge nach dieser.
 *
 * Genommen wird der naechste *spielbare* Eintrag der geordneten Liste - damit
 * stimmt es auch dann, wenn eine Nummer fehlt oder gesperrt ist, und es geht
 * ueber das Staffelende hinweg weiter, weil die Liste beide Staffeln kennt.
 *
 * Steht die laufende Folge gar nicht in der Liste (das kommt vor: eine Folge,
 * die der Anbieter aus der Uebersicht genommen hat), gibt es keine naechste.
 * Raten waere hier besonders teuer - der Uebergang laeuft von selbst, und wer
 * dabei in einer fremden Serie landet, merkt es erst nach dem Vorspann.
 */
function naechste(stand, jetzt) {
  if (!stand || !jetzt) return null;
  const liste = geordnet(stand.folgen).filter(spielbar);
  const stelle = liste.findIndex((eintrag) => istLaufende(eintrag, jetzt));
  if (stelle < 0 || stelle + 1 >= liste.length) return null;
  return liste[stelle + 1];
}

/**
 * Wie eine Folge beschriftet wird.
 *
 * Nummer zuerst, Titel dahinter: die Nummer steht immer, der Titel nur, wenn
 * der Anbieter einen fuehrt. Geraten wird keiner - "Folge 12" ist eine
 * Auskunft, ein erfundener Titel waere eine Behauptung.
 */
function beschriftung(eintrag) {
  if (!eintrag) return "";
  const nummer = Number(eintrag.staffel) > 0
    ? `S${Number(eintrag.staffel)} F${Number(eintrag.folge)}`
    : `Folge ${Number(eintrag.folge)}`;
  const titel = String(eintrag.titel || "").trim();
  return titel ? `${nummer} · ${titel}` : nummer;
}

/**
 * Die Liste, wie sie zum Player geht.
 *
 * Beschnitten auf das, was dort gebraucht wird, und um eine Angabe erweitert:
 * welcher Eintrag gerade laeuft. Die Rechnung dafuer gibt es genau einmal, und
 * sie steht hier - der Player soll aus einer Adresse keine Nummer rechnen
 * muessen.
 */
function fuerPlayer(stand, jetzt) {
  if (!stand) return null;
  return {
    titel: String(stand.titel || ""),
    folgen: geordnet(stand.folgen).map((eintrag) => ({
      staffel: Number(eintrag.staffel) || 0,
      folge: Number(eintrag.folge) || 0,
      url: String(eintrag.url || ""),
      titel: String(eintrag.titel || ""),
      gesperrt: !spielbar(eintrag),
      laeuft: istLaufende(eintrag, jetzt)
    }))
  };
}

module.exports = { naechste, beschriftung, fuerPlayer, geordnet, spielbar, istLaufende };
