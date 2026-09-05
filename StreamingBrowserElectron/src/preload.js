const { contextBridge, ipcRenderer } = require("electron");
// Der kanonische Schluessel eines Werks. Die Oberflaeche braucht ihn beim
// Zeichnen und kann kein Modul laden; ihn dort abzuschreiben waere die fuenfte
// Antwort auf "welcher Titel ist das?" gewesen - und genau davon kamen die
// doppelten Watchlist-Eintraege. Also geht die eine Antwort hier hinaus.
const watchlist = require("./watchlist");

contextBridge.exposeInMainWorld("streamingBrowser", {
  init: () => ipcRenderer.invoke("app:init"),
  showHome: () => ipcRenderer.invoke("app:show-home"),
  setBrowserBounds: (bounds) => ipcRenderer.invoke("layout:set-browser-bounds", bounds),
  setSettingsOpen: (isOpen) => ipcRenderer.invoke("settings:set-open", isOpen),
  setShellOpen: (isOpen) => ipcRenderer.invoke("shell:set-open", isOpen),
  openProvider: (id) => ipcRenderer.invoke("provider:open", id),
  openProviderSearch: (id, query) => ipcRenderer.invoke("provider:search", id, query),
  openProviderUrl: (id, url) => ipcRenderer.invoke("provider:navigate", id, url),
  searchAll: (query) => ipcRenderer.invoke("search:all", query),
  loadCalendar: (refresh = false) => ipcRenderer.invoke("calendar:load", refresh),
  getRecommendations: (options = {}) => ipcRenderer.invoke("discover:recommendations", options),
  getPersonalRecommendations: (options = {}) => ipcRenderer.invoke("discover:personal", options),
  onPersonalUpdated: (callback) => ipcRenderer.on("discover:personal-updated", () => callback()),
  getPersonalPage: (options = {}) => ipcRenderer.invoke("discover:personal-page", options),
  getWatchpartyStatus: () => ipcRenderer.invoke("watchparty:status"),
  getWatchpartyItems: () => ipcRenderer.invoke("watchparty:items"),
  openWatchpartyItem: (key, room) => ipcRenderer.invoke("watchparty:open", key, room),
  getWatchpartyRooms: () => ipcRenderer.invoke("watchparty:rooms"),
  // Die Statusseite des Relays im richtigen Browser. Ohne Adresse von hier -
  // sie steht in den Einstellungen und wird drueben gebildet.
  openRelayStatus: () => ipcRenderer.invoke("watchparty:statusseite"),
  shareCurrentToWatchparty: (room, punkt) => ipcRenderer.invoke("watchparty:share-current", room, punkt),
  enterWatchparty: (key, room) => ipcRenderer.invoke("watchparty:enter", key, room),
  leaveWatchparty: (key, room) => ipcRenderer.invoke("watchparty:leave", key, room),
  removeFromWatchparty: (key, room) => ipcRenderer.invoke("watchparty:remove", key, room),
  toggleWatchpartyLive: (key, an, room) => ipcRenderer.invoke("watchparty:live-toggle", key, an, room),
  chooseWatchpartyRoom: (rooms, punkt) => ipcRenderer.invoke("watchparty:choose-room", rooms, punkt),
  switchWatchpartyContext: (punkt) => ipcRenderer.invoke("watchparty:switch-context", punkt),
  resyncWatchparty: (key, room) => ipcRenderer.invoke("watchparty:resync", key, room),
  kickFromWatchparty: (key, memberId, room) => ipcRenderer.invoke("watchparty:kick", key, memberId, room),
  onWatchpartyState: (callback) => ipcRenderer.on("watchparty:state", (_event, state) => callback(state)),
  // Meine Geraete: der Abgleich zwischen den Geraeten einer Person.
  getGeraeteStatus: () => ipcRenderer.invoke("geraete:status"),
  createGeraeteSchluessel: () => ipcRenderer.invoke("geraete:schluessel-erzeugen"),
  setGeraeteSchluessel: (wert) => ipcRenderer.invoke("geraete:schluessel-setzen", wert),
  disconnectGeraete: () => ipcRenderer.invoke("geraete:trennen"),
  syncGeraeteNow: () => ipcRenderer.invoke("geraete:jetzt-abgleichen"),
  onGeraeteState: (callback) => ipcRenderer.on("geraete:state", (_event, state) => callback(state)),
  onWatchpartyItems: (callback) => ipcRenderer.on("watchparty:items", (_event, items) => callback(items)),
  chooseWatchpartyMember: (kandidaten, punkt) => ipcRenderer.invoke("watchparty:choose-member", kandidaten, punkt),
  handoverWatchpartyHost: (key, memberId, room) => ipcRenderer.invoke("watchparty:handover", key, memberId, room),
  onWatchpartyLive: (callback) => ipcRenderer.on("watchparty:live", (_event, info) => callback(info)),
  onWatchpartyWatchstate: (callback) => ipcRenderer.on("watchparty:watchstate", (_event, info) => callback(info)),
  // Die YouTube-Watchparty. Eigener Modus, eigene Kanaele - nichts davon geht
  // durch die Steuerung der Watchparty fuer Serien.
  getYoutubePartyStatus: () => ipcRenderer.invoke("youtubeparty:status"),
  setYoutubePartyRoom: (room) => ipcRenderer.invoke("youtubeparty:set-room", room),
  resyncYoutubeParty: () => ipcRenderer.invoke("youtubeparty:resync"),
  switchYoutubePartyContext: (punkt) => ipcRenderer.invoke("youtubeparty:switch-context", punkt),
  openYoutubeParty: () => ipcRenderer.invoke("youtubeparty:open"),
  onYoutubePartyState: (callback) => ipcRenderer.on("youtubeparty:state", (_event, state) => callback(state)),
  navigate: (input) => ipcRenderer.invoke("browser:navigate", input),
  browserCommand: (command) => ipcRenderer.invoke("browser:command", command),
  toggleCurrentFavorite: () => ipcRenderer.invoke("favorites:toggle-current"),
  removeFavorite: (id) => ipcRenderer.invoke("favorites:remove", id),
  // Rein rechnend, ohne Hauptprozess: Titel, Adresse und Art hinein, der
  // Schluessel heraus.
  werkSchluessel: (titel, url, art) => watchlist.werkSchluessel(titel, url, art),
  removeFromLibrary: (id) => ipcRenderer.invoke("library:remove", id),
  // Von vorn ansehen, ohne die Mediathek zu verlassen.
  rewatchFromStart: (id, optionen) => ipcRenderer.invoke("library:rewatch", id, optionen || {}),
  // Fuer den Verlaufs-Kasten: laeuft die Serie noch, und wann kommt die
  // naechste Folge. Steht nirgends in der eigenen Ablage.
  getLibraryMetadata: (id) => ipcRenderer.invoke("library:metadata", id),
  getTrailer: (titel, url) => ipcRenderer.invoke("titel:trailer", titel, url),
  getRelayStatus: () => ipcRenderer.invoke("relay:status"),
  clearNewEpisodeHint: (id) => ipcRenderer.invoke("favorites:clear-new", id),
  markFavoriteCompleted: (id) => ipcRenderer.invoke("favorites:mark-completed", id),
  setFavoriteWatchlist: (id, wert) => ipcRenderer.invoke("favorites:set-watchlist", id, wert),
  setFavoriteImage: (id, dataUrl, crop) => ipcRenderer.invoke("favorites:set-image", id, dataUrl, crop),
  setFavoriteImageCrop: (id, crop) => ipcRenderer.invoke("favorites:set-image-crop", id, crop),
  addSearchResultToWatchlist: (treffer) => ipcRenderer.invoke("favorites:add-result", treffer),
  reorderLibrary: (ids) => ipcRenderer.invoke("library:reorder", ids),
  hideFromContinue: (id) => ipcRenderer.invoke("continue:hide", id),
  clearHistory: () => ipcRenderer.invoke("history:clear"),
  openFavorite: (id, options = {}) => ipcRenderer.invoke("favorites:open", id, options),
  repairFavoriteThumbnail: (id, force = false) => ipcRenderer.invoke("favorites:repair-thumbnail", id, force),
  getReview: (jahr) => ipcRenderer.invoke("review:data", jahr),
  getWrapped: (jahr) => ipcRenderer.invoke("wrapped:status", jahr),
  getWrappedJahre: () => ipcRenderer.invoke("wrapped:jahre"),
  getWrappedReihenfolge: (schluessel, jahr) =>
    ipcRenderer.invoke("wrapped:reihenfolge", schluessel, jahr),
  getWrappedOpening: (titel, gattung) =>
    ipcRenderer.invoke("wrapped:opening", titel, gattung),
  markWrappedSeen: (jahr) => ipcRenderer.invoke("wrapped:gesehen", jahr),
  setWrappedOpen: (offen) => ipcRenderer.invoke("wrapped:set-open", offen),
  saveProviders: (providers) => ipcRenderer.invoke("provider:save-all", providers),
  // Der Anbieter hat eine neue Adresse - der Wirt wird in allen Eintraegen
  // ersetzt.
  relocateProvider: (id, adresse) => ipcRenderer.invoke("provider:relocate", id, adresse),
  // Intro ueberspringen: was ELFIX aus den eigenen Sprüngen gelernt hat.
  getMarkenStand: () => ipcRenderer.invoke("marken:stand"),
  forgetMarken: () => ipcRenderer.invoke("marken:vergessen"),
  getFassungenStand: () => ipcRenderer.invoke("fassungen:stand"),
  forgetFassungen: () => ipcRenderer.invoke("fassungen:vergessen"),
  // Das Handy als Fernbedienung.
  getFernStatus: () => ipcRenderer.invoke("fern:status"),
  getFernQr: () => ipcRenderer.invoke("fern:qr"),
  enableFern: () => ipcRenderer.invoke("fern:einschalten"),
  disableFern: () => ipcRenderer.invoke("fern:ausschalten"),
  newFernCode: () => ipcRenderer.invoke("fern:neuer-code"),
  onFernState: (callback) => ipcRenderer.on("fern:state", (_event, state) => callback(state)),
  providerContextMenu: (name, punkt) => ipcRenderer.invoke("provider:context-menu", name, punkt),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  checkForUpdates: () => ipcRenderer.invoke("updates:check"),
  updateFilters: () => ipcRenderer.invoke("adblock:update-filters"),
  getBlocked: () => ipcRenderer.invoke("adblock:blocked"),
  getMediaDiagnostics: () => ipcRenderer.invoke("media:diagnostics"),
  clearCache: () => ipcRenderer.invoke("data:clear-cache"),
  openDataFolder: () => ipcRenderer.invoke("data:open-folder"),
  openHelpIssues: () => ipcRenderer.invoke("help:open-issues"),
  // Der Ausweg aus dem Trailer-Rahmen: nur die Kennung des Videos, die
  // Adresse baut der Hauptprozess.
  openTrailerExtern: (schluessel) => ipcRenderer.invoke("titel:trailer-extern", schluessel),
  // Die Adresse hinter dem Hoster zur gerade offenen Folge. Eine Auskunft:
  // sie spielt nichts ab, sie sagt, ob es etwas abzuspielen gibt.
  getDirektQuelle: () => ipcRenderer.invoke("direkt:quelle"),
  // Und dasselbe, aber mit Folgen: aufloesen und im eigenen Player abspielen.
  startDirekt: () => ipcRenderer.invoke("direkt:starten"),
  stopDirekt: () => ipcRenderer.invoke("direkt:beenden"),
  exportBackup: () => ipcRenderer.invoke("data:backup-export"),
  importBackup: () => ipcRenderer.invoke("data:backup-import"),
  resetData: () => ipcRenderer.invoke("data:confirm-reset"),
  onBrowserState: (callback) => ipcRenderer.on("browser:state", (_event, state) => callback(state)),
  onBlocked: (callback) => ipcRenderer.on("adblock:blocked", (_event, items) => callback(items)),
  onMediaDiagnostics: (callback) => ipcRenderer.on("media:diagnostics", (_event, items) => callback(items)),
  onFullscreen: (callback) => ipcRenderer.on("browser:fullscreen", (_event, enabled) => callback(enabled)),
  onUpdateState: (callback) => ipcRenderer.on("updates:state", (_event, state) => callback(state)),
  // Ein Klick auf die Benachrichtigung ueber eine neue Folge. Der Hauptprozess
  // holt das Fenster nach vorn und schickt hierher, um welchen Titel es ging.
  onZeigeFavorit: (callback) => ipcRenderer.on("elfix:zeige-favorit", (_event, id) => callback(id)),
  // Die Einstellungen haben sich ohne Zutun der Oberflaeche geaendert - etwa
  // durch den Autoplay-Schalter in der Anbieterseite.
  onSettingsChanged: (callback) => ipcRenderer.on("settings:changed", (_event, neu) => callback(neu)),
  onToast: (callback) => ipcRenderer.on("app:toast", (_event, message) => callback(message)),
  // Tastenkuerzel. Der Hauptprozess faengt sie ab, weil die Anbieterseite ueber
  // der Oberflaeche liegt und Tastendruecke dort nie hier ankaemen.
  onTastenBefehl: (callback) => ipcRenderer.on("tasten:befehl", (_event, befehl) => callback(befehl)),
  onAutostartDone: (callback) => ipcRenderer.on("app:autostart-done", (_event, info) => callback(info))
});
