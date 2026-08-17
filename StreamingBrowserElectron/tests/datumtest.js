"use strict";
const { extractReleaseDate, datumAusText } = require("../src/discover.js");
const p = []; const pruefe = (n, b, d) => { p.push(b); console.log(`${b ? "OK  " : "FAIL"}  ${n}${d ? "   -> " + d : ""}`); };

// Die Formate aus den Screenshots
pruefe("ISO aus der Seitenleiste", datumAusText("2026-07-29") === "2026-07-29", datumAusText("2026-07-29"));
pruefe("Englisch mit Komma", datumAusText("March 5, 2026") === "2026-03-05", datumAusText("March 5, 2026"));
pruefe("Deutsch mit Punkten", datumAusText("Montag, 01.06.2026 00:43 Uhr") === "2026-06-01", datumAusText("Montag, 01.06.2026 00:43 Uhr"));
pruefe("Leere Angabe der Seite faellt raus", datumAusText("November 30, -0001") === "", `"${datumAusText("November 30, -0001")}"`);
pruefe("Unsinn faellt raus", datumAusText("demnaechst") === "", `"${datumAusText("demnaechst")}"`);
pruefe("Jahr 0 faellt raus", datumAusText("0000-01-01") === "", `"${datumAusText("0000-01-01")}"`);
pruefe("Monat 13 faellt raus", datumAusText("2026-13-01") === "", `"${datumAusText("2026-13-01")}"`);

// Aus echtem Seitenausschnitt
const seite = `<div class="info"><h3>Erscheinungsdatum</h3><span>2026-07-29</span></div>`;
pruefe("Erscheinungsdatum aus der Seitenleiste", extractReleaseDate(seite) === "2026-07-29", extractReleaseDate(seite));

const folge = `<h2>S14E13: Abrechnung</h2><small>Veröffentlicht am March 5, 2026 | Bes...</small>`;
pruefe("Veroeffentlicht am aus der Folge", extractReleaseDate(folge) === "2026-03-05", extractReleaseDate(folge));

const kaputt = `<small>Veröffentlicht am November 30, -0001 | Be</small>`;
pruefe("Kaputtes Folgendatum ergibt nichts", extractReleaseDate(kaputt) === "", `"${extractReleaseDate(kaputt)}"`);

const jsonld = `<script type="application/ld+json">{"datePublished":"2025-11-02","name":"X"}</script>`;
pruefe("Strukturierte Angabe wird genommen", extractReleaseDate(jsonld) === "2025-11-02", extractReleaseDate(jsonld));

const nurUpload = `<div>Veröffentlicht bei uns: <b>Montag, 01.06.2026 00:43</b> Uhr</div>`;
pruefe("Nur ein Upload-Datum ergibt nichts", extractReleaseDate(nurUpload) === "", `"${extractReleaseDate(nurUpload)}"`);

const f = p.filter((x) => !x).length;
console.log(`\n${p.length - f}/${p.length} bestanden`);
process.exit(f ? 1 : 0);
