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
    root.replaceChildren(heading, tabs, composer, status, list);

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
