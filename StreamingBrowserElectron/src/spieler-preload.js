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
  folgen: (frisch = false) => ipcRenderer.invoke("spieler:folgen", Boolean(frisch)),
  /** Zu einer anderen Folge. Die Kette dahinter ist dieselbe wie beim Start. */
  wechseln: (url) => ipcRenderer.invoke("spieler:wechseln", String(url || "")),
  /** Ein anderer Hoster fuer dieselbe Folge - an derselben Stelle weiter. */
  hoster: (link, stelle) => ipcRenderer.invoke("spieler:hoster", String(link || ""), Number(stelle) || 0),
  /** Die naechste Folge wird nachgereicht: sie steht erst nach einem Abruf fest. */
  aufNaechste: (rueckruf) => ipcRenderer.on("spieler:naechste", (_ereignis, naechste) => rueckruf(naechste))
});
