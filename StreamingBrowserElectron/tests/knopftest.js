// Spiegelt die Bewertung aus startknopf() mit nachgebauten Knoten.
const innerWidth = 1900, innerHeight = 900;
const badText = /close|schliessen|schließen|abbrechen|login|registr|teilen|share|trailer|info|beschreibung|kommentar|melden|verbesserung/i;

function bewerte(node) {
  const text = String(node.text || "").toLowerCase();
  const klasse = String(node.className || "").toLowerCase();
  const rect = node.rect;
  if (rect.width < 32 || rect.height < 32) return 0;
  if (rect.width > innerWidth * 0.7 && rect.height > innerHeight * 0.7) return 0;
  let score = 0;
  if (/tippe auf play|auf play|wiedergabe zu starten|zum abspielen|jetzt abspielen|start playback/i.test(text)) score += 2000;
  if (/(^|[^a-z])play([^a-z]|$)/i.test(text)) score += 900;
  if (/(^|[^a-z])play([^a-z]|$)/i.test(klasse)) score += 900;
  if (badText.test(text)) score -= 2600;
  return score;
}

const knoten = [
  // Soll geklickt werden - der Fall aus dem Screenshot
  { name: "Filmo Play-Overlay (Knopf + Text)", text: "Tippe auf Play, um die Wiedergabe zu starten",
    className: "play-overlay", rect: { width: 300, height: 160 }, soll: true },
  { name: "Filmo runder Play-Knopf", text: "", className: "vjs-big-play-button",
    rect: { width: 76, height: 76 }, soll: true },
  { name: "Generisch: Abspielen-Knopf", text: "Play", className: "btn",
    rect: { width: 120, height: 44 }, soll: true },

  // Soll NICHT geklickt werden
  { name: "Trailer ansehen", text: "Trailer ansehen", className: "btn-trailer",
    rect: { width: 160, height: 40 }, soll: false },
  { name: "Anmelden", text: "Login", className: "btn", rect: { width: 100, height: 40 }, soll: false },
  { name: "Beschreibung anzeigen", text: "Beschreibung anzeigen", className: "link",
    rect: { width: 200, height: 30 }, soll: false },
  { name: "Fehler melden", text: "Fehler melden", className: "report", rect: { width: 120, height: 34 }, soll: false },
  { name: "Ganze Seite (Body mit Play-Text)", text: "Tippe auf Play, um die Wiedergabe zu starten",
    className: "page", rect: { width: 1900, height: 900 }, soll: false },
  { name: "Winziges Play-Icon", text: "play", className: "icon", rect: { width: 14, height: 14 }, soll: false },
  { name: "Hoster-Auswahl VOE", text: "VOE DL 720P", className: "hoster", rect: { width: 120, height: 34 }, soll: false },
  { name: "Sprache Deutsch", text: "Deutsch", className: "lang", rect: { width: 110, height: 40 }, soll: false },
  { name: "Aehnliches", text: "Ähnliches", className: "tab", rect: { width: 100, height: 36 }, soll: false },
  { name: "Bootstrap justify-content-start", text: "Genres", className: "d-flex justify-content-start",
    rect: { width: 400, height: 40 }, soll: false },
  { name: "Playlist-Container", text: "Meine Liste", className: "playlist-wrap",
    rect: { width: 300, height: 200 }, soll: false }
];

let fehler = 0;
for (const n of knoten) {
  const score = bewerte(n);
  const wird = score > 800;
  const ok = wird === n.soll;
  if (!ok) fehler += 1;
  console.log(`${ok ? "OK  " : "FAIL"}  ${n.name.padEnd(36)} score=${String(score).padStart(5)} -> ${wird ? "klickt" : "laesst"} (soll ${n.soll ? "klicken" : "lassen"})`);
}
console.log(`\n${knoten.length - fehler}/${knoten.length} bestanden`);
process.exit(fehler ? 1 : 0);
