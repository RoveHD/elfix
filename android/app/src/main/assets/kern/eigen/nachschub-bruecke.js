"use strict";

/*
 * Nachschub auf dem Telefon - die Verkabelung, nicht die Entscheidung.
 *
 * Die Entscheidung steht in `nachschub.js`, demselben Modul, das der Rechner
 * fragt: welche Titel ein Durchgang ansieht, was aus den Seiten zu lesen ist
 * und ob daraus eine Reaktivierung folgt. Die Parser darunter liegen ohnehin
 * schon im gemeinsamen `discover.js`, die Folgenrechnung in `fortschritt.js`.
 *
 * Was hier steht, ist genau das, was auf beiden Geraeten verschieden ist: der
 * Abruf. Er laeuft wie beim Kalender und beim Empfehlungslauf ueber Java
 * (siehe kern-host.js). Das ist kein Umweg, sondern Voraussetzung - die
 * Serien- und Staffelseiten liegen hinter demselben Cloudflare-Schutz wie der
 * Rest des Anbieters, und die Kekse der laufenden Sitzung hat nur Java.
 *
 * Warum es diese Datei ueberhaupt gibt: bis hierher stand der ganze Vorgang in
 * `main.js`, also an einem Ort, den das Telefon nie sieht. "Black Torch" war am
 * Samstag mit Folge 9 da, und am Fernseher blieb der Titel archiviert, bis
 * irgendwann jemand den PC einschaltete. Das ist keine Kleinigkeit: fuer wen
 * der Fernseher das einzige Geraet ist, kam der Nachschub nie an.
 */
(function () {
  const nachschub = require("nachschub");

  function melde(stufe, text) {
    const brief = window.AndroidKern;
    if (brief && typeof brief.protokoll === "function") brief.protokoll(stufe, text);
  }

  const lauf = nachschub.erstellen({
    holen: async (url) => {
      try {
        const antwort = await fetch(url, {
          headers: { accept: "text/html,application/xhtml+xml" }
        });
        if (!antwort || !antwort.ok) return null;
        return { html: await antwort.text(), url: antwort.url || url };
      } catch (fehler) {
        // Kein Netz, Zeitueberschreitung, eine Seite, die 403 antwortet: alles
        // dasselbe. Der Lauf behandelt es als "keine Antwort" und laesst den
        // Eintrag unangetastet - genau das ist hier die richtige Vorsicht.
        return null;
      }
    },
    protokoll: (zeile) => melde("info", "Nachschub " + zeile)
  });

  /**
   * Einen Durchgang fahren.
   *
   * <p>Herein kommt die Ablage, heraus kommt sie zurueck - dieselbe Form wie
   * bei `watchparty-bruecke.raumEintraegeSichern`. Java haelt die Liste, der
   * Kern rechnet auf ihr; ein zweiter Bestand auf der JS-Seite waere ein
   * zweiter Bestand, der auseinanderlaufen kann.
   *
   * <p>Zurueck geht ausserdem, was in *diesem* Durchgang neu dazugekommen ist,
   * und zwar in der Form, die Java dafuer braucht: die Kennung (um den Eintrag
   * wiederzufinden), der Hinweistext (fuer die Meldung) und der Raum (um den
   * Fund an die Runde zu melden, wenn der Titel zu einer gehoert).
   *
   * @param zustand    {{favoriten: Array}} die eigene Ablage
   * @param hoechstens wie viele Titel dieser Durchgang ansieht
   * @returns {{favoriten, geaendert, geprueft, gefunden}}
   */
  async function lauf1(zustand, hoechstens) {
    const favoriten = (zustand && zustand.favoriten) || [];
    const ergebnis = await lauf.lauf(favoriten, Number(hoechstens) || nachschub.PRO_LAUF);
    return {
      favoriten,
      geaendert: Boolean(ergebnis.geaendert),
      geprueft: ergebnis.geprueft.length,
      gefunden: ergebnis.gefunden.map((eintrag) => ({
        id: String(eintrag.id || ""),
        titel: String(eintrag.title || ""),
        label: String(eintrag.newEpisodeLabel || ""),
        url: String(eintrag.url || ""),
        // Leer heisst: der Titel gehoert niemandem sonst. Steht hier ein Raum,
        // muss Java den Stand melden - sonst weiss nur dieses Geraet, dass der
        // archivierte Raumtitel wieder aktiv ist.
        raum: String(eintrag.watchpartyRoom || "")
      }))
    };
  }

  module.exports = {
    lauf: lauf1,
    // Fuer die Pruefungen und fuer die Ablaufsteuerung in Java: dieselben
    // Zahlen wie am Rechner, und zwar aus derselben Quelle.
    PRO_LAUF: nachschub.PRO_LAUF,
    INTERVALL_MS: nachschub.INTERVALL_MS
  };
}());
