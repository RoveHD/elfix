(function installAppearancePreview(global) {
  "use strict";

  const PREVIEW_WIDTH = 1440;
  const PREVIEW_HEIGHT = 900;
  const VALID_SCENES = new Set(["home", "cards", "controls"]);

  function create(options = {}) {
    const frame = document.querySelector("#appearancePreviewFrame");
    const viewport = document.querySelector("#appearancePreviewViewport");
    const sceneControl = document.querySelector("#appearancePreviewScene");
    const expandButton = document.querySelector("#appearancePreviewExpand");
    const hint = document.querySelector("#appearancePreviewHint");
    const status = document.querySelector("#appearancePreviewStatus");
    if (!frame || !viewport) return inactivePreview();

    let currentScene = validScene(options.initialScene || sceneControl?.value || "home");
    let ready = false;
    let destroyed = false;
    let rebuildRequested = true;
    let updateFrame = 0;
    let resizeFrame = 0;
    let expanded = false;

    const sourceShell = () => options.getShell?.() || document.querySelector(".app-shell");
    const previewDocument = () => frame.contentDocument;
    const previewShell = () => previewDocument()?.querySelector(".app-shell");

    frame.setAttribute("sandbox", "allow-same-origin");
    frame.setAttribute("aria-label", "Live-Vorschau der ELFIX-Oberfläche");
    let logicalWidth = Math.max(640, window.innerWidth || PREVIEW_WIDTH);
    let logicalHeight = Math.max(480, window.innerHeight || PREVIEW_HEIGHT);
    frame.style.width = `${logicalWidth}px`;
    frame.style.height = `${logicalHeight}px`;
    frame.style.position = "absolute";
    frame.style.inset = "0 auto auto 0";
    frame.style.transformOrigin = "top left";
    viewport.style.position = "relative";
    viewport.style.overflow = "hidden";
    viewport.style.aspectRatio = `${logicalWidth} / ${logicalHeight}`;

    frame.addEventListener("load", onFrameLoad);
    sceneControl?.addEventListener("change", onSceneChange);
    expandButton?.addEventListener("click", onExpand);

    const resizeObserver = typeof ResizeObserver === "function"
      ? new ResizeObserver(scheduleResize)
      : null;
    resizeObserver?.observe(viewport);
    window.addEventListener("resize", scheduleResize);

    initializeFrame();

    function initializeFrame() {
      const stylesheet = document.querySelector('link[rel="stylesheet"]')?.href || "./styles.css";
      const base = document.baseURI;
      frame.srcdoc = [
        "<!doctype html>",
        '<html lang="de">',
        "<head>",
        '<meta charset="utf-8">',
        `<base href="${escapeAttribute(base)}">`,
        `<link rel="stylesheet" href="${escapeAttribute(stylesheet)}">`,
        "</head>",
        '<body data-appearance-preview="true"></body>',
        "</html>"
      ].join("");
    }

    function onFrameLoad() {
      if (destroyed) return;
      ready = true;
      const doc = previewDocument();
      doc?.addEventListener("click", blockPreviewAction, true);
      doc?.addEventListener("submit", blockPreviewAction, true);
      rebuildRequested = true;
      scheduleUpdate();
      scheduleResize();
    }

    function blockPreviewAction(event) {
      const target = event.target?.nodeType === 1 ? event.target : null;
      const navigation = target?.closest("[data-home-action]");
      if (navigation) {
        event.preventDefault();
        event.stopPropagation();
        const requested = options.onNavigate?.(navigation.dataset.homeAction, currentScene);
        if (VALID_SCENES.has(requested)) setScene(requested);
        return;
      }
      if (event.type === "submit" || target?.closest("a[href], button[type='submit']")) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    function onSceneChange() {
      setScene(sceneControl.value);
    }

    function setScene(nextScene) {
      const next = validScene(nextScene);
      if (next === currentScene && ready) return;
      currentScene = next;
      if (sceneControl && sceneControl.value !== next) sceneControl.value = next;
      rebuildRequested = true;
      scheduleUpdate();
      options.onSceneChange?.(next);
    }

    function onExpand() {
      expanded = !expanded;
      const targets = [
        viewport.closest(".settings-preview-pane"),
        viewport.closest(".settings-shell"),
        viewport.closest(".settings-modal")
      ].filter(Boolean);
      for (const target of targets) target.classList.toggle("is-preview-expanded", expanded);
      expandButton.setAttribute("aria-pressed", String(expanded));
      expandButton.setAttribute("aria-label", expanded ? "Zurück zu den Einstellungen" : "Vorschau vergrößern");
      expandButton.title = expanded ? "Zurück zu den Einstellungen" : "Vorschau vergrößern";
      expandButton.textContent = expanded ? "↙" : "⤢";
      scheduleResize();
      options.onExpandedChange?.(expanded);
    }

    function scheduleUpdate(updateOptions = {}) {
      if (destroyed) return;
      if (updateOptions.refreshContent || updateOptions.rebuild || updateOptions.scene) {
        rebuildRequested = true;
      }
      if (updateOptions.scene) currentScene = validScene(updateOptions.scene);
      if (updateFrame) return;
      updateFrame = requestAnimationFrame(() => {
        updateFrame = 0;
        updateNow();
      });
    }

    function updateNow() {
      if (!ready || destroyed) return;
      if (rebuildRequested || !previewShell()) {
        rebuildRequested = false;
        renderScene();
      }
      mirrorPresentation();
      updateCopy();
      scheduleResize();
    }

    function renderScene() {
      const doc = previewDocument();
      const shell = sourceShell();
      if (!doc || !shell) {
        setStatus("Vorschau nicht verfügbar", "error");
        return;
      }

      const sceneNode = resolveSceneContent(currentScene, shell);
      const clonedShell = shell.cloneNode(false);
      clonedShell.removeAttribute("id");
      const topbar = limitedClone(shell.querySelector(".topbar"));
      const providers = limitedClone(shell.querySelector(".provider-strip"));
      const appArea = shell.querySelector(".app-area")?.cloneNode(false) || doc.createElement("div");
      const sidebar = limitedClone(shell.querySelector(".app-sidebar"));
      const browser = shell.querySelector(".browser-frame")?.cloneNode(false) || doc.createElement("main");

      if (!appArea.classList.contains("app-area")) appArea.className = "app-area";
      if (!browser.classList.contains("browser-frame")) browser.className = "browser-frame";
      browser.replaceChildren(prepareSceneClone(sceneNode, currentScene));
      appArea.replaceChildren(...[sidebar, browser].filter(Boolean));
      clonedShell.replaceChildren(...[topbar, providers, appArea].filter(Boolean));
      doc.body.replaceChildren(clonedShell);
      sanitizeTree(clonedShell);
      limitRepeatedContent(clonedShell, currentScene);
      setStatus("Live", "ready");
    }

    function resolveSceneContent(scene, shell) {
      const supplied = options.getSceneContent?.(scene, {
        sourceShell: shell,
        sourceDocument: document
      });
      const suppliedNode = supplied?.nodeType ? supplied : supplied?.node;
      if (suppliedNode?.nodeType) return suppliedNode;
      if (scene === "home") return shell.querySelector("#homeView") || emptyScene("Startseite");
      if (scene === "cards") {
        return shell.querySelector("#continueView")
          || shell.querySelector("#favoritesView")
          || emptyScene("Karten & Listen");
      }
      return controlsScene();
    }

    function prepareSceneClone(source, scene) {
      const clone = limitedClone(source) || emptyScene(scene === "cards" ? "Karten & Listen" : "Startseite");
      clone.classList.remove("is-hidden");
      clone.hidden = false;
      if (scene === "home") {
        const home = clone.matches(".home-view") ? clone : clone.querySelector(".home-view");
        home?.classList.remove("is-hidden");
      }
      return clone;
    }

    function controlsScene() {
      const scene = document.createElement("section");
      scene.className = "favorites-view";
      const page = document.createElement("div");
      page.className = "favorites-page";

      const heading = document.querySelector("#favoritesView .row-head")?.cloneNode(true)
        || document.querySelector(".settings-head")?.cloneNode(true);
      if (heading) {
        const eyebrow = heading.querySelector(".eyebrow");
        const title = heading.querySelector("h1, h2, h3");
        const copy = heading.querySelector("p:not(.eyebrow)");
        if (eyebrow) eyebrow.textContent = "Darstellung";
        if (title) title.textContent = "Bedienelemente";
        if (copy) copy.textContent = "Probiere Buttons und Eingaben aus. Sie verwenden das aktuelle Aussehen der App.";
        page.append(heading);
      }

      const examples = document.createElement("div");
      examples.className = "setting-card update-card";
      examples.style.maxWidth = "720px";
      examples.innerHTML = `
        <h3>Buttons &amp; Eingaben</h3>
        <p>Fahre mit der Maus über einen Button oder klicke in das Textfeld.</p>
        <div class="settings-inline-actions">
          <button type="button" class="primary-action">Weiterschauen</button>
          <button type="button" class="soft-action">Zur Watchlist</button>
          <button type="button" class="soft-action" disabled>Nicht verfügbar</button>
        </div>
        <input class="omnibox" type="text" aria-label="Texteingabe ausprobieren" placeholder="Hier kannst du etwas eingeben …">
        <div class="update-status-row"><strong>Wiedergabefortschritt</strong><span>42 %</span></div>
        <div class="update-progress"><div style="width:42%"></div></div>
        <div class="update-status-row">
          <strong style="color:var(--success)">Bereit</strong>
          <strong style="color:var(--warning)">Hinweis</strong>
          <strong style="color:var(--error)">Fehler</strong>
        </div>`;
      page.append(examples);
      scene.append(page);
      return scene;
    }

    function emptyScene(title) {
      const scene = document.createElement("section");
      scene.className = "favorites-view";
      const page = document.createElement("div");
      page.className = "favorites-page";
      const empty = document.createElement("div");
      empty.className = "empty-state";
      const heading = document.createElement("h1");
      heading.textContent = title;
      const copy = document.createElement("p");
      copy.textContent = "Für diese Ansicht sind noch keine echten Inhalte geladen.";
      empty.append(heading, copy);
      page.append(empty);
      scene.append(page);
      return scene;
    }

    function limitedClone(node) {
      return node?.cloneNode(true) || null;
    }

    function limitRepeatedContent(root, scene) {
      const limits = [
        [".provider-rail", 4],
        [".home-sidebar-providers", 3],
        [".favorite-rail", 4],
        [".favorite-grid", scene === "cards" ? 8 : 4],
        [".calendar-days", 5]
      ];
      for (const [selector, limit] of limits) {
        for (const container of root.querySelectorAll(selector)) {
          for (const child of Array.from(container.children).slice(limit)) child.remove();
        }
      }
      if (scene === "home") {
        const visibleRows = Array.from(root.querySelectorAll(".home-row:not(.is-hidden)"));
        for (const row of visibleRows.slice(5)) row.remove();
      }
    }

    function sanitizeTree(root) {
      for (const node of [root, ...root.querySelectorAll("*")]) {
        for (const attribute of Array.from(node.attributes || [])) {
          if (attribute.name.startsWith("on")) node.removeAttribute(attribute.name);
        }
        if (node.matches?.("webview, iframe, script")) node.remove();
        if (node.matches?.("a[href]")) node.setAttribute("tabindex", "0");
      }
      for (const dialog of root.querySelectorAll("dialog")) dialog.remove();
    }

    function mirrorPresentation() {
      const doc = previewDocument();
      const source = sourceShell();
      const target = previewShell();
      if (!doc || !source || !target) return;
      doc.documentElement.className = document.documentElement.className;
      doc.documentElement.style.cssText = document.documentElement.style.cssText;
      doc.body.className = document.body.className;
      doc.body.style.cssText = document.body.style.cssText;
      doc.body.dataset.appearancePreview = "true";
      target.className = source.className;
      target.style.cssText = source.style.cssText;
    }

    function updateCopy() {
      const sceneNames = {
        home: "Deine Startseite",
        cards: "Deine Kartenansicht",
        controls: "Bedienelemente"
      };
      if (hint) {
        hint.textContent = currentScene === "controls"
          ? "Hover, Fokus und Eingaben funktionieren in der Vorschau. Aktionen verändern keine App-Daten."
          : `${sceneNames[currentScene]} mit deinen Titeln und dem aktuellen Aussehen. Bewege die Maus über Karten und Buttons, um Hover-Effekte zu prüfen.`;
      }
      if (sceneControl && sceneControl.value !== currentScene) sceneControl.value = currentScene;
    }

    function setStatus(text, state) {
      if (!status) return;
      status.textContent = text;
      status.dataset.state = state;
    }

    function scheduleResize() {
      if (destroyed || resizeFrame) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        logicalWidth = Math.max(640, window.innerWidth || PREVIEW_WIDTH);
        logicalHeight = Math.max(480, window.innerHeight || PREVIEW_HEIGHT);
        frame.style.width = `${logicalWidth}px`;
        frame.style.height = `${logicalHeight}px`;
        viewport.style.aspectRatio = `${logicalWidth} / ${logicalHeight}`;
        const width = viewport.clientWidth;
        const height = viewport.clientHeight;
        if (!width || !height) return;
        const scale = Math.min(width / logicalWidth, height / logicalHeight);
        frame.style.transform = `scale(${Math.max(0.05, scale)})`;
        viewport.style.setProperty("--appearance-preview-scale", String(scale));
      });
    }

    function refresh(scene) {
      if (scene && validScene(scene) !== currentScene) return;
      rebuildRequested = true;
      scheduleUpdate();
    }

    function destroy() {
      destroyed = true;
      if (updateFrame) cancelAnimationFrame(updateFrame);
      if (resizeFrame) cancelAnimationFrame(resizeFrame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleResize);
      sceneControl?.removeEventListener("change", onSceneChange);
      expandButton?.removeEventListener("click", onExpand);
      frame.removeEventListener("load", onFrameLoad);
    }

    return {
      update: scheduleUpdate,
      refresh,
      setScene,
      getScene: () => currentScene,
      isReady: () => ready,
      destroy
    };
  }

  function validScene(scene) {
    return VALID_SCENES.has(scene) ? scene : "home";
  }

  function inactivePreview() {
    return {
      update() {},
      refresh() {},
      setScene() {},
      getScene: () => "home",
      isReady: () => false,
      destroy() {}
    };
  }

  function escapeAttribute(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  global.ELFIX_APPEARANCE_PREVIEW = Object.freeze({
    create,
    width: PREVIEW_WIDTH,
    height: PREVIEW_HEIGHT
  });
})(globalThis);
