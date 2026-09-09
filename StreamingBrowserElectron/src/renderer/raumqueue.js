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


  /*
   * Der Klang des Rades.
   *
   * Kurz und oertlich erzeugt, wie die uebrigen Bedienklaenge: kein Download,
   * keine Datei, und dieselben Einstellungen entscheiden - wer die UI-Klaenge
   * ausgeschaltet oder leise gestellt hat, hoert auch hier nichts.
   *
   * `ui-sounds.js` selbst taugt dafuer nicht: es drosselt auf einen Ton alle
   * neunzig Millisekunden, und ein Rad tickt am Anfang zwanzigmal so schnell.
   */
  function radKlang(einstellungen) {
    let kontext = null;
    const laut = () => {
      const wert = einstellungen?.();
      if (!wert || wert.uiSounds === false) return 0;
      const staerke = Number(wert.uiSoundVolume ?? 20);
      return Number.isFinite(staerke) ? Math.min(100, Math.max(0, staerke)) / 100 : 0;
    };
    function wecken() {
      if (!laut() || document.hidden) return null;
      try {
        const Klasse = window.AudioContext || window.webkitAudioContext;
        if (!Klasse) return null;
        kontext ||= new Klasse();
        if (kontext.state === "suspended") kontext.resume().catch(() => {});
        return kontext.state === "running" ? kontext : null;
      } catch { return null; }
    }
    // Ein Ton, der von selbst wieder aufraeumt. Ohne das Abklemmen sammeln sich
    // bei einem Rad mit hundert Ticks hundert tote Knoten an.
    function ton({ art = "sine", von, bis = von, dauer, staerke, verzug = 0 }) {
      const ctx = wecken();
      if (!ctx) return;
      const start = ctx.currentTime + verzug;
      const quelle = ctx.createOscillator();
      const huelle = ctx.createGain();
      quelle.type = art;
      quelle.frequency.setValueAtTime(von, start);
      if (bis !== von) quelle.frequency.exponentialRampToValueAtTime(Math.max(1, bis), start + dauer);
      huelle.gain.setValueAtTime(0, start);
      huelle.gain.linearRampToValueAtTime(Math.max(0.0001, staerke * laut()), start + 0.004);
      huelle.gain.exponentialRampToValueAtTime(0.0001, start + dauer);
      quelle.connect(huelle);
      huelle.connect(ctx.destination);
      quelle.onended = () => { quelle.disconnect(); huelle.disconnect(); };
      quelle.start(start);
      quelle.stop(start + dauer + 0.02);
    }
    /*
     * Die Begleitung.
     *
     * Selbst erzeugt und nicht eingespielt: eine fremde Aufnahme waere eine
     * Datei im Paket und eine Lizenzfrage dazu. Was hier laeuft, sind zwei
     * Stimmen - ein Puls auf der Eins und eine Tonleiter darueber, die mit dem
     * Rad hoeher und dichter wird. Das Steigen ist die ganze Spannung: man
     * hoert, dass gleich etwas entschieden ist.
     */
    let musik = null;
    const LEITER = [0, 3, 7, 10, 12, 15];
    function musikStart(dauer) {
      musikStop();
      if (!wecken() || !dauer) return;
      const beginn = performance.now();
      let schritt = 0;
      const takt = () => {
        const anteil = Math.min(1, (performance.now() - beginn) / dauer);
        if (anteil >= 1) { musikStop(); return; }
        // Grundton steigt ueber die Drehung um eine Quinte.
        const wurzelTon = 110 * Math.pow(2, (7 * anteil) / 12);
        if (schritt % 4 === 0) {
          ton({ art: "sine", von: wurzelTon / 2, bis: wurzelTon / 2, dauer: 0.26, staerke: 0.10 });
        }
        const stufe = LEITER[schritt % LEITER.length];
        ton({ art: "triangle", von: wurzelTon * Math.pow(2, stufe / 12),
          bis: wurzelTon * Math.pow(2, stufe / 12), dauer: 0.16, staerke: 0.045 });
        schritt += 1;
        // Zum Schluss wird die Begleitung dichter, nicht duenner - sie zieht
        // an, waehrend das Rad auslaeuft.
        const abstand = 190 - 90 * anteil;
        musik = window.setTimeout(takt, abstand);
      };
      takt();
    }
    function musikStop() {
      if (musik) window.clearTimeout(musik);
      musik = null;
    }

    return {
      // Beim Drehen: erst schnell und hell, zum Schluss langsam und tief. Genau
      // dieses Langsamerwerden macht die Spannung - es ist hoerbar, dass gleich
      // Schluss ist.
      tick(anteil) {
        const hoehe = 1500 - 700 * Math.min(1, Math.max(0, anteil));
        ton({ art: "square", von: hoehe, bis: hoehe * 0.6, dauer: 0.035, staerke: 0.05 });
      },
      // Und wenn es steht: ein Dreiklang nach oben, mit einem Bass darunter.
      gewinn() {
        musikStop();
        const stufen = [[523.25, 0], [659.25, 0.09], [783.99, 0.18], [1046.5, 0.27]];
        for (const [hoehe, verzug] of stufen) {
          ton({ art: "triangle", von: hoehe, bis: hoehe, dauer: 0.42, staerke: 0.10, verzug });
        }
        ton({ art: "sine", von: 130.81, bis: 130.81, dauer: 0.7, staerke: 0.08 });
      },
      start(dauer) {
        ton({ art: "sawtooth", von: 180, bis: 620, dauer: 0.22, staerke: 0.06 });
        musikStart(dauer);
      },
      still: musikStop
    };
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
    // Die Klaenge des Rades gehorchen denselben Einstellungen wie die uebrigen
    // Bedienklaenge. Fehlt der Zugang, bleibt es still - nie ein Fehler.
    const klang = radKlang(options?.settings);

    const svgNS = "http://www.w3.org/2000/svg";
    const svgEl = (name, attribute = {}) => {
      const knoten = document.createElementNS(svgNS, name);
      for (const [feld, wert] of Object.entries(attribute)) knoten.setAttribute(feld, wert);
      return knoten;
    };

    const wheelStage = document.createElement("div"); wheelStage.className = "rad-buehne";
    const wheelSvg = svgEl("svg", { viewBox: "0 0 200 200", class: "rad-scheibe", "aria-hidden": "true" });

    /*
     * Tiefe aus Ebenen statt aus Verlaufsmarken.
     *
     * Verlaufsmarken waeren der uebliche Weg, aber ihre `url(#...)`-Verweise
     * malten hier nichts: Rand, Nabe und Woelbung blieben schwarz, obwohl die
     * Marken im Dokument standen und der berechnete Stil sie nannte. Ueberdeckte
     * halbdurchsichtige Formen brauchen keinen Verweis, rendern zuverlaessig und
     * bleiben in jeder Groesse scharf.
     */
    const wheelTurn = svgEl("g");
    // Ein ausdruecklicher Ausgangswinkel. Von `transform: none` aus laeuft am
    // SVG keine Bewegung an - die Scheibe sprang dann auf den Endwert.
    wheelTurn.style.transform = "rotate(0deg)";
    // Die Wolbung liegt ueber den Feldern und dreht deshalb nicht mit: Licht
    // bleibt, wo es ist, auch wenn sich das Rad darunter bewegt.
    // Licht oben, Schatten am Rand - beides liegt ueber den Feldern und dreht
    // nicht mit, damit das Licht steht, waehrend sich das Rad bewegt.
    const wheelGloss = svgEl("g", { "pointer-events": "none" });
    // Gestaffelt statt in einem Stueck: eine einzelne Ellipse zeichnete eine
    // sichtbare Kante ins Bild, mehrere duenne Lagen laufen weich aus.
    for (let i = 0; i < 6; i += 1) {
      wheelGloss.append(svgEl("ellipse", {
        cx: "100", cy: String(46 + i * 4), rx: String(34 + i * 9), ry: String(20 + i * 6),
        fill: "#fff", opacity: (0.030 - i * 0.003).toFixed(3)
      }));
    }
    for (let i = 0; i < 5; i += 1) {
      wheelGloss.append(svgEl("circle", {
        cx: "100", cy: "100", r: String(90 - i * 4), fill: "none",
        stroke: "#000", "stroke-width": "5", opacity: (0.075 - i * 0.013).toFixed(3)
      }));
    }
    const wheelRim = svgEl("g", { class: "rad-rand", "pointer-events": "none" });
    wheelRim.append(
      svgEl("circle", { cx: "100", cy: "100", r: "95.5", fill: "none",
        stroke: "#d8a33c", "stroke-width": "6" }),
      // Ein heller Bogen oben links und ein dunkler unten rechts: dieselbe
      // Lichtrichtung wie bei der Nabe, nur aus zwei Halbkreisen gebaut.
      svgEl("path", { d: `M ${radPunkt(292, 95.5)} A 95.5 95.5 0 0 1 ${radPunkt(112, 95.5)}`,
        fill: "none", stroke: "#ffe9a8", "stroke-width": "6", opacity: "0.75" }),
      svgEl("path", { d: `M ${radPunkt(112, 95.5)} A 95.5 95.5 0 0 1 ${radPunkt(292, 95.5)}`,
        fill: "none", stroke: "#6f4d12", "stroke-width": "6", opacity: "0.55" }),
      svgEl("circle", { cx: "100", cy: "100", r: "92.2", fill: "none",
        stroke: "rgba(0,0,0,0.5)", "stroke-width": "1.2" }),
      svgEl("circle", { cx: "100", cy: "100", r: "98.4", fill: "none",
        stroke: "rgba(0,0,0,0.35)", "stroke-width": "1.2" })
    );
    // Nieten auf dem Rand. Sie drehen nicht mit - sie gehoeren zum Gehaeuse und
    // geben dem Auge etwas, woran es die Bewegung darunter misst.
    for (let i = 0; i < 16; i += 1) {
      const [x, y] = radPunkt(i * (360 / 16), 95.5).split(" ");
      wheelRim.append(svgEl("circle", { cx: x, cy: y, r: "1.5", fill: "rgba(255,247,214,0.92)" }));
    }
    const wheelHub = svgEl("g", { class: "rad-nabe", "pointer-events": "none" });
    wheelHub.append(
      svgEl("circle", { cx: "100", cy: "100", r: "17", fill: "#98a2c0" }),
      // Der Glanzpunkt sitzt oben links - daher scheint das Licht auch auf der
      // Scheibe. Das macht aus der flachen Kappe eine Kugel.
      svgEl("circle", { cx: "94", cy: "93", r: "11", fill: "#eef1fb", opacity: "0.85" }),
      svgEl("circle", { cx: "100", cy: "100", r: "17", fill: "none",
        stroke: "rgba(0,0,0,0.5)", "stroke-width": "1.6" }),
      svgEl("circle", { cx: "100", cy: "100", r: "5.5", fill: "rgba(12,16,26,0.85)" })
    );
    wheelSvg.append(wheelTurn, wheelGloss, wheelRim, wheelHub);

    const wheelPointer = document.createElement("div"); wheelPointer.className = "rad-zeiger"; wheelPointer.setAttribute("aria-hidden", "true");
    wheelStage.append(wheelSvg, wheelPointer);
    const wheelActions = document.createElement("div"); wheelActions.className = "rad-aktionen";
    const wheelSpin = document.createElement("button"); wheelSpin.type = "button"; wheelSpin.className = "primary-action"; wheelSpin.textContent = "Drehen";
    /*
     * Die kurze Runde.
     *
     * Wer sie waehlt, entscheidet fuer die ganze Auslosung - die Laenge steht
     * in ihr drin, damit alle zugleich anhalten. Der Haken merkt sich nur, was
     * beim naechsten Druck mitgeschickt wird; die Runde erfaehrt es erst mit
     * dem Drehen.
     */
    const wheelFast = document.createElement("label"); wheelFast.className = "rad-schnell";
    const wheelFastBox = document.createElement("input"); wheelFastBox.type = "checkbox";
    const wheelFastText = document.createElement("span"); wheelFastText.textContent = "Schnell (4,2 s)";
    wheelFast.append(wheelFastBox, wheelFastText);
    wheelFast.title = "Statt einundzwanzig Sekunden nur gut vier - für alle in der Runde.";
    const wheelStart = document.createElement("button"); wheelStart.type = "button"; wheelStart.className = "soft-action"; wheelStart.textContent = "Gewinner starten"; wheelStart.hidden = true;
    wheelActions.append(wheelSpin, wheelStart, wheelFast);
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

    /*
     * Die Farben.
     *
     * Ein fester Kreis statt einer Rechnung aus dem Stichwort: nebeneinander
     * liegende Felder sollen sich deutlich unterscheiden, und ein Zufallston
     * trifft irgendwann Braun neben Braun. Sechs Toene reichen - mehr Felder
     * als das hat eine Runde selten, und darueber hinaus wiederholt sich der
     * Kreis mit einer anderen Helligkeit.
     */
    const RAD_FARBEN = [
      ["#7c3aed", "#5b21b6"], ["#0ea5e9", "#0369a1"], ["#f59e0b", "#b45309"],
      ["#ec4899", "#9d174d"], ["#10b981", "#047857"], ["#ef4444", "#991b1b"]
    ];

    function radZeichnen() {
      const segmente = radSegmente();
      const teile = [];
      for (const segment of segmente) {
        const breite = segment.bis - segment.von;
        const [hell, dunkel] = RAD_FARBEN[segment.index % RAD_FARBEN.length];
        const flaeche = svgEl("path", {
          // Ein einzelner Vorschlag ist ein voller Kreis; ein Bogen ueber 360
          // Grad laesst sich nicht als ein Pfad zeichnen.
          d: breite >= 359.99
            ? "M 100 8 A 92 92 0 1 1 99.99 8 Z"
            : `M 100 100 L ${radPunkt(segment.von, 92)} A 92 92 0 ${breite > 180 ? 1 : 0} 1 ${radPunkt(segment.bis, 92)} Z`,
          fill: segment.index % 2 ? dunkel : hell,
          stroke: "rgba(6,10,20,0.55)",
          "stroke-width": "0.7",
          "stroke-linejoin": "round"
        });
        flaeche.dataset.feld = segment.feld.id;
        teile.push(flaeche);

        if (breite < 11) continue;
        const mitte = segment.von + breite / 2;
        // In der unteren Haelfte stuende die Beschriftung sonst auf dem Kopf.
        // Sie wird dort um ihren eigenen Punkt gewendet und bleibt lesbar.
        const gewendet = mitte > 90 && mitte < 270;
        const schrift = svgEl("text", {
          class: "rad-schrift", x: "100", y: "32",
          "text-anchor": "middle", "dominant-baseline": "middle",
          transform: `rotate(${mitte.toFixed(2)} 100 100)` + (gewendet ? " rotate(180 100 32)" : "")
        });
        const name = text(segment.feld?.title || "Vorschlag");
        schrift.textContent = name.length > 20 ? `${name.slice(0, 19)}…` : name;
        teile.push(schrift);
      }
      // Die Speichen sitzen ueber den Feldern: sie trennen sie sichtbar, auch
      // wo zwei aehnliche Toene aneinanderstossen.
      for (const segment of segmente) {
        if (segmente.length < 2) break;
        teile.push(svgEl("line", { class: "rad-speiche",
          x1: "100", y1: "100",
          x2: radPunkt(segment.von, 92).split(" ")[0], y2: radPunkt(segment.von, 92).split(" ")[1] }));
      }
      wheelTurn.replaceChildren(...teile);
      return segmente;
    }

    let radDreht = false;
    let radWinkel = 0;
    let radGewinner = null;
    let radLaufendeKennung = "";


    /*
     * Der Klang des Vorbeiziehens.
     *
     * Berechnet wird nicht, wann ein Feld vorbeikommen *muesste* - die Kurve
     * der Bewegung liesse sich zwar aufloesen, aber jede Abweichung waere
     * hoerbar daneben. Stattdessen wird der wirkliche Winkel Bild fuer Bild
     * abgelesen: ueberquert dabei eine Feldkante den Zeiger, tickt es. Damit
     * stimmt der Ton immer mit dem ueberein, was zu sehen ist, und wird von
     * selbst langsamer, wenn das Rad auslaeuft.
     */
    function radTicken(lauf, segmente, vonWinkel, bisWinkel, dauer) {
      if (!dauer || segmente.length < 2) return;
      const kanten = segmente.map((segment) => segment.von);
      // Wie viele Kanten unter dem Zeiger schon vorbei sind. Der Zeiger steht
      // oben; ein um R gedrehtes Rad zeigt dort seinen Winkel -R.
      const gezaehlt = (drehung) => {
        let summe = 0;
        for (const kante of kanten) summe += Math.floor((drehung - kante) / 360) + 1;
        return summe;
      };
      let letzte = gezaehlt(vonWinkel);
      let laeuft = true;
      const ende = () => { laeuft = false; };
      lauf.finished.then(ende, ende);
      const bild = () => {
        if (!laeuft) return;
        const zeit = Math.min(dauer, Math.max(0, Number(lauf.currentTime) || 0));
        const anteil = zeit / dauer;
        // Der aktuelle Winkel kommt aus derselben Kurve wie die Bewegung.
        const stand = vonWinkel + (bisWinkel - vonWinkel) * radKurve(anteil);
        const jetzt = gezaehlt(stand);
        if (jetzt !== letzte) {
          letzte = jetzt;
          klang.tick(anteil);
          // Der Zeiger schlaegt sichtbar an, wie die Zunge an einem echten Rad.
          wheelPointer.classList.remove("schlaegt");
          void wheelPointer.offsetWidth;
          wheelPointer.classList.add("schlaegt");
        }
        if (zeit < dauer) window.requestAnimationFrame(bild);
      };
      window.requestAnimationFrame(bild);
    }

    /*
     * Dieselbe Kurve wie die Bewegung (cubic-bezier .12 .62 .06 1), nach der
     * Zeit aufgeloest. Newton reicht dafuer: die Kurve ist streng monoton, und
     * fuenf Schritte treffen sie genauer, als ein Bild breit ist.
     */
    function radKurve(anteil) {
      const [x1, y1, x2, y2] = [0.12, 0.62, 0.06, 1];
      const anteilX = (t) => 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
      const steigung = (t) => 3 * (1 - t) * (1 - t) * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t * t * (1 - x2);
      let t = anteil;
      for (let i = 0; i < 5; i += 1) {
        const abweichung = anteilX(t) - anteil;
        const m = steigung(t);
        if (Math.abs(m) < 1e-5) break;
        t = Math.min(1, Math.max(0, t - abweichung / m));
      }
      return 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t;
    }

    function radStandSetzen() {
      const items = Array.isArray(state?.items) ? state.items.filter((item) => item?.id) : [];
      const bedienbar = supported() && state?.connected === true && state?.supported === true && !state?.pending;
      wheelSpin.disabled = radDreht || !bedienbar || items.length < 2;
      wheelFastBox.disabled = radDreht || !bedienbar;
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
      /*
       * Die Umdrehungen wachsen mit der Dauer, damit das Rad nicht in
       * Zeitlupe faellt: laenger drehen heisst mehr Runden, nicht dieselben
       * Runden langsamer. Gerechnet wird aus der Dauer und nicht gewuerfelt -
       * alle muessen auf denselben Winkel kommen.
       */
      const runden = Math.max(5, Math.round((Number(los.duration) || 4200) / 840));
      const naechster = radWinkel + (360 - ((radWinkel + stelle) % 360 + 360) % 360) + runden * 360;

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
        root.classList.remove("rad-laeuft");
        klang.still();
        // Das gewonnene Feld leuchtet kurz auf - der Blick soll nicht suchen
        // muessen, wo der Zeiger steht.
        for (const feld of wheelTurn.querySelectorAll("path")) {
          feld.classList.toggle("ist-gewinner", feld.dataset.feld === ziel.feld.id);
        }
        klang.gewinn();
        wheelResult.textContent = `Das Los fällt auf: ${text(ziel.feld.title || "Vorschlag")}`;
        radStandSetzen();
      };
      const vorher = radWinkel;
      // Der Endstand steht sofort im Stil - danach haelt ihn nichts als eine
      // laufende Animation, und die kann jederzeit abbrechen.
      wheelTurn.style.transform = `rotate(${naechster}deg)`;
      // Gross werden, solange es laeuft. Ein Rad, das ueber die halbe Seite
      // geht, ist der halbe Reiz; danach macht es wieder Platz.
      root.classList.add("rad-laeuft");
      klang.start(DAUER_MS);
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
      radTicken(lauf, segmente, vorher, naechster, DAUER_MS);
    }

    wheelSpin.addEventListener("click", () => command("spin", { fast: wheelFastBox.checked }));
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
