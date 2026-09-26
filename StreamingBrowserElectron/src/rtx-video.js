'use strict';

const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');

const MAGIC = 0x58545245;
const MAX_WIDTH = 3840;
const MAX_HEIGHT = 2160;
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_LINE = 1024;
const MAX_LOG = 4096;

function gueltig(params) {
  if (!params || !Buffer.isBuffer(params.pixel)) return false;
  const { width, height, outputWidth, outputHeight, generation, frameId } = params;
  if (![width, height, outputWidth, outputHeight, generation, frameId]
      .every((wert) => Number.isSafeInteger(wert))) return false;
  if (generation < 1 || generation > 0xffffffff || frameId < 1 || frameId > 0xffffffff) return false;
  if (width < 640 || height < 360 || width > MAX_WIDTH || height > MAX_HEIGHT) return false;
  if (outputWidth < width || outputHeight < height ||
      outputWidth > MAX_WIDTH || outputHeight > MAX_HEIGHT) return false;
  const bytes = width * height * 4;
  return bytes <= MAX_BYTES && params.pixel.length === bytes;
}

function header(operation, params = {}) {
  const buffer = Buffer.alloc(40);
  for (const [index, value] of [MAGIC, operation, params.generation || 0,
    params.frameId || 0, params.width || 0, params.height || 0,
    params.outputWidth || 0, params.outputHeight || 0,
    params.quality || 0, params.byteLength || 0].entries()) {
    buffer.writeUInt32LE(value, index * 4);
  }
  return buffer;
}

function handleBuffer(text) {
  if (typeof text !== 'string' || !/^[0-9a-f]{1,16}$/i.test(text)) return null;
  const number = BigInt(`0x${text}`);
  if (!number) return null;
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(number);
  return buffer;
}

function grundFuer(code) {
  if (code === 'busy' || code === 'stopped') return code;
  if (code === 'no_rtx_adapter' || code === 'vsr_unavailable') return 'rtx-nicht-verfuegbar';
  if (code === 'runtime_missing' || code === 'helper_spawn') return 'rtx-fehlt';
  return 'rtx-fehler';
}

