'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { erstellen, _gueltig, _header, _handleBuffer } = require('../src/rtx-video');

function frame(generation = 1, frameId = 1) {
  return {
    pixel: Buffer.alloc(640 * 360 * 4, 128),
    width: 640, height: 360, outputWidth: 1280, outputHeight: 720,
    generation, frameId, webContents: { mainFrame: { id: 1 }, isDestroyed: () => false }
  };
}

function fakeHelper({ crash = false, malformed = false, readyError = null } = {}) {
  const process = new EventEmitter();
  process.stdout = new PassThrough();
  process.stderr = new PassThrough();
  process.stdin = new PassThrough();
  process.killed = false;
  process.kill = () => { process.killed = true; process.emit('exit', 1); };
  process.stdin.on('data', (data) => {
    if (data.length !== 40 || data.readUInt32LE(0) !== 0x58545245) return;
    const operation = data.readUInt32LE(4);
    const generation = data.readUInt32LE(8);
    const frameId = data.readUInt32LE(12);
    if (operation === 1) {
      if (crash) queueMicrotask(() => process.emit('exit', 1));
      else if (malformed) queueMicrotask(() => process.stdout.write('not-json\n'));
      else queueMicrotask(() => process.stdout.write(JSON.stringify({ type: 'frame',
        generation, frameId, width: 1280, height: 720, handle: '1234' }) + '\n'));
    }
    if (operation === 3) queueMicrotask(() => process.stdout.write(JSON.stringify({
      type: 'released', generation, frameId }) + '\n'));
  });
  queueMicrotask(() => process.stdout.write(readyError
    ? JSON.stringify({ type: 'error', code: readyError }) + '\n'
    : '{"type":"ready"}\n'));
  return process;
}

async function run() {
  assert.equal(_gueltig(frame()), true);
  assert.equal(_gueltig({ ...frame(), pixel: Buffer.alloc(1) }), false);
  assert.equal(_gueltig({ ...frame(), width: 3841 }), false);
  assert.equal(_gueltig({ ...frame(), outputHeight: 2161 }), false);
  assert.equal(_gueltig({ ...frame(), generation: 0 }), false);
  assert.equal(_header(1, frame()).length, 40);
  assert.equal(_handleBuffer('1234').readBigUInt64LE(), 0x1234n);
  assert.equal(_handleBuffer('zz'), null);

  let released;
  const transfer = [];
  const sharedTexture = {
    importSharedTexture({ allReferencesReleased }) {
      released = allReferencesReleased;
      return { release() {} };
    },
    async sendSharedTexture(_options, metadata) { transfer.push(metadata); }
  };
  const child = fakeHelper();
  const engine = erstellen({ verzeichnis: 'runtime', datenVerzeichnis: 'data',
    sharedTexture, spawnHelper: () => child });
  assert.deepEqual(await engine.bild(frame()), { ok: true });
  assert.deepEqual(transfer, [{ generation: 1, frameId: 1, width: 1280, height: 720 }]);
  const queued = engine.bild(frame(2, 2));
  assert.deepEqual(await engine.bild(frame(2, 3)), { ok: false, grund: 'busy' });
  released();
  assert.deepEqual(await queued, { ok: true });
  assert.deepEqual(await engine.bild(frame(1, 3)), { ok: false, grund: 'stopped' });
  engine.stop();
  assert.deepEqual(await engine.bild(frame(3, 3)), { ok: false, grund: 'stopped' });
  released();

  for (const configuration of [{ crash: true }, { malformed: true }]) {
    let launches = 0;
    const broken = erstellen({ verzeichnis: 'runtime', datenVerzeichnis: 'data',
      sharedTexture, spawnHelper: () => { launches++; return fakeHelper(configuration); } });
    const first = broken.bild(frame());
    const waiting = broken.bild(frame(2, 2));
    assert.deepEqual(await first, { ok: false, grund: 'rtx-fehler' });
    assert.deepEqual(await waiting, { ok: false, grund: 'rtx-fehler' });
    assert.deepEqual(await broken.bild(frame(3, 3)), { ok: false, grund: 'stopped' });
    assert.equal(launches, 1);
    broken.stop();
  }
  const unavailable = erstellen({ verzeichnis: 'runtime', datenVerzeichnis: 'data',
    sharedTexture, spawnHelper: () => fakeHelper({ readyError: 'no_rtx_adapter' }) });
  assert.deepEqual(await unavailable.bild(frame()),
    { ok: false, grund: 'rtx-nicht-verfuegbar' });
  console.log('RTX Video broker: bounds, transfer, busy, release, generation, crash and parser OK');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
