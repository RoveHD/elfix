// Die Schicht ueber dem Video - gegen ein nachgebautes Dokument.
//
// Das Rahmenskript aus Werbeschichten.java ist die eine Aenderung, die den
// Player kosten kann: es laeuft im Dokument des Hosters, und dort steht das
// Video. Ein Fehlurteil faellt dem Benutzer nicht als Werbung auf, sondern als
// schwarzes Bild. Deshalb stehen hier beide Haelften - die Werbung, die
// verschwinden muss, und der Player, der bleiben muss.
//
// Gemessen wurden die beiden Faelle am 2.9.2026 auf dem Fernseher:
//   1. ein Kasten neben dem laufenden Film: "Herzlichen Glueckwunsch!", 00:22,
//      "Fordern Sie Ihren Bonus an!"
//   2. eine Flaeche ueber dem Film: "BESTAETIGEN SIE, DASS SIE KEIN ROBOTER
//      SIND", ein nachgemaltes reCAPTCHA, "Weiter"
//
// Aufruf: android/schichtprobe/lauf.sh

'use strict';

var fs = require('fs');
var { El, lauf } = require('./dom.js');

var skript = fs.readFileSync(process.argv[2], 'utf8');
var gesamt = 0;
var fehler = 0;

function pruefe(name, erwartet, bekommen) {
  gesamt += 1;
  var ok = erwartet === bekommen;
  if (!ok) fehler += 1;
  console.log((ok ? 'OK   ' : 'FAIL ') + name
    + (ok ? '' : '  (erwartet ' + erwartet + ', bekommen ' + bekommen + ')'));
}

var VORN = { position: 'fixed', zIndex: '2147483647' };
var GROSS = { width: 1280, height: 720 };

function video() {
  return new El('video', {}, {}, GROSS);
}

/* -------------------------------------------------- 1. Der Gluecksspielkasten */
(function () {
  var karte = new El('div', { class: 'x7f2', text: 'Herzlichen Glueckwunsch! 00:22 Fordern Sie Ihren Bonus an!' },
    VORN, { width: 420, height: 260 });
  var spieler = new El('div', { class: 'player-wrap' }, { position: 'absolute', zIndex: '1000' }, GROSS);
  spieler.anhaengen(video());
  var leiste = new El('div', { class: 'controls', text: 'Abspielen Pause 00:22 / 45:10 Vollbild' },
    VORN, { width: 1280, height: 60 });

  lauf(skript, 'nicolehappyoutside.com', [spieler, karte, leiste]);
  pruefe('Gluecksspielkasten neben dem Film ist weg', true, karte.entfernt());
  pruefe('der Player bleibt', false, spieler.entfernt());
  pruefe('die Bedienleiste des Players bleibt', false, leiste.entfernt());
})();

/* ------------------------------------------------------ 2. Die falsche Pruefung */
(function () {
  // Im eigenen Dokument des Werbestuecks: kein Video, nichts positioniert.
  var karte = new El('div', { class: 'captcha-box',
    text: 'BESTAETIGEN SIE, DASS SIE KEIN ROBOTER SIND Klicken Sie auf die Schaltflaeche I\'m not a robot Weiter' },
    {}, { width: 520, height: 420 });
  var welt = lauf(skript, 'cdn.werbenetz-xy.com', [karte]);
  pruefe('das falsche Captcha ist weg', true, karte.entfernt());
  // Sein Fenster bleibt als Flaeche stehen und wuerde weiter Klicks fangen.
  pruefe('das leere Fenster faengt keine Klicks mehr', 'none',
    welt.wurzel.style.gesetzt['pointer-events']);
  pruefe('sein Name "captcha-box" schuetzt es nicht', true, karte.entfernt());
})();

/* ------------------------------------------------------- 3. Die echte Pruefung */
(function () {
  var echt = new El('div', { class: 'g-recaptcha captcha', text: 'Ich bin kein Roboter' },
    VORN, { width: 300, height: 78 });
  echt.anhaengen(new El('iframe',
    { src: 'https://www.google.com/recaptcha/api2/anchor?k=6Lc', title: 'reCAPTCHA' }));
  lauf(skript, 'cloudflare-geschuetzt.example', [echt]);
  pruefe('ein echtes reCAPTCHA bleibt stehen', false, echt.entfernt());

  var turnstile = new El('div', { class: 'cf-turnstile', text: 'Bestaetigen Sie, dass Sie kein Roboter sind' },
    VORN, { width: 300, height: 65 });
  turnstile.anhaengen(new El('iframe', { src: 'https://challenges.cloudflare.com/cdn-cgi/challenge' }));
  lauf(skript, 'irgendein-hoster.example', [turnstile]);
  pruefe('ein echtes Turnstile bleibt stehen', false, turnstile.entfernt());
})();

/* ------------------------------------------- 4. Das fremde Fenster ueber dem Video */
(function () {
  var spieler = new El('div', { class: 'wrap' }, {}, GROSS);
  spieler.anhaengen(video());
  var werbung = new El('iframe', { src: 'https://cdn.redgarto-neu.com/sb/x/index.html' },
    VORN, { width: 420, height: 170 });
  var eigenes = new El('iframe', { src: 'https://voe.sx/teile/leiste.html' },
    VORN, { width: 420, height: 170 });
  lauf(skript, 'voe.sx', [spieler, werbung, eigenes]);
  pruefe('das fremde Fenster ueber dem Video ist weg', true, werbung.entfernt());
  pruefe('ein Fenster vom eigenen Wirt bleibt', false, eigenes.entfernt());
})();

