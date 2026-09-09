/* Gemeinsame Warteschlange: Der Renderer zeichnet nur den Relay-Stand. */
(function () {
  "use strict";

  const MODES = {
    normal: "Serien & Filme",
    youtube: "YouTube"
  };

  function text(value) { return String(value || ""); }
  function httpUrl(value) {
    try {
      const url = new URL(String(value || "").trim());
      return url.protocol === "https:" || url.protocol === "http:";
    } catch { return false; }
  }

  function erstellen(options) {
    const root = options?.root;
    const api = options?.api;
    if (!root) return { refresh() {}, destroy() {} };
    let room = "";
    let mode = "normal";
    let state = null;
    let destroyed = false;
    let refreshRevision = 0;
    let feedback = null;

    const heading = document.createElement("div");
    heading.className = "raumqueue-head";
    const title = document.createElement("div");
    const eyebrow = document.createElement("p"); eyebrow.className = "eyebrow"; eyebrow.textContent = "Gemeinsam entscheiden";
    const h2 = document.createElement("h2"); h2.textContent = "Warteschlange";
    const copy = document.createElement("p"); copy.className = "raumqueue-copy"; copy.textContent = "Vorschläge werden nach der aktuellen Folge oder dem aktuellen Film gestartet.";
    title.append(eyebrow, h2, copy);
    const controls = document.createElement("div"); controls.className = "raumqueue-controls";
    const roomLabel = document.createElement("label"); roomLabel.textContent = "Raum";
    const roomSelect = document.createElement("select"); roomSelect.setAttribute("aria-label", "Raum für die Warteschlange");
    roomLabel.append(roomSelect);
    controls.append(roomLabel);
    heading.append(title, controls);

    const tabs = document.createElement("div"); tabs.className = "raumqueue-tabs"; tabs.setAttribute("role", "tablist"); tabs.setAttribute("aria-label", "Warteschlangenmodus");
    const tabButtons = {};
    for (const [key, label] of Object.entries(MODES)) {
      const button = document.createElement("button"); button.type = "button"; button.textContent = label;
      button.setAttribute("role", "tab"); button.dataset.mode = key;
      button.addEventListener("click", () => { mode = key; state = null; feedback = null; render(); refresh(); });
      tabButtons[key] = button; tabs.append(button);
    }

    const composer = document.createElement("form"); composer.className = "raumqueue-composer";
    const favoritePicker = document.createElement("select"); favoritePicker.setAttribute("aria-label", "Titel aus deiner Watchlist");
    const youtubeUrl = document.createElement("input"); youtubeUrl.type = "url"; youtubeUrl.placeholder = "YouTube-URL einfügen"; youtubeUrl.setAttribute("aria-label", "YouTube-URL");
    const add = document.createElement("button"); add.type = "submit"; add.className = "primary-action"; add.textContent = "Zur Warteschlange hinzufügen";
    composer.append(favoritePicker, youtubeUrl, add);
    const status = document.createElement("p"); status.className = "raumqueue-status"; status.setAttribute("role", "status");
    const list = document.createElement("ol"); list.className = "raumqueue-list";

    /*
     * Das Glücksrad.
     *
     * Es ist ein Angebot und keine zweite Regel: eingeklappt, und wer es nicht
     * aufmacht, merkt nichts davon. Die Punkte der Abstimmung bestimmen die
     * Segmentgrößen - wer mehr Stimmen hat, hat mehr Rad -, aber jeder
     * Vorschlag behält ein Stück. Sonst wäre es kein Los, sondern nur die
     * Rangliste mit Umweg.
     *
     * Gedreht wird örtlich; geteilt wird das Ergebnis über denselben Weg wie
     * jeder andere Start. Die anderen sehen also nicht das Rad, sondern was
     * dabei herauskam.
     */
    const wheelBox = document.createElement("details"); wheelBox.className = "raumqueue-rad";
    const wheelSummary = document.createElement("summary"); wheelSummary.textContent = "Glücksrad";
    const wheelCopy = document.createElement("p"); wheelCopy.className = "raumqueue-copy";
    wheelCopy.textContent = "Lass das Los entscheiden. Mehr Stimmen heißt mehr Rad - aber jeder Vorschlag behält ein Stück.";
    const wheelStage = document.createElement("div"); wheelStage.className = "rad-buehne";
    const wheelSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    wheelSvg.setAttribute("viewBox", "0 0 200 200"); wheelSvg.setAttribute("class", "rad-scheibe");
    wheelSvg.setAttribute("aria-hidden", "true");
    const wheelTurn = document.createElementNS("http://www.w3.org/2000/svg", "g");
    // Ein ausdruecklicher Ausgangswinkel. Von `transform: none` aus laeuft am
    // SVG kein Uebergang an - die Scheibe sprang dann auf den Endwert, und
    // weil dabei auch kein transitionend kommt, blieb sie formal "im Lauf".
    wheelTurn.style.transform = "rotate(0deg)";
    wheelSvg.append(wheelTurn);
    const wheelPointer = document.createElement("div"); wheelPointer.className = "rad-zeiger"; wheelPointer.setAttribute("aria-hidden", "true");
    wheelStage.append(wheelSvg, wheelPointer);
    const wheelActions = document.createElement("div"); wheelActions.className = "rad-aktionen";
    const wheelSpin = document.createElement("button"); wheelSpin.type = "button"; wheelSpin.className = "primary-action"; wheelSpin.textContent = "Drehen";
    const wheelStart = document.createElement("button"); wheelStart.type = "button"; wheelStart.className = "soft-action"; wheelStart.textContent = "Gewinner starten"; wheelStart.hidden = true;
    wheelActions.append(wheelSpin, wheelStart);
    const wheelResult = document.createElement("p"); wheelResult.className = "rad-ergebnis"; wheelResult.setAttribute("role", "status");
    wheelBox.append(wheelSummary, wheelCopy, wheelStage, wheelActions, wheelResult);

    root.replaceChildren(heading, tabs, composer, status, wheelBox, list);

    function rooms() {
      const values = typeof options.rooms === "function" ? options.rooms() : [];
      return (Array.isArray(values) ? values : []).map((entry) => typeof entry === "string" ? entry : entry?.room).filter(Boolean);
    }
    function isYoutubeFavorite(item) {
      try { return /(^|\.)youtube\.com$|(^|\.)youtu\.be$/i.test(new URL(String(item?.url || "")).hostname); }
      catch { return Boolean(item?.youtubeVideoId); }
    }
    function favorites() { return Array.isArray(options.favorites?.()) ? options.favorites() : []; }
    function queueFavorites() { return favorites().filter((item) => !isYoutubeFavorite(item)); }
    function selectedFavorite() { return queueFavorites().find((item) => String(item?.id) === favoritePicker.value); }
    function setStatus(message, problem) { feedback = { message: text(message), problem: Boolean(problem) }; }
    function supported() { return typeof api?.getRoomQueue === "function" && typeof api?.roomQueueCommand === "function"; }

    function render() {
      const roomValues = rooms();
      if (!roomValues.includes(room)) room = roomValues[0] || "";
      roomSelect.replaceChildren(...roomValues.map((value) => {
        const option = document.createElement("option"); option.value = value; option.textContent = value; return option;
      }));
      roomSelect.value = room;
      for (const [key, button] of Object.entries(tabButtons)) {
        const active = key === mode; button.classList.toggle("is-active", active); button.setAttribute("aria-selected", String(active));
      }
      const previousFavoriteId = favoritePicker.value;
      const normalFavorites = queueFavorites();
      favoritePicker.replaceChildren(...normalFavorites.map((item) => {
        const option = document.createElement("option"); option.value = text(item?.id); option.textContent = text(item?.title || item?.name || "Unbenannter Titel"); return option;
      }));
      if (normalFavorites.some((item) => String(item?.id) === previousFavoriteId)) favoritePicker.value = previousFavoriteId;
      const hasRoom = Boolean(room);
      const normal = mode === "normal";
      const reachable = supported() && state?.connected === true && state?.supported === true;
      favoritePicker.hidden = !normal; youtubeUrl.hidden = normal;
      favoritePicker.disabled = !hasRoom || !reachable || !normalFavorites.length;
      youtubeUrl.disabled = !hasRoom || !reachable; add.disabled = !hasRoom || !reachable;
      const display = feedback || (state?.connected === false
        ? { message: "Keine Verbindung zum Raum. Die Warteschlange wird nach dem Verbinden geladen.", problem: true }
        : state?.supported === false
          ? { message: mode === "youtube" ? "YouTube-Watchparty für diesen Raum öffnen; das Relay muss Warteschlangen unterstützen." : "Das Relay hat die Warteschlange noch nicht bestätigt. Gegebenenfalls Relay aktualisieren.", problem: true }
          : !supported()
        ? { message: "Diese ELFIX-Version unterstützt gemeinsame Warteschlangen noch nicht.", problem: true }
        : !hasRoom
          ? { message: "Richte zuerst einen Watchparty-Raum ein.", problem: true }
          : state?.pending
            ? { message: "Warteschlange wird aktualisiert …", problem: false }
            : !state
              ? { message: "Warteschlange wird geladen …", problem: false }
              : { message: state.items?.length ? `${state.items.length} Vorschlag${state.items.length === 1 ? "" : "e"} im Raum.` : "Noch keine Vorschläge.", problem: false });
      status.textContent = display.message;
      status.classList.toggle("is-problem", display.problem);
      list.replaceChildren(...(Array.isArray(state?.items) ? state.items.map(queueItem) : []));
      // Waehrend der Drehung bleibt die Scheibe stehen, wie sie ist: eine
      // Stimme, die mitten im Lauf eintrifft, darf die Felder nicht unter dem
      // Zeiger verschieben.
      if (!radDreht) radZeichnen();
      radStandSetzen();
      // Eine Auslosung im Raumzustand zeigt sich hier - beim Ausloeser wie bei
      // allen anderen, und bei einem Nachzuegler ab der Stelle, an der die
      // Scheibe gerade steht.
      if (state?.spin) radLosZeigen({ ...state.spin });
    }

    /*
     * Eine Zeile der Warteschlange.
     *
     * Jeder hat drei Stimmen mit verschiedenem Gewicht - 3, 2 und 1. Sie
     * stehen als drei Knoepfe nebeneinander, damit ohne Erklaerung sichtbar
     * ist, was man noch zu vergeben hat: der eigene Punktestand dieser Zeile
     * ist gedrueckt, ein anderswo vergebenes Gewicht ist ausgegraut.
     */
    function queueItem(item) {
      const gesperrt = Boolean(state?.pending) || state?.connected === false || state?.supported === false;
      const row = document.createElement("li"); row.className = "raumqueue-item";
      const info = document.createElement("div"); info.className = "raumqueue-item-info";
      const name = document.createElement("strong"); name.textContent = text(item?.title || item?.url || "Unbenannter Vorschlag");
      const punkte = Number(item?.votes) || 0;
      const leute = Number(item?.voters) || 0;
      const votes = document.createElement("small");
      votes.textContent = punkte === 0 ? "Noch keine Stimme"
        : `${punkte} Punkt${punkte === 1 ? "" : "e"} von ${leute} Person${leute === 1 ? "" : "en"}`;
      info.append(name, votes);

      const actions = document.createElement("div"); actions.className = "raumqueue-actions";
      const meine = Number(item?.myVote) || 0;
      const frei = Array.isArray(state?.freeWeights) ? state.freeWeights : [];
      const gewichte = Array.isArray(state?.weights) && state.weights.length ? state.weights : [3, 2, 1];
      const stimmen = document.createElement("div"); stimmen.className = "raumqueue-stimmen";
      stimmen.setAttribute("role", "group");
      stimmen.setAttribute("aria-label", "Stimme vergeben");
      for (const gewicht of gewichte) {
        const knopf = document.createElement("button");
        knopf.type = "button";
        knopf.className = meine === gewicht ? "stimme-knopf is-active" : "stimme-knopf";
        knopf.textContent = String(gewicht);
        const vergeben = meine !== gewicht && !frei.includes(gewicht);
        knopf.title = meine === gewicht ? `Stimme mit ${gewicht} zurücknehmen`
          : vergeben ? `Deine ${gewicht}er-Stimme liegt auf einem anderen Vorschlag - hierher verschieben`
            : `Mit ${gewicht} stimmen`;
        knopf.setAttribute("aria-label", knopf.title);
        knopf.setAttribute("aria-pressed", meine === gewicht ? "true" : "false");
        knopf.classList.toggle("is-vergeben", vergeben);
        knopf.disabled = !item?.id || gesperrt;
        knopf.addEventListener("click", () => command("vote",
          { id: item.id, value: meine === gewicht ? false : gewicht }));
        stimmen.append(knopf);
      }
      actions.append(stimmen);

      if (item?.mine) { const remove = document.createElement("button"); remove.type = "button"; remove.className = "text-action"; remove.textContent = "Meinen Vorschlag entfernen"; remove.disabled = gesperrt; remove.addEventListener("click", () => command("remove", { id: item.id })); actions.append(remove); }
      // Starten darf man jeden Vorschlag. Die Abstimmung ordnet die Liste; sie
      // soll nicht verbieten, bewusst etwas anderes zu waehlen.
      const start = document.createElement("button");
      start.type = "button";
      start.className = item?.id && item.id === state?.selectedId ? "primary-action" : "soft-action";
      start.textContent = "Jetzt starten";
      start.disabled = !item?.id || gesperrt;
      start.addEventListener("click", () => command("advance", { expectedId: item.id, expectedRev: state.rev }));
      actions.append(start);
      row.append(info, actions); return row;
    }

    /*
     * Die Felder des Rades.
     *
     * Waehrend einer Auslosung stammen sie aus ihr und nicht aus der eigenen
     * Liste: die Auslosung traegt ihre Felder mit, damit alle dieselbe Scheibe
     * drehen. Wer eine Umdrehung hinterherhinkt oder mitten im Lauf dazukommt,
     * saehe sonst andere Segmente - und der Zeiger zeigte am Ende bei jedem auf
     * einen anderen Namen.
     */
    function radFelder() {
      const los = state?.spin;
      if (los?.fields?.length) {
        return los.fields.map((feld) => ({ id: feld.id, title: feld.title, gewicht: Math.max(1, Number(feld.weight) || 1) }));
      }
      // Ohne laufende Auslosung zeigt das Rad die Liste, wie sie steht. Ein
      // Vorschlag ohne Stimme behaelt dabei ein Stueck - sonst koennte das Los
      // nur bestaetigen, was die Rangliste ohnehin sagt.
      const items = Array.isArray(state?.items) ? state.items.filter((item) => item?.id) : [];
      return items.map((item) => ({ id: item.id, title: text(item.title || item.url), gewicht: Math.max(0, Number(item.votes) || 0) + 1 }));
    }

    function radSegmente() {
      const felder = radFelder();
      const gesamt = felder.reduce((summe, feld) => summe + feld.gewicht, 0);
      let start = 0;
      return felder.map((feld, index) => {
        const anteil = gesamt > 0 ? feld.gewicht / gesamt : 1 / Math.max(1, felder.length);
        const segment = { feld, index, von: start, bis: start + anteil * 360 };
        start = segment.bis;
        return segment;
      });
    }

    /** Punkt auf dem Kreis - Winkel im Uhrzeigersinn, 0 Grad ist oben. */
    function radPunkt(grad, radius) {
      const bogen = (grad - 90) * Math.PI / 180;
      return `${(100 + radius * Math.cos(bogen)).toFixed(2)} ${(100 + radius * Math.sin(bogen)).toFixed(2)}`;
    }

    function radZeichnen() {
      const segmente = radSegmente();
      const teile = [];
      for (const segment of segmente) {
        const breite = segment.bis - segment.von;
        const flaeche = document.createElementNS("http://www.w3.org/2000/svg", "path");
        // Ein einzelner Vorschlag ist ein voller Kreis; ein Bogen ueber 360
        // Grad laesst sich nicht als ein Pfad zeichnen.
        flaeche.setAttribute("d", breite >= 359.99
          ? "M 100 8 A 92 92 0 1 1 99.99 8 Z"
          : `M 100 100 L ${radPunkt(segment.von, 92)} A 92 92 0 ${breite > 180 ? 1 : 0} 1 ${radPunkt(segment.bis, 92)} Z`);
        flaeche.setAttribute("fill", `hsl(${(segment.index * 47) % 360} 62% ${segment.index % 2 ? 42 : 52}%)`);
        flaeche.setAttribute("stroke", "rgba(0,0,0,0.35)");
        flaeche.setAttribute("stroke-width", "0.6");
        teile.push(flaeche);

        if (breite < 12) continue;
        const mitte = segment.von + breite / 2;
        const schrift = document.createElementNS("http://www.w3.org/2000/svg", "text");
        schrift.setAttribute("class", "rad-schrift");
        schrift.setAttribute("x", "100"); schrift.setAttribute("y", "34");
        schrift.setAttribute("text-anchor", "middle");
        schrift.setAttribute("dominant-baseline", "middle");
        // In der unteren Haelfte stuende die Beschriftung sonst auf dem Kopf.
        // Sie wird dort um ihren eigenen Punkt gewendet und bleibt lesbar.
        const gewendet = mitte > 90 && mitte < 270;
        schrift.setAttribute("transform", `rotate(${mitte.toFixed(2)} 100 100)`
          + (gewendet ? " rotate(180 100 34)" : ""));
        const name = text(segment.feld?.title || "Vorschlag");
        schrift.textContent = name.length > 22 ? `${name.slice(0, 21)}…` : name;
        teile.push(schrift);
      }
      wheelTurn.replaceChildren(...teile);
      return segmente;
    }

    let radDreht = false;
    let radWinkel = 0;
    let radGewinner = null;
    let radLaufendeKennung = "";

    function radStandSetzen() {
      const items = Array.isArray(state?.items) ? state.items.filter((item) => item?.id) : [];
      const bedienbar = supported() && state?.connected === true && state?.supported === true && !state?.pending;
      wheelSpin.disabled = radDreht || !bedienbar || items.length < 2;
      wheelStart.hidden = !radGewinner;
      wheelStart.disabled = radDreht || !bedienbar || !radGewinner;
      if (radDreht) return;
      if (!items.length) wheelResult.textContent = "Noch keine Vorschläge zum Auslosen.";
      else if (items.length < 2) wheelResult.textContent = "Ab zwei Vorschlägen gibt es etwas zu losen.";
      else if (!radGewinner) wheelResult.textContent = "";
      // Der Gewinner kann inzwischen gestartet oder entfernt worden sein.
      if (radGewinner && !items.some((item) => item.id === radGewinner.id)) {
        radGewinner = null;
        wheelStart.hidden = true;
        wheelResult.textContent = "Der ausgeloste Vorschlag steht nicht mehr in der Liste.";
      }
    }

    /*
     * Eine Auslosung des Raums anzeigen.
     *
     * Das Los faellt im Relay - dort, wo alle dieselbe Antwort bekommen. Hier
     * wird es nur noch gedreht: dieselben Felder, derselbe Gewinner, dieselbe
     * Landestelle und derselbe Augenblick, in die eigene Uhr umgerechnet.
     */
    function radLosZeigen(los) {
      if (!los?.spinId || los.spinId === radLaufendeKennung) return;
      const segmente = radZeichnen();
      const ziel = segmente.find((segment) => segment.feld.id === los.winnerId);
      if (!ziel) return;
      radLaufendeKennung = los.spinId;

      // Irgendwo im gewonnenen Feld stehenbleiben, nicht immer mittig - und mit
      // Abstand zur Kante, damit der Zeiger eindeutig darin steht. Die Stelle
      // kommt aus der Auslosung, damit jede Scheibe gleich haelt.
      const rand = (ziel.bis - ziel.von) * 0.2;
      const stelle = ziel.von + rand + Math.min(1, Math.max(0, Number(los.landing) || 0)) * ((ziel.bis - ziel.von) - 2 * rand);
      // Der Zeiger steht oben bei 0 Grad. Ein um R gedrehtes Feld bei `stelle`
      // liegt bei `stelle + R`; unter dem Zeiger steht es, wenn das 0 ergibt.
      const naechster = radWinkel + (360 - ((radWinkel + stelle) % 360 + 360) % 360) + 5 * 360;

      radDreht = true;
      // Der Gewinner steht erst am Ende in der Anzeige. Ihn jetzt zu setzen
      // liesse den Startknopf waehrend der Drehung erscheinen - und damit
      // waere das Ergebnis verraten, bevor die Scheibe steht.
      radGewinner = null;
      const wer = text(los.by);
      wheelResult.textContent = wer ? `${wer} dreht das Rad …` : "Das Rad dreht sich …";
      radStandSetzen();
      const ruhig = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
      // Alle fangen im selben Augenblick an. Wer die Nachricht spaeter bekommt,
      // steigt entsprechend spaeter ein und haelt trotzdem mit allen zusammen.
      const beginn = Number(los.startLokal) || Date.now();
      const gesamtDauer = Math.max(0, Number(los.duration) || 0);
      const verspaetung = Math.max(0, Date.now() - beginn);
      const DAUER_MS = ruhig ? 0 : Math.max(0, gesamtDauer - verspaetung);
      let erledigt = false;
      const fertig = () => {
        if (erledigt) return;
        erledigt = true;
        radWinkel = naechster;
        radDreht = false;
        radGewinner = { id: ziel.feld.id, title: ziel.feld.title };
        wheelResult.textContent = `Das Los fällt auf: ${text(ziel.feld.title || "Vorschlag")}`;
        radStandSetzen();
      };
      const vorher = radWinkel;
      // Der Endstand steht sofort im Stil - danach haelt ihn nichts als eine
      // laufende Animation, und die kann jederzeit abbrechen.
      wheelTurn.style.transform = `rotate(${naechster}deg)`;
      /*
       * Bewegt wird ueber die Animations-Schnittstelle und nicht ueber einen
       * CSS-Uebergang. Am SVG lief der naemlich gar nicht an: die Scheibe sprang
       * auf den Endwert, und weil dabei auch kein `transitionend` kommt, blieb
       * sie formal fuer immer "im Lauf" - samt gesperrtem Knopf.
       */
      const lauf = wheelTurn.animate?.(
        [{ transform: `rotate(${vorher}deg)` }, { transform: `rotate(${naechster}deg)` }],
        { duration: DAUER_MS, easing: "cubic-bezier(0.12, 0.62, 0.06, 1)" }
      );
      if (!lauf) { fertig(); return; }
      lauf.finished.then(fertig, fertig);
      // Und falls die Bewegung abgebrochen wird - zugeklappt, Fenster weg -,
      // zieht die Anzeige trotzdem nach. Das Los ist ohnehin schon gefallen.
      window.setTimeout(fertig, DAUER_MS + 400);
    }

    wheelSpin.addEventListener("click", () => command("spin", {}));
    wheelStart.addEventListener("click", () => {
      if (!radGewinner?.id) return;
      command("advance", { expectedId: radGewinner.id, expectedRev: state?.rev });
    });

    async function command(commandName, payload) {
      if (!room || !supported() || state?.connected !== true || state?.supported !== true) return;
      const commandRoom = room, commandMode = mode;
      const current = () => !destroyed && room === commandRoom && mode === commandMode;
      state = { ...(state || {}), pending: true, items: state?.items || [] }; feedback = null; render();
      try {
        const result = await api.roomQueueCommand(commandRoom, commandMode, commandName, payload);
        if (!current()) return;
        if (result?.ok === false) throw new Error(result.error || result.reason || "abgelehnt");
        feedback = null;
      } catch (error) { if (current()) setStatus(String(error?.message || "Die Warteschlange konnte nicht geändert werden. Prüfe die Raumverbindung.").slice(0, 300), true); }
      finally { if (current()) await refresh(); }
    }
    async function refresh() {
      if (destroyed || !supported() || !room) { render(); return; }
      const requestedRoom = room;
      const requestedMode = mode;
      const revision = ++refreshRevision;
      try {
        const next = await api.getRoomQueue(requestedRoom, requestedMode);
        if (!destroyed && revision === refreshRevision && room === requestedRoom && mode === requestedMode) {
          state = next && typeof next === "object" ? next : null;
        }
      } catch {
        if (!destroyed && revision === refreshRevision && room === requestedRoom && mode === requestedMode) {
          state = null;
          setStatus("Der Raum ist gerade nicht erreichbar.", true);
        }
      }
      if (!destroyed) render();
    }
    roomSelect.addEventListener("change", () => { room = roomSelect.value; state = null; feedback = null; render(); refresh(); });
    composer.addEventListener("submit", (event) => {
      event.preventDefault();
      if (mode === "normal") { const item = selectedFavorite(); if (!item?.id) { setStatus("Wähle zuerst einen Titel aus deiner Watchlist.", true); render(); return; } command("propose", { favoriteId: item.id }); return; }
      const url = youtubeUrl.value.trim(); if (!httpUrl(url)) { setStatus("Bitte füge eine gültige http(s)-YouTube-URL ein.", true); return; }
      command("propose", { url }); youtubeUrl.value = "";
    });
    const unsubscribe = api?.onRoomQueue?.((next) => { if (next?.room === room && next?.mode === mode) { state = next; feedback = null; render(); } });
    render(); refresh();
    return { refresh, destroy() { destroyed = true; if (typeof unsubscribe === "function") unsubscribe(); } };
  }
  globalThis.ElfixRaumqueue = { erstellen };
}());