function erstellen({ verzeichnis, datenVerzeichnis, sharedTexture, spawnHelper = spawn } = {}) {
  if (typeof verzeichnis !== 'string' || typeof datenVerzeichnis !== 'string' ||
      !sharedTexture || typeof sharedTexture.importSharedTexture !== 'function' ||
      typeof sharedTexture.sendSharedTexture !== 'function') {
    throw new TypeError('RTX Video braucht Runtime-Verzeichnis, Daten-Verzeichnis und sharedTexture.');
  }

  let child = null;
  let startPromise = null;
  let started = false;
  let stopped = false;
  let lastFailure = 'rtx-fehler';
  let active = null;
  let queued = null;
  let lastGeneration = 0;
  let output = Buffer.alloc(0);
  let log = '';
  const messages = [];
  const waiters = [];

  function kickQueued() {
    if (!queued || active || stopped) return;
    const pending = queued;
    queued = null;
    queueMicrotask(() => {
      bild(pending.params).then(pending.resolve,
        () => pending.resolve({ ok: false, grund: 'rtx-fehler' }));
    });
  }

  function failPending(code) {
    while (waiters.length) waiters.shift().resolve({ type: 'error', code });
  }

  function dispose(code, owner = child) {
    if (owner && child !== owner) return;
    const oldChild = child;
    stopped = true;
    lastFailure = grundFuer(code);
    started = false;
    failPending(code);
    child = null;
    if (active?.imported) {
      active.imported.release();
      active.imported = null;
    }
    active = null;
    if (queued) {
      queued.resolve({ ok: false, grund: lastFailure });
      queued = null;
    }
    messages.length = 0;
    output = Buffer.alloc(0);
    if (oldChild && !oldChild.killed) oldChild.kill();
  }

  function deliver(message, owner) {
    if (message.type === 'released') {
      if (active && message.generation === active.generation &&
          message.frameId === active.frameId) {
        active = null;
        stopIfDrained();
        kickQueued();
      } else dispose('protocol', owner);
      return;
    }
    if (message.type === 'error' && !waiters.length) {
      dispose(message.code || 'helper_error', owner);
      return;
    }
    if (waiters.length) waiters.shift().resolve(message);
    else if (messages.length < 4) messages.push(message);
    else dispose('protocol', owner);
  }

  function onData(data, owner) {
    if (child !== owner) return;
    output = Buffer.concat([output, data]);
    if (output.length > MAX_LINE * 2 && !output.includes(10)) {
      dispose('protocol', owner);
      return;
    }
    for (;;) {
      const end = output.indexOf(10);
      if (end < 0) break;
      const line = output.subarray(0, end);
      output = output.subarray(end + 1);
      if (line.length > MAX_LINE) { dispose('protocol', owner); return; }
      let message;
      try { message = JSON.parse(line.toString('utf8')); } catch { dispose('protocol', owner); return; }
      if (!message || !['ready', 'frame', 'released', 'error'].includes(message.type)) {
        dispose('protocol', owner); return;
      }
      deliver(message, owner);
      if (child !== owner) return;
    }
    if (output.length > MAX_LINE) dispose('protocol', owner);
  }

  function nextMessage(timeout = 10000) {
    if (messages.length) return Promise.resolve(messages.shift());
    if (!child) return Promise.resolve({ type: 'error', code: 'helper_exit' });
    return new Promise((resolve) => {
      const waiter = { resolve: (value) => { clearTimeout(timer); resolve(value); } };
      const timer = setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        resolve({ type: 'error', code: 'helper_timeout' });
      }, timeout);
      waiters.push(waiter);
    });
  }

  async function start() {
    if (started) return true;
    if (stopped) return false;
    if (startPromise) return startPromise;
    startPromise = (async () => {
      try {
        const helperPath = path.join(verzeichnis, 'rtx-video-helper.exe');
        if (spawnHelper === spawn &&
            (!existsSync(helperPath) || !existsSync(path.join(verzeichnis, 'nvngx_vsr.dll')))) {
          dispose('runtime_missing');
          return false;
        }
        const startedChild = spawnHelper(helperPath,
          [String(process.pid), datenVerzeichnis],
          { cwd: verzeichnis, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        child = startedChild;
        startedChild.stdout.on('data', (data) => onData(data, startedChild));
        startedChild.stderr.on('data', (chunk) => {
          if (child === startedChild) log = (log + chunk.toString('utf8')).slice(-MAX_LOG);
        });
        startedChild.stdin.on('error', () => dispose('helper_write', startedChild));
        startedChild.on('error', () => dispose('helper_spawn', startedChild));
        startedChild.on('exit', () => dispose('helper_exit', startedChild));
        const first = await nextMessage();
        if (first.type !== 'ready' || stopped) {
          if (!stopped) dispose(first.code || 'protocol', startedChild);
          return false;
        }
        started = true;
        return true;
      } catch {
        dispose('helper_spawn');
        return false;
      } finally {
        startPromise = null;
      }
    })();
    return startPromise;
  }

  function send(operation, params = {}, pixels) {
    if (!child || !child.stdin.writable) return false;
    try {
      child.stdin.write(header(operation, params));
      if (pixels) child.stdin.write(pixels);
      return true;
    } catch { return false; }
  }

  function stopIfDrained() {
    if (stopped && !active && child) {
      send(4);
      child.stdin.end();
    }
  }

  async function bild(params) {
    if (!gueltig(params)) return { ok: false, grund: 'rtx-fehler' };
    if (!params.webContents?.mainFrame || params.webContents.isDestroyed?.()) {
      return { ok: false, grund: 'rtx-fehler' };
    }
    if (stopped) return { ok: false, grund: 'stopped' };
    if (params.generation < lastGeneration) return { ok: false, grund: 'stopped' };
    if (active) {
      if (queued) return { ok: false, grund: 'busy' };
      return new Promise((resolve) => { queued = { params, resolve }; });
    }
    const frame = { generation: params.generation, frameId: params.frameId,
      outputWidth: params.outputWidth, outputHeight: params.outputHeight,
      imported: null, released: false };
    active = frame;
    lastGeneration = params.generation;
    let waitingForRelease = false;
    try {
      if (!await start() || stopped) return { ok: false, grund: lastFailure };
      if (!send(1, { ...params, quality: 2, byteLength: params.pixel.length }, params.pixel)) {
        dispose('helper_write');
        return { ok: false, grund: 'rtx-fehler' };
      }
      const response = await nextMessage();
      if (response.type === 'error') {
        dispose(response.code || 'helper_error');
        return { ok: false, grund: lastFailure };
      }
      if (response.type !== 'frame' || response.generation !== frame.generation ||
          response.frameId !== frame.frameId || response.width !== frame.outputWidth ||
          response.height !== frame.outputHeight) {
        dispose('protocol');
        return { ok: false, grund: 'rtx-fehler' };
      }
      const ntHandle = handleBuffer(response.handle);
      if (!ntHandle) {
        dispose('protocol');
        return { ok: false, grund: 'rtx-fehler' };
      }
      if (stopped) {
        send(2, frame);
        send(3, frame);
        waitingForRelease = true;
        return { ok: false, grund: 'stopped' };
      }
      let importFailed = false;
      try {
        frame.imported = sharedTexture.importSharedTexture({
          textureInfo: {
            handle: { ntHandle }, pixelFormat: 'rgba',
            codedSize: { width: frame.outputWidth, height: frame.outputHeight }
          },
          allReferencesReleased: () => {
            if (active !== frame || frame.released) return;
            frame.released = true;
            send(3, frame);
          }
        });
      } catch {
        importFailed = true;
      } finally {
        // Electron 44.4.3 duplicates the passed NT HANDLE synchronously.
        // Closing this parent-process copy cannot invalidate its GPU copy.
        send(2, frame);
      }
      if (importFailed || !frame.imported) {
        send(3, frame);
        waitingForRelease = true;
        stop();
        return { ok: false, grund: 'rtx-fehler' };
      }
      waitingForRelease = true;
      try {
        await sharedTexture.sendSharedTexture(
          { frame: params.webContents.mainFrame, importedSharedTexture: frame.imported },
          { generation: frame.generation, frameId: frame.frameId,
            width: frame.outputWidth, height: frame.outputHeight });
      } catch {
        stop();
        return { ok: false, grund: 'rtx-fehler' };
      } finally {
        if (frame.imported) {
          frame.imported.release();
          frame.imported = null;
        }
      }
      return stopped ? { ok: false, grund: 'stopped' } : { ok: true };
    } catch {
      if (frame.imported) {
        frame.imported.release();
        frame.imported = null;
      }
      if (waitingForRelease && !frame.released) {
        send(3, frame);
        frame.released = true;
      }
      dispose('helper_error');
      return { ok: false, grund: 'rtx-fehler' };
    } finally {
      // The frame remains active until Electron releases all GPU references.
      if (active === frame && !waitingForRelease) {
        active = null;
        if (child) dispose('helper_error');
        else kickQueued();
      }
      stopIfDrained();
    }
  }

  function stop() {
    stopped = true;
    if (queued) {
      queued.resolve({ ok: false, grund: 'stopped' });
      queued = null;
    }
    if (active?.imported) {
      active.imported.release();
      active.imported = null;
    }
    stopIfDrained();
  }

  return { bild, stop };
}

module.exports = { erstellen, _gueltig: gueltig, _header: header, _handleBuffer: handleBuffer };