/* ------------------------- 5. Die Zwischenseite der Kette traegt kein eigenes Video */
(function () {
  // voe.sx -> nicolehappyoutside.com: die Seite, die den Player erst einbettet.
  // Ihr Rahmen ist der Player und darf nie fallen.
  var player = new El('iframe', { src: 'https://nicolehappyoutside.com/e/abc123' },
    VORN, { width: 1280, height: 720 });
  lauf(skript, 'voe.sx', [player]);
  pruefe('der eingebettete Player einer Zwischenseite bleibt', false, player.entfernt());
})();

/* ---------------------------------------------- 6. Die Seite des Anbieters selbst */
(function () {
  var karte = new El('div', { text: 'Fordern Sie Ihren Bonus an!' }, VORN, { width: 420, height: 260 });
  var welt = lauf(skript, 'aniworld.to', [karte]);
  // Dort arbeitet das volle Skript; zwei Urteile ueber dasselbe Element waeren
  // eines zu viel.
  pruefe('im Dokument des Anbieters haelt sich das Rahmenskript heraus',
    undefined, welt.fenster.__elfixSchichtStand);
  pruefe('und faesst dort nichts an', false, karte.entfernt());
})();

/* ------------------------------------------------------ 7. Was kein Lockruf ist */
(function () {
  var spieler = new El('div', {}, {}, GROSS);
  spieler.anhaengen(video());
  var hinweis = new El('div', { text: 'Naechste Folge in 00:22' }, VORN, { width: 420, height: 120 });
  var wahl = new El('div', { class: 'quality', text: 'Qualitaet: 1080p 720p 480p' },
    VORN, { width: 200, height: 160 });
  lauf(skript, 'nicolehappyoutside.com', [spieler, hinweis, wahl]);
  pruefe('"Naechste Folge in 00:22" bleibt', false, hinweis.entfernt());
  pruefe('die Qualitaetswahl bleibt', false, wahl.entfernt());
})();

/* ------------------------------- 8. Das quellenlose Fenster ueber dem Video */
//
// Gemessen am 3.9.2026 auf dem Telefon, Filmo -> VOE: der Gluecksspielkasten
// stand nicht im Dokument des Players, sondern in einem eigenen daneben -
// einem iframe ohne src, fixed, z-index 2147483647, 832x384 am BODY des
// Players, also genau bildschirmgross. Sein Inhalt bekam kein Startskript
// (dort war __elfixSchichtV1 false, im Player daneben true), und
// fremderRahmen() sah ihn nicht, weil es eine Quelle verlangt.
(function () {
  var spieler = new El('div', {}, {}, GROSS);
  spieler.anhaengen(video());
  // Genau die gemessene Groesse: bildschirmgross. Die Ausnahme fuer
  // Vollbildhuellen im vollen Skript haette ihn hier stehen lassen.
  var werbung = new El('iframe', {}, VORN, GROSS);
  lauf(skript, 'tracylocalschool.com', [spieler, werbung]);
  pruefe('das quellenlose Fenster ueber dem Video ist weg', true, werbung.entfernt());

  // Und die Falle: eine Vollbildhuelle sieht genauso aus - nur enthaelt sie
  // das Video, statt darauf zu liegen.
  var huelle = new El('iframe', {}, VORN, GROSS);
  huelle.anhaengen(video());
  lauf(skript, 'tracylocalschool.com', [huelle]);
  pruefe('eine Huelle, die das Video enthaelt, bleibt', false, huelle.entfernt());

  // about:blank und javascript: zaehlen wie "ohne Quelle" - dieselbe
  // Bestimmung wie im vollen Skript.
  var leer = new El('iframe', { src: 'about:blank' }, VORN, { width: 420, height: 260 });
  var spieler2 = new El('div', {}, {}, GROSS);
  spieler2.anhaengen(video());
  lauf(skript, 'tracylocalschool.com', [spieler2, leer]);
  pruefe('ein about:blank-Fenster ueber dem Video ist weg', true, leer.entfernt());

  // Ohne Video gibt es keine Schicht "ueber dem Video".
  var ohneVideo = new El('iframe', {}, VORN, { width: 420, height: 260 });
  lauf(skript, 'tracylocalschool.com', [ohneVideo]);
  pruefe('ohne Video bleibt ein quellenloses Fenster unangetastet', false, ohneVideo.entfernt());

  // Im Textfluss ist es keine Schicht, sondern Inhalt.
  var imFluss = new El('iframe', {}, { position: 'static' }, { width: 420, height: 260 });
  var spieler3 = new El('div', {}, {}, GROSS);
  spieler3.anhaengen(video());
  lauf(skript, 'tracylocalschool.com', [spieler3, imFluss]);
  pruefe('ein quellenloses Fenster im Textfluss bleibt', false, imFluss.entfernt());

  // Und ein srcdoc-Fenster bringt seinen Inhalt mit; das ist kein leerer
  // Rahmen, den ein Skript von aussen gefuellt hat.
  var mitInhalt = new El('iframe', { srcdoc: '<p>hallo</p>' }, VORN, { width: 420, height: 260 });
  var spieler4 = new El('div', {}, {}, GROSS);
  spieler4.anhaengen(video());
  lauf(skript, 'tracylocalschool.com', [spieler4, mitInhalt]);
  pruefe('ein srcdoc-Fenster bleibt', false, mitInhalt.entfernt());
})();

console.log('');
console.log(fehler === 0 ? ('alle ' + gesamt + ' Pruefungen bestanden')
  : (fehler + ' von ' + gesamt + ' Pruefungen fehlgeschlagen'));
process.exit(fehler === 0 ? 0 : 1);
