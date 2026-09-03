// Die Abkuerzung des Autostarts pruefen - ohne Geraet.
//
// Geprueft wird HOSTERLISTE_STATT_PLAYER_JS aus MainActivity.java: die Frage
// "kann von dieser Seite ueberhaupt noch ein Player kommen, oder ist der Klick
// auf die Hosterliste der naechste Schritt". Ein Fehlurteil faellt in beide
// Richtungen teuer aus - zu frueh geklickt kostet den Klick, den diese Seiten
// gern an ein Popunder verlieren; zu spaet geklickt sind die zwoelf Sekunden
// wieder da, um die es hier geht.
//
// Das Dokument kommt aus schichtprobe/dom.js; mehr DOM als das braucht die
// Probe nicht, und node_modules braucht sie gar nicht.

'use strict';

const fs = require('fs');
const path = require('path');
const { El } = require(path.join(__dirname, '..', 'schichtprobe', 'dom.js'));

const skript = fs.readFileSync(process.argv[2], 'utf8');

const pruefungen = [];
function pruefe(name, bedingung, detail) {
  pruefungen.push(Boolean(bedingung));
  console.log(`${bedingung ? 'OK  ' : 'FAIL'}  ${name}${detail ? '   -> ' + detail : ''}`);
}

/** Das Skript gegen eine nachgebaute Seite laufen lassen und seine Antwort holen. */
function frage(kinder) {
  const wurzel = new El('html');
  const koerper = new El('body');
  wurzel.anhaengen(koerper);
  kinder.forEach((kind) => koerper.anhaengen(kind));

  const alt = global.document;
  global.document = {
    documentElement: wurzel,
    body: koerper,
    querySelector: (a) => wurzel.querySelector(a),
    querySelectorAll: (a) => wurzel.querySelectorAll(a)
  };
  try {
    return (0, eval)(skript);
  } finally {
    global.document = alt;
  }
}

const gross = { width: 710, height: 480 };
const ohne = { width: 0, height: 0 };
const winzig = { width: 1, height: 1 };

function rahmen(rechteck) {
  return new El('iframe', { src: 'https://voe.sx/e/x' }, null, rechteck);
}
function chip(name) {
  return new El('div', { 'data-provider-chip': '', 'data-provider-name': name, text: name },
    null, { width: 120, height: 40 });
}
function linkbox(name) {
  return new El('button', { class: 'link-box', 'data-play-url': '/x', text: name },
    null, { width: 200, height: 48 });
}
function watchEpisode(name) {
  return new El('a', { class: 'watchEpisode', text: name }, null, { width: 200, height: 48 });
}

// --- Wo noch etwas kommen kann: nicht abkuerzen -------------------------------

pruefe('AniWorld mit eingebettetem Player kuerzt nicht ab',
  frage([rahmen(gross), watchEpisode('VOE'), watchEpisode('Vidmoly')]) === '',
  'der Player ist da - diese Probe wird dort gar nicht erst gefragt');

pruefe('Ein Rahmen, der schon Player-Groesse annimmt, laesst weiter warten',
  frage([rahmen({ width: 320, height: 180 }), watchEpisode('VOE')]) === '',
  'die Seite baut gerade');

pruefe('Ein Rahmen knapp ueber der Schwelle laesst weiter warten',
  frage([rahmen({ width: 120, height: 80 }), chip('VOE')]) === '',
  '120x80 ist die Schwelle');

pruefe('Eine leere Seite kuerzt nicht ab',
  frage([]) === '',
  'ohne Hosterliste gibt es nichts anzuklicken');

pruefe('Eine Seite ohne Player und ohne Liste kuerzt nicht ab',
  frage([new El('div', { text: 'wird geladen' })]) === '');

pruefe('Eine unsichtbare Hosterliste zaehlt nicht',
  frage([new El('div', { 'data-provider-chip': '', text: 'VOE' }, null, ohne)]) === '',
  'was keine Flaeche hat, kann niemand klicken');

// --- Wo nichts mehr kommt: abkuerzen -----------------------------------------

pruefe('Filmo vor dem Klick kuerzt ab',
  frage([
    new El('div', { 'data-provider-frame': '' }, { display: 'none' }, ohne),
    chip('VOE'), chip('Vidoza')
  ]) === 'chips',
  'der Rahmen steht auf d-none, bis ein Chip geklickt wurde');

pruefe('s.to ohne eingebetteten Player kuerzt ab',
  frage([linkbox('VOE'), linkbox('Streamtape')]) === 'linkbox');

pruefe('AniWorld ohne eingebetteten Player kuerzt ab',
  frage([watchEpisode('VOE')]) === 'watchepisode',
  'dann ist der Klick der naechste Schritt und nicht der Rueckfall');

// --- Der Fall, der die Schwelle noetig gemacht hat ----------------------------

pruefe('Ein Zaehlpixel verstellt die Abkuerzung nicht',
  frage([rahmen(winzig), chip('VOE')]) === 'chips',
  'ein 1x1-Rahmen ist kein Player im Aufbau');

pruefe('Auch mehrere Zaehlpixel nicht',
  frage([rahmen(winzig), rahmen(winzig), rahmen({ width: 2, height: 2 }), linkbox('VOE')]) === 'linkbox');

// --- Und ein laufendes Video zaehlt genauso wie ein Rahmen --------------------

pruefe('Ein laufendes Video laesst weiter warten',
  frage([new El('video', {}, null, gross), chip('VOE')]) === '',
  'der Hoster ist die Seite geworden');

const fehler = pruefungen.filter((ok) => !ok).length;
console.log(`\n${pruefungen.length - fehler}/${pruefungen.length} bestanden`);
process.exit(fehler ? 1 : 0);
