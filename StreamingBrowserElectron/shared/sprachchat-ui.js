"use strict";

(() => {
  const host = window.ElfixVoiceHost;
  const $ = (id) => document.getElementById(id);
  if (!host || !window.ElfixSprachchat) {
    $("status").textContent = "Sprachchat ist in dieser Ansicht nicht verfügbar.";
    $("beitreten").disabled = true;
    return;
  }
  let context = { room: "", connected: false };
  let current = { joined: false, connecting: false, muted: true, peers: [] };
  let captureGeneration = 0;
  let holding = false;
  let ducking = false;
  let uiError = "";
  let lastHostState = "";
  let inputDeviceId = "";
  let deviceGeneration = 0;
  let probeStream = null;
  let preferencesReady = false;
  let probing = false;
  const rows = new Map();
  const engine = new window.ElfixSprachchat({
    send: (message) => host.send(message),
    onState: render,
    onMicrophone: (active) => host.capture?.(active),
    onDucking: (active) => { ducking = active; host.duck?.($("duck").checked && active); }
  });
  // Nur fuer die lokalen Hosts, z. B. die Android-Notification "Stumm".
  window.ElfixVoiceControls = {
    mute: () => { captureGeneration++; holding = false; engine.setMuted(true); },
    leave: () => leave(),
    context: (value) => setContext(value)
  };

  function render(value) {
    current = value;
    const active = value.joined || value.connecting;
    $("beitreten").hidden = active;
    $("beitreten").disabled = !context.connected || !preferencesReady || probing || value.available === false;
    $("mikrofon").disabled = !preferencesReady || probing;
    $("sprechen").disabled = probing;
    $("verlassen").hidden = !active;
    $("mikrofon").hidden = !value.joined || value.pushToTalk;
    $("mikrofon").textContent = value.muted ? "Mikrofon einschalten" : "Mikrofon stummschalten";
    $("mikrofon").setAttribute("aria-pressed", String(!value.muted));
    $("mikrofonHinweis").textContent = !value.muted ? "Dein Mikrofon ist eingeschaltet." : "Dein Mikrofon ist aus.";
    $("optionen").hidden = !value.joined;
    $("ptt").checked = Boolean(value.pushToTalk);
    $("sprechen").hidden = !value.pushToTalk;
    $("sprechen").classList.toggle("active", !value.muted);
    $("minimieren").hidden = !active || !host.hide;
    const error = uiError || value.error || "";
    $("status").classList.toggle("error", Boolean(error));
    $("status").textContent = error || (!context.connected ? "Keine Raumverbindung. Nach dem Wiederverbinden kannst du erneut beitreten."
      : value.connecting ? "Sprachchat wird verbunden …"
      : value.joined ? (value.muted ? "Du hörst zu. Dein Mikrofon ist aus." : "Du bist im Sprachchat.")
      : "Tritt zum Zuhören bei. Dein Mikrofon schaltest du anschließend selbst ein.");
    const peers = (value.peers || []).filter((peer) => peer.id !== value.selfId);
    $("leer").hidden = peers.length > 0;
    $("leer").textContent = value.joined ? "Du bist gerade allein im Sprachchat." : "Noch nicht beigetreten.";
    const ids = new Set(peers.map((peer) => peer.id));
    for (const [id, row] of rows) if (!ids.has(id)) { row.element.remove(); rows.delete(id); }
    for (const peer of peers) {
      let row = rows.get(peer.id);
      if (!row) {
        const element = document.createElement("article");
        element.className = "peer";
        const head = document.createElement("div"); head.className = "peer-head";
        const name = document.createElement("span"); name.className = "peer-name";
        const status = document.createElement("span"); status.className = "peer-status";
        head.append(name, status);
        const label = document.createElement("label"); label.className = "volume";
        const slider = document.createElement("input"); slider.type = "range"; slider.min = "0"; slider.max = "100"; slider.step = "5";
        const output = document.createElement("output");
        slider.addEventListener("input", () => { output.textContent = slider.value + "%"; engine.setVolume(peer.id, Number(slider.value) / 100); });
        label.append(slider, output); element.append(head, label); $("teilnehmer").append(element);
        row = { element, name, status, slider, output }; rows.set(peer.id, row);
      }
      row.name.textContent = peer.name || "Teilnehmer";
      row.status.textContent = peer.error || (peer.playbackError ? "Ton blockiert – unten erneut starten" : peer.muted ? "Mikrofon aus" : peer.speaking ? "spricht" : peer.connectionState === "failed" ? "Nicht verbunden" : peer.connectionState === "connected" ? "verbunden" : "verbindet …");
      row.element.classList.toggle("speaking", Boolean(peer.speaking && !peer.muted));
      row.slider.setAttribute("aria-label", "Lautstärke für " + (peer.name || "Teilnehmer"));
      if (document.activeElement !== row.slider) row.slider.value = String(Math.round((peer.volume ?? 1) * 100));
      row.output.textContent = row.slider.value + "%";
    }
    $("audioStart").hidden = !value.joined || !peers.some((peer) => peer.playbackError);
    const hostState = { joined: Boolean(value.joined), connecting: Boolean(value.connecting), muted: value.muted !== false, pushToTalk: Boolean(value.pushToTalk) };
    const key = JSON.stringify(hostState);
    if (key !== lastHostState) { lastHostState = key; host.state?.(hostState); }
  }
  function setContext(value) {
    const changed = context.room && context.room !== value?.room;
    context = value || { room: "", connected: false };
    if (context.settings) $("einstellungen").open = true;
    $("raum").textContent = context.room ? "Raum · " + context.room : "Kein Raum gewählt";
    if (changed || (!context.connected && (current.joined || current.connecting))) leave();
    render(current);
  }
  function leave() {
    captureGeneration++; holding = false; uiError = "";
    cancelDeviceProbe();
    engine.leave(); host.duck?.(false);
  }
  function cancelDeviceProbe() {
    deviceGeneration++;
    probing = false;
    if (probeStream) { probeStream.getTracks().forEach((track) => track.stop()); probeStream = null; }
    $("geraeteLaden").disabled = false;
    if (current.muted) host.capture?.(false);
    render(current);
  }
  async function listDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const select = $("mikrofonGeraet");
      select.replaceChildren(new Option("Systemstandard", ""));
      let number = 0;
      for (const device of devices) {
        if (device.kind !== "audioinput" || !device.deviceId || device.deviceId === "default") continue;
        select.add(new Option(device.label || `Mikrofon ${++number}`, device.deviceId));
      }
      if (inputDeviceId && ![...select.options].some((option) => option.value === inputDeviceId)) {
        select.add(new Option("Gespeichertes Mikrofon (derzeit nicht sichtbar)", inputDeviceId));
      }
      select.value = inputDeviceId;
    } catch (_) { $("geraeteHinweis").textContent = "Mikrofone konnten nicht gelesen werden. Prüfe die Mikrofonberechtigung."; }
  }
  $("geraeteLaden").addEventListener("click", async () => {
    const generation = ++deviceGeneration;
    probing = true;
    render(current);
    $("geraeteLaden").disabled = true;
    try {
      if (current.muted) {
        if (host.microphone && !await host.microphone(true)) throw new Error("permission");
        if (generation !== deviceGeneration) return;
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        // Dieser kurze Zugriff macht nur Geraetenamen sichtbar. Er wird weder
        // einem RTCPeerConnection noch dem lokalen Lautsprecher zugefuehrt.
        if (generation !== deviceGeneration) { stream.getTracks().forEach((track) => track.stop()); return; }
        probeStream = stream;
      }
      await listDevices();
      if (generation === deviceGeneration) $("geraeteHinweis").textContent = "Mikrofone geladen. Eine neue Auswahl schaltet ein laufendes Mikrofon zunächst stumm.";
    } catch (_) {
      if (generation === deviceGeneration) $("geraeteHinweis").textContent = "Mikrofonfreigabe fehlt oder das Gerät ist belegt. Du kannst weiterhin den Systemstandard wählen.";
    } finally {
      if (generation === deviceGeneration) cancelDeviceProbe();
    }
  });
  $("mikrofonGeraet").addEventListener("change", async () => {
    const previous = inputDeviceId;
    inputDeviceId = $("mikrofonGeraet").value;
    captureGeneration++; release();
    engine.setInputDevice(inputDeviceId);
    $("mikrofonGeraet").disabled = true;
    try {
      if (host.savePreferences && await host.savePreferences({ inputDeviceId }) === false) throw new Error("save");
      $("geraeteHinweis").textContent = "Mikrofon gespeichert. Zum Sprechen das Mikrofon wieder einschalten.";
    } catch (_) {
      inputDeviceId = previous; engine.setInputDevice(previous); $("mikrofonGeraet").value = previous;
      $("geraeteHinweis").textContent = "Die Mikrofon-Auswahl konnte nicht gespeichert werden.";
    } finally { $("mikrofonGeraet").disabled = false; }
  });
  navigator.mediaDevices?.addEventListener?.("devicechange", listDevices);
  async function microphone(ptt) {
    const generation = ++captureGeneration;
    uiError = "";
    try {
      const allowed = host.microphone ? await host.microphone() : true;
      if (generation !== captureGeneration || !current.joined || (ptt && !holding)) {
        if (current.muted && !holding) host.capture?.(false);
        return;
      }
      if (!allowed) { uiError = "Mikrofonzugriff wurde nicht freigegeben. Du kannst weiterhin zuhören."; render(current); return; }
      if (ptt) await engine.pushToTalk(true); else await engine.setMuted(false);
    } catch (_) { uiError = "Mikrofon konnte nicht gestartet werden. Prüfe die Mikrofonberechtigung."; render(current); }
  }
  function release() { if (!holding) return; holding = false; captureGeneration++; engine.pushToTalk(false); }
  $("beitreten").addEventListener("click", () => { uiError = ""; if (context.connected) engine.join(); });
  $("verlassen").addEventListener("click", leave);
  $("mikrofon").addEventListener("click", () => {
    if (current.muted) microphone(false);
    else { captureGeneration++; engine.setMuted(true); }
  });
  $("ptt").addEventListener("change", () => { release(); captureGeneration++; engine.setPushToTalk($("ptt").checked); });
  $("sprechen").addEventListener("pointerdown", (event) => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture?.(event.pointerId); holding = true; microphone(true); });
  for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) $("sprechen").addEventListener(event, release);
  $("sprechen").addEventListener("keydown", (event) => { if (![" ", "Enter"].includes(event.key) || event.repeat) return; event.preventDefault(); holding = true; microphone(true); });
  $("sprechen").addEventListener("keyup", (event) => { if ([" ", "Enter"].includes(event.key)) { event.preventDefault(); release(); } });
  window.addEventListener("blur", release);
  document.addEventListener("visibilitychange", () => { if (document.hidden) release(); });
  $("duckOption").hidden = !host.duck;
  $("duck").addEventListener("change", () => host.duck?.($("duck").checked && ducking));
  $("audioStart").addEventListener("click", () => engine.retryAudio());
  $("schliessen").addEventListener("click", () => { leave(); host.close(); });
  $("minimieren").addEventListener("click", () => host.hide?.());
  window.addEventListener("pagehide", () => { captureGeneration++; cancelDeviceProbe(); engine.close(); host.duck?.(false); });
  host.onMessage((message) => { if (!message.room || message.room === context.room) engine.receive(message); });
  host.onContext(setContext);
  host.onAction?.((action) => {
    if (action === "mute") { captureGeneration++; holding = false; engine.setMuted(true); }
    else if (action === "background") release();
  });
  Promise.resolve(host.context()).then(setContext).catch(() => { uiError = "Raum konnte nicht geladen werden."; render(current); });
  Promise.resolve(host.preferences?.() || {}).then((value) => {
    inputDeviceId = typeof value?.inputDeviceId === "string" ? value.inputDeviceId : "";
    engine.setInputDevice(inputDeviceId);
    listDevices();
  }).catch(() => { $("geraeteHinweis").textContent = "Gespeicherte Mikrofon-Auswahl konnte nicht geladen werden."; })
    .finally(() => { preferencesReady = true; render(current); });
})();
