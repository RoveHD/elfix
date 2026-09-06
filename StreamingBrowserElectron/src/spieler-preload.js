"use strict";

/*
 * Die Bruecke des eigenen Players.
 *
 * Eine eigene und nicht die der Oberflaeche (preload.js): der Player laeuft in
 * einer eigenen Ansicht und braucht seinen Auftrag, das
 * Melden des Stands, das Nachfragen von Folgen und Hostern und das Zumachen. Alles andere,
 * was die Oberflaeche darf, hat hier nichts zu suchen; die Seite dahinter
 * zeigt eine fremde Videoadresse an, und je kleiner ihre Reichweite ist, desto
 * weniger kann eine kaputte Playlist anrichten.
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("elfixSpieler", {
  /** Der Auftrag: Quelle, Titel, Startzeit. Kommt einmal, kurz nach dem Laden. */
  aufAuftrag: (rueckruf) => ipcRenderer.on("spieler:auftrag", (_ereignis, auftrag) => rueckruf(auftrag)),
  /** Bereit - der Hauptprozess darf den Auftrag schicken. */
  bereit: () => ipcRenderer.send("spieler:bereit"),
  /** Wo der Film steht. Geht im Takt hinaus, nicht bei jedem Bild. */
  stand: (stand) => ipcRenderer.send("spieler:stand", stand),
  /** Etwas ist schiefgegangen - mit Text, den ein Mensch lesen kann. */
  fehler: (text) => ipcRenderer.send("spieler:fehler", String(text || "")),
  /** Zu. `grund` steht danach im Protokoll. */
  schliessen: (grund) => ipcRenderer.send("spieler:schliessen", String(grund || "")),
  /** Vollbild an oder aus - das Fenster gehoert dem Hauptprozess. */
  vollbild: (an) => ipcRenderer.send("spieler:vollbild", Boolean(an)),
  /**
   * Die Staffel- und Folgenliste. Sie kostet einen Seitenaufruf, deshalb wird
   * sie erst geholt, wenn jemand sie aufklappt - und danach gemerkt.
   */
  /*
   * Der Autoplay-Schalter und das einmalige "Danach aufhören".
   *
   * Beide gehen an dieselbe Stelle, die es schon fuer die Anbieterseite gab:
   * die Einstellung gilt dauerhaft, das Aufhoeren nur fuer diese Folge.
   * Zurueck kommt der neue Zaehler, damit der Player nicht raten muss.
   */
  autoplay: (an) => ipcRenderer.invoke("spieler:autoplay", Boolean(an)),
  schlussNachFolge: (an) => ipcRenderer.invoke("spieler:schluss", Boolean(an)),
  // `staffelUrl` waehlt eine andere Staffel; ohne sie gilt die laufende.
  folgen: (frisch = false, staffelUrl = "") =>
    ipcRenderer.invoke("spieler:folgen", Boolean(frisch), String(staffelUrl || "")),
  /** Zu einer anderen Folge. Die Kette dahinter ist dieselbe wie beim Start. */
  wechseln: (url) => ipcRenderer.invoke("spieler:wechseln", String(url || "")),
  /** Ein anderer Hoster fuer dieselbe Folge - an derselben Stelle weiter. */
  hoster: (link, stelle) => ipcRenderer.invoke("spieler:hoster", String(link || ""), Number(stelle) || 0),
  /** Die naechste Folge wird nachgereicht: sie steht erst nach einem Abruf fest. */
  // Der Folgentitel reist mit: er kommt aus derselben Liste wie die naechste
  // Folge, und beides trifft zusammen ein.
  aufNaechste: (rueckruf) =>
    ipcRenderer.on("spieler:naechste", (_ereignis, naechste, folgentitel) => rueckruf(naechste, folgentitel)),
  /**
   * Ein Sprung des Zuschauers. Daraus lernt ELFIX das Intro.
   *
   * `genutzt` heisst: das war der Intro-Knopf selbst. Er darf nicht mitzaehlen,
   * sonst bestaetigt die Marke immer nur sich selbst.
   */
  sprung: (von, nach, genutzt = false) =>
    ipcRenderer.send("spieler:sprung", Number(von) || 0, Number(nach) || 0, Boolean(genutzt)),
  /** Eine frisch gelernte Marke wird nachgereicht. */
  aufMarke: (rueckruf) => ipcRenderer.on("spieler:marke", (_ereignis, marke) => rueckruf(marke)),
  /**
   * Die Watchparty. Drei Dinge, mehr braucht sie nicht:
   * der Takt (wo stehe ich), die eigene Tat (was habe ich getan) und der
   * Befehl der Runde (wohin soll ich).
   */
  takt: (takt) => ipcRenderer.send("spieler:takt", takt),
  aktion: (aktion, stelle) => ipcRenderer.send("spieler:aktion", String(aktion || ""), Number(stelle) || 0),
  aufSteuern: (rueckruf) => ipcRenderer.on("spieler:steuern", (_ereignis, befehl) => rueckruf(befehl)),
  /** Wer sonst noch bei dieser Folge sitzt - Name, Zeichen, Uhr. */
  aufLeiste: (rueckruf) => ipcRenderer.on("spieler:leiste", (_ereignis, leute) => rueckruf(leute))
});
