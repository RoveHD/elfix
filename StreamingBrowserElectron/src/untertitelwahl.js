(function (root, fabrik) {
  const api = fabrik();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ElfixUntertitelwahl = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";
  const text = wert => typeof wert === "string" ? wert.trim().slice(0, 100) : "";
  function sprache(wert) {
    const teile = text(wert).toLowerCase().replace(/_/g, "-").split("-");
    const aliases = { deu: "de", ger: "de", eng: "en", jpn: "ja", fra: "fr", fre: "fr", spa: "es", ita: "it" };
    teile[0] = aliases[teile[0]] || teile[0];
    return teile.join("-");
  }
  function normalisieren(wert) {
    const lang = sprache(wert?.sprache);
    const name = text(wert?.name);
    return !wert || wert.aus !== false || (!lang && !name)
      ? { aus: true, sprache: "", name: "" }
      : { aus: false, sprache: lang, name };
  }
  function merken(spur) {
    return normalisieren(spur ? { aus: false, sprache: spur.lang || spur.language,
      name: spur.name || spur.label } : null);
  }
  function waehlen(spuren, wert) {
    const vorgabe = normalisieren(wert);
    if (vorgabe.aus) return -1;
    const kandidaten = (spuren || []).map((spur, index) => ({ ...merken(spur), index }))
      .filter(spur => !spur.aus);
    const gleich = (a, b) => a.toLocaleLowerCase() === b.toLocaleLowerCase();
    const passend = kandidaten.filter(spur => vorgabe.sprache
      ? spur.sprache === vorgabe.sprache : gleich(spur.name, vorgabe.name));
    if (!passend.length && vorgabe.sprache) passend.push(...kandidaten.filter(spur =>
      spur.sprache && spur.sprache.split("-")[0] === vorgabe.sprache.split("-")[0]));
    return (passend.find(spur => vorgabe.name && gleich(spur.name, vorgabe.name)) || passend[0])?.index ?? -1;
  }
  return { normalisieren, merken, waehlen };
});
