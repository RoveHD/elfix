"use strict";
const { extractCalendarEntries, extractCalendarJson, wochentagAusDatum } = require("../src/discover.js");
const fs = require("fs");
const p = []; const pr = (n,b,d) => { p.push(b); console.log(`${b?"OK  ":"FAIL"}  ${n}${d?"   -> "+d:""}`); };

// Gegen die echten, heruntergeladenen Seiten.
const aw = extractCalendarEntries(fs.readFileSync(require("path").join(__dirname, "aniworld.html"),"utf8"));
pr("AniWorld liefert Eintraege", aw.length > 50, `${aw.length} Eintraege`);
// Dieselbe Folge steht mehrfach da - je Synchronfassung einmal. Das ist
// gewollt; doppelt waere nur dieselbe Folge in derselben Fassung.
// Eine Folge steht einmal da, mit allen Fassungen daran.
pr("Eine Folge, ein Eintrag",
  new Set(aw.map((e) => `${e.day}|${e.url}|${e.episode}`)).size === aw.length,
  `${aw.length} Eintraege`);
pr("Mehrere Fassungen stehen gemeinsam an einem Eintrag",
  aw.some((e) => (e.languages || []).length > 1),
  aw.find((e) => (e.languages || []).length > 1)?.language || "");
pr("Ist Deutsch dabei, steht es vorn",
  aw.filter((e) => (e.languages || []).includes("Deutsch")).every((e) => e.languages[0] === "Deutsch"),
  aw.find((e) => (e.languages || []).includes("Deutsch"))?.language || "");
pr("Jeder Eintrag nennt seine Fassungen", aw.every((e) => e.language), "");
pr("Deutsche Fassung wird erkannt", aw.some((e) => (e.languages||[]).includes("Deutsch")), "");
pr("Japanisch mit deutschem Untertitel", aw.some((e) => (e.languages||[]).includes("Japanisch, Deutsche Untertitel")), "");
pr("Japanisch mit englischem Untertitel", aw.some((e) => (e.languages||[]).includes("Japanisch, Englische Untertitel")), "");
pr("AniWorld hat Uhrzeiten", aw.every((e) => /^\d{2}:\d{2}$/.test(e.time)), aw[0].time);
// Frueher stand diese Folge dreimal untereinander - jetzt einmal, mit allen
// drei Fassungen daran.
const skelett = aw.find((e) => e.title.includes("Skeleton Knight") && e.episode === 7);
pr("Die mehrfach gelistete Folge steht genau einmal",
  aw.filter((e) => e.title.includes("Skeleton Knight") && e.episode === 7).length === 1, "");
pr("Und traegt alle drei Fassungen", (skelett?.languages || []).length === 3, skelett?.language || "");
pr("AniWorld hat Cover", aw.every((e) => e.image), `${aw.filter((e) => e.image).length} von ${aw.length}`);
const tageAw = new Set(aw.map((e) => e.day));
pr("AniWorld verteilt auf alle sieben Tage", tageAw.size === 7, [...tageAw].join(", "));
pr("AniWorld hat Titel", aw.every((e) => e.title && e.title.length < 120), "");
pr("AniWorld hat Serienadressen", aw.every((e) => /\/anime\/stream\//.test(e.url)), "");
pr("AniWorld hat Staffel und Folge", aw.filter((e) => e.episode > 0).length > aw.length * 0.8,
  `${aw.filter((e) => e.episode > 0).length} von ${aw.length}`);
pr("AniWorld hat ein Datum je Tag", aw.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date)), aw[0].date);

const st = extractCalendarJson(fs.readFileSync(require("path").join(__dirname, "sto-api.json"),"utf8"));
pr("S.to liefert Eintraege", st.length > 100, `${st.length} Eintraege`);
pr("S.to hat keine Doppelten",
  new Set(st.map((e) => `${e.day}|${e.url}|${e.episode}`)).size === st.length, `${st.length} eindeutig`);
// Die Schnittstelle liefert mehrere Wochen - die App schneidet auf sieben Tage.
pr("S.to liefert mehr als eine Woche", new Set(st.map((e) => e.date)).size > 7,
  `${new Set(st.map((e) => e.date)).size} Tage`);
pr("S.to hat Cover", st.every((e) => e.image), `${st.filter((e) => e.image).length} von ${st.length}`);
pr("S.to verteilt auf alle sieben Tage", new Set(st.map((e) => e.day)).size === 7, "");
pr("S.to hat Uhrzeiten", st.every((e) => /^\d{2}:\d{2}$/.test(e.time)), st[0].time);
pr("S.to hat Umlaute richtig", st.some((e) => /ä|ö|ü/.test(e.title)),
  st.find((e) => /ä|ö|ü/.test(e.title))?.title || "");

pr("Wochentag aus Datum", wochentagAusDatum("2026-08-17") === "Montag", wochentagAusDatum("2026-08-17"));
pr("Wochentag Sonntag", wochentagAusDatum("2026-08-16") === "Sonntag", wochentagAusDatum("2026-08-16"));
pr("Unsinn ergibt nichts", wochentagAusDatum("kaputt") === "", "");
pr("Leeres JSON ergibt nichts", extractCalendarJson("{}").length === 0, "");
pr("Kaputtes JSON stuerzt nicht", extractCalendarJson("nicht json").length === 0, "");
pr("Leeres HTML ergibt nichts", extractCalendarEntries("").length === 0, "");

// --- Filter zwischen Animes und Serien ---------------------------------
// Die Art steckt in der Adresse, nicht im Anbieter.
pr("AniWorld ist als Anime gefuehrt", aw.every((e) => e.type === "anime"), "");
pr("S.to ist als Serie gefuehrt", st.every((e) => e.type === "serie"), "");

const zusammen = [...aw, ...st];
const nurAnime = zusammen.filter((e) => e.type === "anime");
const nurSerie = zusammen.filter((e) => e.type === "serie");
pr("Der Filter trennt sauber",
  nurAnime.length + nurSerie.length === zusammen.length && nurAnime.length > 0 && nurSerie.length > 0,
  `${nurAnime.length} Animes, ${nurSerie.length} Serien`);
pr("Kein Eintrag ohne Art", zusammen.every((e) => e.type === "anime" || e.type === "serie"), "");

const f = p.filter((x)=>!x).length;
console.log(`
${p.length-f}/${p.length} bestanden`); process.exit(f?1:0);
