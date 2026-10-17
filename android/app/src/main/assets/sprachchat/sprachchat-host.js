/* Android adapter: only the local top-frame origin receives ElfixVoiceNative. */
(function () {
  "use strict";
  let serial = 0;
  const pending = new Map();
  const listeners = { message: new Set(), context: new Set(), action: new Set() };
  function request(method, value) {
    return new Promise((resolve, reject) => {
      if (!window.ElfixVoiceNative || typeof window.ElfixVoiceNative.postMessage !== "function") {
        reject(new Error("Die sichere Sprachchat-Brücke ist nicht verfügbar.")); return;
      }
      const id = String(++serial);
      pending.set(id, { resolve, reject });
      window.ElfixVoiceNative.postMessage(JSON.stringify({ id, method, value }));
    });
  }
  window.ElfixVoiceAndroidDeliver = function (event) {
    if (!event || typeof event !== "object") return;
    if (event.id) {
      const entry = pending.get(event.id);
      if (!entry) return;
      pending.delete(event.id);
      if (event.error) entry.reject(new Error(event.error));
      else entry.resolve(event.value);
    } else if (listeners[event.kind]) {
      for (const cb of listeners[event.kind]) cb(event.value);
    }
  };
  const subscribe = kind => cb => { listeners[kind].add(cb); return () => listeners[kind].delete(cb); };
  window.ElfixVoiceHost = {
    context: () => request("context"),
    preferences: () => request("preferences"),
    savePreferences: value => request("savePreferences", value),
    send: value => request("send", value),
    onMessage: subscribe("message"), onContext: subscribe("context"), onAction: subscribe("action"),
    microphone: () => request("microphone"),
    capture: active => request("capture", Boolean(active)),
    state: value => request("state", value),
    hide: () => request("hide"), close: () => request("close"),
    duck: active => request("duck", Boolean(active))
  };
})();
