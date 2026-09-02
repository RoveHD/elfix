// Ein Dokument, klein genug zum Nachlesen.
//
// Nur so viel DOM, wie das Rahmenskript anfasst: Auswahl nach Namen und nach
// Attribut, ein berechneter Stil, ein Rechteck. Bewusst kein jsdom - die Probe
// soll ohne Netz und ohne node_modules laufen, und was sie prueft, sind die
// Entscheidungen des Skripts und nicht die Vollstaendigkeit einer DOM-Fassung.

'use strict';

function teile(auswahl) {
  return String(auswahl || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}

// Unterstuetzt: tag, [attr], [attr*="wert"], [attr^="wert"], .klasse, #kennung
function einzelPasst(el, teil) {
  var m = teil.match(/^([a-zA-Z][a-zA-Z0-9]*)?(.*)$/);
  var tag = m[1];
  var rest = m[2] || '';
  if (tag && el.tagName !== tag.toUpperCase()) return false;
  var re = /\[([a-zA-Z-]+)(?:([*^$]?)=\"([^\"]*)\")?\]|\.([a-zA-Z0-9_-]+)|#([a-zA-Z0-9_-]+)/g;
  var treffer;
  while ((treffer = re.exec(rest)) !== null) {
    if (treffer[1]) {
      var wert = el.getAttribute(treffer[1]);
      if (wert === null) return false;
      if (treffer[3] !== undefined) {
        if (treffer[2] === '*' && wert.indexOf(treffer[3]) < 0) return false;
        if (treffer[2] === '^' && wert.indexOf(treffer[3]) !== 0) return false;
        if (treffer[2] === '' && wert !== treffer[3]) return false;
      }
    } else if (treffer[4]) {
      if ((el.getAttribute('class') || '').split(/\s+/).indexOf(treffer[4]) < 0) return false;
    } else if (treffer[5]) {
      if (el.getAttribute('id') !== treffer[5]) return false;
    }
  }
  return true;
}

function passtAuf(el, auswahl) {
  var liste = teile(auswahl);
  for (var i = 0; i < liste.length; i++) if (einzelPasst(el, liste[i])) return true;
  return false;
}

function El(tag, attribute, stil, rechteck) {
  this.tagName = String(tag).toUpperCase();
  this.nodeType = 1;
  this.attribute = Object.assign({}, attribute || {});
  this.children = [];
  this.parentElement = null;
  this.eigenerText = this.attribute.text || '';
  delete this.attribute.text;
  this.rechteck = rechteck || { width: 300, height: 200 };
  var eigen = {};
  this.berechnet = Object.assign(
    { display: 'block', visibility: 'visible', opacity: '1', position: 'static', zIndex: 'auto' },
    stil || {});
  var selbst = this;
  this.style = {
    setProperty: function (name, wert) {
      eigen[name] = wert;
      if (name === 'display') selbst.berechnet.display = wert;
      if (name === 'pointer-events') selbst.berechnet.pointerEvents = wert;
    },
    gesetzt: eigen
  };
}

El.prototype.anhaengen = function (kind) {
  kind.parentElement = this;
  this.children.push(kind);
  return this;
};
El.prototype.getAttribute = function (name) {
  return Object.prototype.hasOwnProperty.call(this.attribute, name) ? this.attribute[name] : null;
};
El.prototype.setAttribute = function (name, wert) { this.attribute[name] = String(wert); };
El.prototype.hasAttribute = function (name) {
  return Object.prototype.hasOwnProperty.call(this.attribute, name);
};
El.prototype.matches = function (auswahl) { return passtAuf(this, auswahl); };
El.prototype.alle = function () {
  var liste = [];
  (function sammeln(el) {
    for (var i = 0; i < el.children.length; i++) { liste.push(el.children[i]); sammeln(el.children[i]); }
  })(this);
  return liste;
};
El.prototype.querySelector = function (auswahl) {
  var alle = this.alle();
  for (var i = 0; i < alle.length; i++) if (passtAuf(alle[i], auswahl)) return alle[i];
  return null;
};
El.prototype.querySelectorAll = function (auswahl) {
  return this.alle().filter(function (el) { return passtAuf(el, auswahl); });
};
El.prototype.contains = function (anderer) {
  if (this === anderer) return true;
  return this.alle().indexOf(anderer) >= 0;
};
Object.defineProperty(El.prototype, 'innerText', {
  get: function () {
    if (this.berechnet.display === 'none' || this.berechnet.visibility === 'hidden') return '';
    var text = this.eigenerText;
    for (var i = 0; i < this.children.length; i++) text += ' ' + this.children[i].innerText;
    return text.trim();
  }
});
Object.defineProperty(El.prototype, 'textContent', {
  get: function () {
    var text = this.eigenerText;
    for (var i = 0; i < this.children.length; i++) text += ' ' + this.children[i].textContent;
    return text.trim();
  }
});
El.prototype.getBoundingClientRect = function () { return this.rechteck; };
El.prototype.entfernt = function () { return this.hasAttribute('data-elfix-schicht'); };

/** Baut die Umgebung, in der ein Skript laufen kann, und laesst es laufen. */
function lauf(skript, wirt, body) {
  var wurzel = new El('html');
  var koerper = new El('body');
  wurzel.anhaengen(koerper);
  body.forEach(function (el) { koerper.anhaengen(el); });

  var dokument = {
    documentElement: wurzel,
    body: koerper,
    readyState: 'complete',
    addEventListener: function () {},
    querySelector: function (a) { return wurzel.querySelector(a); },
    querySelectorAll: function (a) { return wurzel.querySelectorAll(a); }
  };
  var fenster = {};
  var alt = {
    window: global.window, document: global.document, location: global.location,
    getComputedStyle: global.getComputedStyle, MutationObserver: global.MutationObserver,
    console: global.console, setTimeout: global.setTimeout
  };
  global.window = fenster;
  global.document = dokument;
  global.location = { hostname: wirt, href: 'https://' + wirt + '/' };
  global.getComputedStyle = function (el) { return el && el.berechnet; };
  global.MutationObserver = function () { this.observe = function () {}; this.disconnect = function () {}; };
  global.console = { log: function () {} };
  // Die beiden Nachschauen des Skripts laufen hier nicht: sie wuerden in eine
  // Umgebung fallen, die es dann nicht mehr gibt. Geprueft wird der erste Lauf.
  global.setTimeout = function () { return 0; };
  try {
    (0, eval)(skript);
  } finally {
    Object.keys(alt).forEach(function (name) { global[name] = alt[name]; });
  }
  return { wurzel: wurzel, body: koerper, fenster: fenster };
}

module.exports = { El: El, lauf: lauf };
