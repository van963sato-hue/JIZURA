/* Actual-browser regression checks for animated image overlays.
 * python3 build.py && node dev/image_overlay_test.js
 * CHROMIUM_PATH selects Chromium; IMAGE_TEST_OUT retains fixtures/screenshots.
 * IMAGE_TEST_PAGE=/en/index.html checks the translated editor.
 * Requires Playwright, ffmpeg and ffprobe. All PNG fixtures are made by canvas.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const run = (command, args) => execFileSync(command, args, { maxBuffer: 64 * 1024 * 1024 });
const near = (actual, expected, tolerance = .02) => assert.ok(Math.abs(actual - expected) <= tolerance, `Expected ${expected}, got ${actual}`);
const rawFrame = (file, time = 0) => run('ffmpeg', ['-v', 'error', '-ss', String(time), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']);
function zipImage(buffer, index) {
  let offset = 0;
  for (let i = 0; i <= index; i++) {
    assert.equal(buffer.readUInt32LE(offset), 0x04034b50);
    assert.equal(buffer.readUInt16LE(offset + 8), 0);
    const start = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28);
    const end = start + buffer.readUInt32LE(offset + 18);
    if (i === index) return buffer.subarray(start, end);
    offset = end;
  }
}
async function main() {
  let playwright;
  try { playwright = require('playwright'); }
  catch (error) {
    if (!process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES) throw error;
    playwright = require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright'));
  }
  const out = process.env.IMAGE_TEST_OUT ? path.resolve(process.env.IMAGE_TEST_OUT) : fs.mkdtempSync(path.join(os.tmpdir(), 'jizura-images-'));
  fs.mkdirSync(out, { recursive: true });
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(ROOT, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(ROOT + path.sep)) return res.writeHead(403).end();
    fs.readFile(file, (error, bytes) => {
      if (error) return res.writeHead(404).end();
      res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html' : 'text/plain' }); res.end(bytes);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser, page;
  try {
    browser = await playwright.chromium.launch({ headless: true,
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
      args: ['--autoplay-policy=no-user-gesture-required'] });
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
    await page.goto('http://127.0.0.1:' + server.address().port + (process.env.IMAGE_TEST_PAGE || '/'));
    await page.waitForFunction(() => window.J && J.ui && J.ui.plan && J.uiApi.loadImageFiles);
    await page.evaluate(() => {
      J.uiApi.pause(); const p = J.ui.project;
      p.lyrics = '[00:00.00]IMAGE'; p.res = 180; p.fps = 12; p.style = 'noir'; p.seed = 123; p.includeAudio = false;
      p.fx = { motion: .5, glitch: 0, chroma: 0, decor: 0, density: 0, texture: 0, flash: false, onTwos: false, koma: 0, hud: 'off', bgSwitch: 0 };
      p.overrides = { 0: { single: true, layout: 'center', enter: 'cut', hold: 'still', exit: 'cut', decor: [], bg: 'none' } };
      p.timing = { bpm: 0, offset: 0, snap: false, tail: 0, lineTimes: {}, lineEnds: {}, lineScale: 1 };
      Object.assign(p.video, { dim: 0, textScale: .55, x: .5, y: .7, shadow: false, audioSource: 'mute' });
      J.uiApi.syncUI(); J.uiApi.replan();
      const a = document.createElement('canvas'), b = document.createElement('canvas');
      a.width = b.width = 320; a.height = b.height = 180;
      const r = new J.Renderer(), options = { scale: 320 / J.ui.plan.W };
      r.frame(a.getContext('2d'), J.ui.plan, .5, options);
      J.drawComposite(r, b.getContext('2d'), J.ui.plan, .5, { ...options, overlays: { data: { sources: [], layers: [] }, media: new Map() } });
      if (a.toDataURL() !== b.toDataURL()) throw new Error('An empty image track changes existing no-video rendering');
      window.imageTest = {
        canvas() { const c = document.createElement('canvas'); c.width = 320; c.height = 180; return c; },
        layer(sourceId, patch = {}) { return { id: 'test', sourceId, start: 0, end: 4, x: .5, y: .5, scale: .5, rotation: 0, opacity: 1, flip: false, enter: 'cut', hold: 'still', exit: 'cut', inDur: 1, outDur: 1, mode: 'whole', plane: 'aboveText', seed: 13, ...patch }; },
        stats(c) {
          const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          let pixels = 0, red = 0, green = 0, blue = 0, white = 0, maxAlpha = 0, minX = c.width, maxX = -1, minY = c.height, maxY = -1;
          for (let i = 0; i < d.length; i += 4) if (d[i + 3]) {
            pixels++; maxAlpha = Math.max(maxAlpha, d[i + 3]); const x = i / 4 % c.width, y = Math.floor(i / 4 / c.width);
            minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
            if (d[i] > 160 && d[i + 1] < 80 && d[i + 2] < 80) red++;
            if (d[i + 1] > 100 && d[i] < 80 && d[i + 2] < 80) green++;
            if (d[i + 2] > 160 && d[i] < 80 && d[i + 1] < 80) blue++;
            if (d[i] > 220 && d[i + 1] > 220 && d[i + 2] > 220) white++;
          }
          return { pixels, red, green, blue, white, maxAlpha, minX, maxX, minY, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
        },
        draw(layers, t = 1.5, plane = 'aboveText') {
          const c = this.canvas();
          J.drawImageOverlays(J.ui.renderer, c.getContext('2d'), J.ui.plan, t, { scale: c.width / J.ui.plan.W, overlays: { data: { sources: J.ui.project.images.sources, layers }, media: J.ui.images }, plane });
          return c;
        },
        base64(bytes) { let binary = ''; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(binary); },
      };
    });
    console.log('PASS empty image track preserves original lyric rendering');
    const fixtures = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 100; c.height = 60; const x = c.getContext('2d');
      x.fillStyle = '#ff0000'; x.fillRect(10, 10, 40, 40); x.fillStyle = '#00cc00'; x.fillRect(50, 10, 40, 40);
      const pattern = c.toDataURL().split(',')[1];
      x.clearRect(0, 0, 100, 60); x.fillStyle = '#0000ff'; x.fillRect(10, 10, 80, 40);
      return [pattern, c.toDataURL().split(',')[1]];
    });
    const files = fixtures.map((data, i) => { const f = path.join(out, i ? 'blue.png' : 'pattern.png'); fs.writeFileSync(f, Buffer.from(data, 'base64')); return f; });
    await page.setInputFiles('#imageFile', files);
    await page.waitForFunction(() => J.ui.images.size === 2 && J.ui.project.images.layers.length === 2);
    const ids = await page.evaluate(() => ({ layers: J.ui.project.images.layers.map(x => x.id), sources: J.ui.project.images.layers.map(x => x.sourceId) }));
    assert.equal(await page.locator('#imageLayerList [data-image-id]').count(), 2);
    const layerData = () => page.evaluate(() => JSON.parse(JSON.stringify(J.ui.project.images.layers)));
    async function choose(id) { await page.evaluate(id => J.uiApi.selectImageLayer(id), id); }
    async function patch(id, value) { await page.evaluate(({ id, value }) => J.uiApi.applyImageLayerPatch(id, value), { id, value }); }
    async function seek(time) { await page.evaluate(t => J.uiApi.seek(t), time); await page.waitForFunction(() => !J.ui.videoSeeking); await page.waitForTimeout(80); }
    const engine = await page.evaluate(({ sources }) => {
      const T = imageTest, src = sources[0], second = sources[1], layer = T.layer(src);
      const opaque = T.stats(T.draw([layer]));
      const half = T.stats(T.draw([{ ...layer, opacity: .5 }]));
      const zero = T.stats(T.draw([{ ...layer, opacity: 0 }]));
      const hiddenBefore = T.stats(T.draw([{ ...layer, start: 1, end: 2 }], .99)).pixels;
      const hiddenAfter = T.stats(T.draw([{ ...layer, start: 1, end: 2 }], 2)).pixels;
      const shortVisible = T.stats(T.draw([{ ...layer, start: 1, end: 1.01 }], 1.005)).pixels;
      const shifted = T.stats(T.draw([{ ...layer, x: .7, y: .65 }]));
      const small = T.stats(T.draw([{ ...layer, scale: .25 }]));
      const rotated = T.stats(T.draw([{ ...layer, rotation: 90 }]));
      const normal = T.draw([layer]), flip = T.draw([{ ...layer, flip: true }]);
      const a = normal.getContext('2d').getImageData(0, 0, 320, 180).data, b = flip.getContext('2d').getImageData(0, 0, 320, 180).data;
      let redNormalX = 0, redFlipX = 0, n = 0, f = 0;
      for (let i = 0; i < a.length; i += 4) {
        if (a[i] > 160 && a[i + 1] < 80 && a[i + 3] > 200) { redNormalX += i / 4 % 320; n++; }
        if (b[i] > 160 && b[i + 1] < 80 && b[i + 3] > 200) { redFlipX += i / 4 % 320; f++; }
      }
      const stacking = T.stats(T.draw([layer, T.layer(second, { id: 'top' })]));
      const reverse = T.stats(T.draw([T.layer(second, { id: 'bottom' }), layer]));
      const belowSkipped = T.stats(T.draw([{ ...layer, plane: 'belowText' }])).pixels;
      return { opaque, half, zero, hiddenBefore, hiddenAfter, shortVisible, shifted, small, rotated, redNormalX: redNormalX / n, redFlipX: redFlipX / f, stacking, reverse, belowSkipped };
    }, ids);
    assert.ok(engine.opaque.red > 200 && engine.opaque.green > 200, 'actual image colors render');
    near(engine.half.maxAlpha, 128, 1); assert.equal(engine.zero.pixels, 0, 'opacity 0 does not fall back to opaque');
    assert.equal(engine.hiddenBefore, 0); assert.equal(engine.hiddenAfter, 0); assert.ok(engine.shortVisible > 200, '10 ms cue is not lost to frame quantization');
    near(engine.shifted.minX - engine.opaque.minX, 64, 1); near(engine.shifted.minY - engine.opaque.minY, 27, 1);
    near(engine.small.width * 2, engine.opaque.width, 2); near(engine.rotated.width, engine.opaque.height, 2); near(engine.rotated.height, engine.opaque.width, 2);
    assert.ok(engine.redNormalX < 160 && engine.redFlipX > 160);
    assert.ok(engine.stacking.blue > 200 && engine.stacking.red === 0); assert.ok(engine.reverse.red > 200 && engine.reverse.blue === 0);
    assert.equal(engine.belowSkipped, 0);
    console.log('PASS image color/alpha, 0% and 50% opacity, exact cue boundaries, position/scale/rotate/flip and layer ordering');

    // Each advertised animation is executed on bitmap pieces, with all canvas
    // transform arguments checked. Samples cover its phase plus an intact frame.
    const catalog = await page.evaluate(({ sources }) => {
      const T = imageTest, records = [], failures = [], proto = CanvasRenderingContext2D.prototype;
      const wrapped = new Map(); let bitmapCalls = 0, textCalls = 0, invalid = null;
      for (const name of ['translate', 'rotate', 'scale', 'transform', 'setTransform', 'drawImage']) {
        const original = proto[name]; wrapped.set(name, original);
        proto[name] = function (...args) {
          if (name === 'drawImage') bitmapCalls++;
          const numbers = name === 'drawImage' ? args.slice(1) : args;
          if (numbers.some(x => typeof x === 'number' && !Number.isFinite(x))) invalid = name;
          return original.apply(this, args);
        };
      }
      for (const name of ['fillText', 'strokeText']) { const original = proto[name]; wrapped.set(name, original); proto[name] = function (...args) { textCalls++; return original.apply(this, args); }; }
      try {
        for (const phase of ['enter', 'hold', 'exit']) {
          const options = J.imageMotionOptions(phase);
          if (!Array.isArray(options) || !options.length) throw new Error('Empty image motion catalog: ' + phase);
          for (const option of options) {
            const layer = T.layer(sources[0], { [phase]: option.id, mode: 'tiles' });
            const times = phase === 'enter' ? [.35, .8, 1.5] : phase === 'exit' ? [1.5, 3.2, 3.65] : [1.6, 2.2];
            bitmapCalls = 0; textCalls = 0; invalid = null; let colorPixels = 0;
            try {
              for (const time of times) { const stats = T.stats(T.draw([layer], time)); colorPixels = Math.max(colorPixels, stats.red + stats.green); }
              if (invalid || !bitmapCalls || textCalls || colorPixels < 5) failures.push({ phase, id: option.id, invalid, bitmapCalls, textCalls, colorPixels });
            } catch (error) { failures.push({ phase, id: option.id, error: error.message }); }
          }
          records.push({ phase, count: options.length });
        }
      } finally { for (const [name, original] of wrapped) proto[name] = original; }
      return { records, failures };
    }, ids);
    assert.deepEqual(catalog.failures, [], 'every offered image effect draws colored bitmap content with finite transforms and no substituted text');
    console.log('PASS actual bitmap rendering for complete motion catalog: ' + catalog.records.map(x => x.phase + '=' + x.count).join(', '));

    const pieces = await page.evaluate(({ sources }) => {
      const T = imageTest;
      const enter = J.imageMotionOptions('enter').map(x => x.id).find(x => /assembl|scatter|gather|piece|burst|explode|shatter/i.test(x));
      const exit = J.imageMotionOptions('exit').map(x => x.id).find(x => /explod|shatter|scatter|burst|piece/i.test(x));
      if (!enter || !exit) throw new Error('Assembly and explosion image recipes must be offered');
      const counts = [];
      for (const mode of ['whole', 'tiles']) {
        const layer = T.layer(sources[0], { mode, enter, exit });
        const phases = [.4, 1.5, 3.6].map(t => T.draw([layer], t));
        counts.push({ mode, entry: phases[0].toDataURL(), hold: phases[1].toDataURL(), exit: phases[2].toDataURL(), visible: phases.map(c => T.stats(c).pixels) });
      }
      return { enter, exit, counts };
    }, ids);
    for (const item of pieces.counts) { assert.notEqual(item.entry, item.hold); assert.notEqual(item.exit, item.hold); assert.ok(item.visible[1] > 100); }
    assert.notEqual(pieces.counts[0].entry, pieces.counts[1].entry, 'tile assembly differs from whole-image motion');
    console.log(`PASS whole-image/tiled assembly (${pieces.enter}) and disintegration (${pieces.exit})`);

    await choose(ids.layers[0]);
    await page.locator('#imageTransparency').evaluate(el => { el.value = '50'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.locator('#imageX').fill('25'); await page.locator('#imageY').fill('25');
    await page.locator('#imageScale').fill('30'); await page.locator('#imageRotation').fill('0');
    await page.locator('#imageStart').fill('.1'); await page.locator('#imageEnd').fill('1.9');
    await page.locator('#imageEnter').selectOption('cut'); await page.locator('#imageHold').selectOption('still'); await page.locator('#imageExit').selectOption('cut');
    await page.locator('#imageApply').click();
    let layers = await layerData(); const first = layers.find(x => x.id === ids.layers[0]);
    near(first.opacity, .5); near(first.x, .25); near(first.y, .25); near(first.scale, .3); near(first.start, .1); near(first.end, 1.9);
    await page.locator('#imageDuplicate').click(); assert.equal((await layerData()).length, 3);
    await page.locator('#imageDelete').click(); assert.equal((await layerData()).length, 2);
    await page.locator('#imageUndo').click(); assert.equal((await layerData()).length, 3);
    await page.locator('#imageRedo').click(); assert.equal((await layerData()).length, 2);
    await choose(ids.layers[1]); await page.locator('#imageBack').click(); assert.equal((await layerData())[0].id, ids.layers[1]);
    await page.locator('#imageFront').click(); assert.equal((await layerData())[1].id, ids.layers[1]);
    console.log('PASS image controls, opacity conversion, duplication/deletion, undo/redo and front/back order');

    const imageOnly = await page.evaluate(({ sources }) => {
      const p = J.ui.project, backup = JSON.parse(JSON.stringify(p));
      try {
        p.lyrics = '[00:00.00]FIRST\n[00:01.00]SECOND';
        p.timing.lineTimes = { 0: 0, 1: 1 }; p.timing.lineEnds = { 0: 1, 1: 2 };
        const common = { single: true, layout: 'center', hold: 'still', decor: [], bg: 'none' };
        p.overrides = { 0: { ...common, enter: 'pop', exit: 'explode' }, 1: { ...common, enter: 'assemble', exit: 'blur', trans: J.TRANS_ORDER[0] } };
        J.uiApi.replan();
        const cuts = J.ui.plan.cuts.filter(x => x.line >= 0);
        const transition = { firstExit: cuts[0].exit, secondEnter: cuts.find(x => x.line === 1).enter, active: cuts.some(x => !!x.trans), saved: p.overrides[1].trans };
        p.lyrics = ''; p.overrides = {}; p.timing.lineTimes = {}; p.timing.lineEnds = {};
        p.images.layers[0].end = 3.2; p.images.layers[1].end = 5.4;
        J.uiApi.replan();
        const duration = J.ui.plan.duration;
        const T = imageTest, background = T.canvas(), composed = T.canvas(), alpha = T.canvas(), r = new J.Renderer();
        const plan = { ...J.ui.plan, cuts: [], events: [], style: { ...J.ui.plan.style, schemes: J.ui.plan.style.schemes.map(x => ({ ...x, bg: '#884422' })) } };
        const options = { scale: 320 / plan.W, overlays: { data: { sources: p.images.sources, layers: [T.layer(sources[0])] }, media: J.ui.images } };
        r.frame(background.getContext('2d'), plan, 1.5, { scale: options.scale, backgroundOnly: true });
        J.drawComposite(r, composed.getContext('2d'), plan, 1.5, options);
        J.drawComposite(r, alpha.getContext('2d'), plan, 1.5, { ...options, transparent: true });
        const pixel = (c, x, y) => Array.from(c.getContext('2d').getImageData(x, y, 1, 1).data);
        return { transition, duration, background: pixel(background, 5, 5), composedBackground: pixel(composed, 5, 5), image: pixel(composed, 140, 90), alphaBackground: pixel(alpha, 5, 5), alphaImage: pixel(alpha, 140, 90) };
      } finally { J.ui.project = backup; J.uiApi.syncUI(); J.uiApi.replan(); }
    }, ids);
    assert.equal(imageOnly.transition.firstExit, 'explode'); assert.equal(imageOnly.transition.secondEnter, 'assemble'); assert.equal(imageOnly.transition.active, false);
    assert.ok(imageOnly.transition.saved, 'the lyric-only transition choice stays in the saved project');
    near(imageOnly.duration, 5.4, .0001);
    assert.deepEqual(imageOnly.composedBackground, imageOnly.background, 'images-only composition preserves the selected style background');
    assert.ok(imageOnly.background[0] > imageOnly.background[1], 'the chosen warm background is visible');
    assert.deepEqual(imageOnly.image, [255, 0, 0, 255]); assert.deepEqual(imageOnly.alphaImage, [255, 0, 0, 255]); assert.equal(imageOnly.alphaBackground[3], 0);
    console.log('PASS images-only timeline duration/background/alpha and lyric entrance/exit preservation without full-frame transitions');

    // A source video supplies a predictable black base and a two-second edit.
    const video = path.join(out, 'black.mp4');
    run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=640x360:r=24:d=2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', video]);
    await page.setInputFiles('#videoFile', video); await page.waitForFunction(() => J.ui.media.size === 1 && !J.ui.videoLoading && !J.ui.videoSeeking);
    await patch(ids.layers[1], { start: .1, end: 1.9, x: .75, y: .25, scale: .3, rotation: 0, opacity: 1, enter: 'cut', hold: 'still', exit: 'cut', mode: 'whole', plane: 'aboveText' });
    await seek(.5);
    const planes = await page.evaluate(({ sources }) => {
      const T = imageTest, c = T.canvas(), r = new J.Renderer();
      // Text mark is deliberately controlled, so ordering is tested independently
      // of the installed font's exact glyph rasterization.
      r.frame = (ctx) => { ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height); ctx.fillStyle = '#fff'; ctx.fillRect(150, 80, 20, 20); };
      const layer = T.layer(sources[1], { scale: .5 });
      const result = {};
      for (const plane of ['belowText', 'aboveText']) {
        J.drawComposite(r, c.getContext('2d'), J.ui.plan, 1.5, { scale: c.width / J.ui.plan.W, video: J.ui.video, settings: { ...J.ui.project.video, textScale: 1, x: .5, y: .5, shadow: false }, overlays: { data: { sources: J.ui.project.images.sources, layers: [{ ...layer, plane }] }, media: J.ui.images } });
        result[plane] = Array.from(c.getContext('2d').getImageData(160, 90, 1, 1).data);
      }
      return result;
    }, ids);
    assert.deepEqual(planes.belowText, [255, 255, 255, 255]); assert.deepEqual(planes.aboveText, [0, 0, 255, 255]);
    console.log('PASS images can be composed below and above lyric animation');

    const saved = await page.evaluate(async () => {
      const original = J.saveFile; let value; J.saveFile = async (name, data) => { value = data; return 'saved'; };
      try { document.getElementById('btnSave').click(); await Promise.resolve(); } finally { J.saveFile = original; }
      return typeof value === 'string' ? value : await value.text();
    });
    const project = JSON.parse(saved); assert.equal(project.images.sources.length, 2); assert.equal(project.images.layers.length, 2);
    assert.ok(!saved.includes('blob:') && !saved.includes('data:image/'), 'project metadata never embeds temporary image URLs');
    await page.setInputFiles('#fileProject', { name: 'images.jizura.json', mimeType: 'application/json', buffer: Buffer.from(saved) });
    await page.waitForFunction(() => J.ui.images.size === 0 && J.ui.project.images.layers.length === 2);
    assert.deepEqual(await layerData(), project.images.layers);
    await page.setInputFiles('#videoFile', video); await page.waitForFunction(() => J.ui.media.size === 1 && !J.ui.videoLoading && !J.ui.videoSeeking);
    const missing = await page.evaluate(async () => {
      let saved = false; const original = J.saveFile; J.saveFile = async () => { saved = true; };
      try { await J.uiApi.runExport('mp4'); } finally { J.saveFile = original; }
      return { saved, text: [...document.querySelectorAll('.exp-text')].map(x => x.textContent).join(' '), message: document.body.innerText };
    });
    assert.equal(missing.saved, false, 'unresolved overlays block export instead of silently dropping them');
    const relink = files.map(file => ({ name: path.basename(file), data: fs.readFileSync(file).toString('base64') }));
    await page.evaluate(async input => {
      const files = input.map(x => new File([Uint8Array.from(atob(x.data), c => c.charCodeAt(0))], x.name, { type: 'image/png', lastModified: 1 }));
      await J.uiApi.loadImageFiles(files);
    }, relink);
    await page.waitForFunction(() => J.ui.images.size === 2);
    assert.deepEqual(await layerData(), project.images.layers, 'image relinking keeps layer IDs, timing, motion and order');
    await seek(.5);
    console.log('PASS project JSON preserves image edits; missing media blocks export; relinking restores images without extra layers');

    const capture = async transparent => page.evaluate(transparent => {
      const c = imageTest.canvas();
      J.drawComposite(new J.Renderer(), c.getContext('2d'), J.ui.plan, .5, { scale: c.width / J.ui.plan.W, transparent, video: J.ui.video, settings: J.ui.project.video, clip: J.videoClipAt(J.ui.editTimeline, .5), overlays: { data: J.ui.project.images, media: J.ui.images } });
      return imageTest.base64(c.getContext('2d').getImageData(0, 0, c.width, c.height).data);
    }, transparent);
    const preview = Buffer.from(await capture(false), 'base64'); const alphaPreview = Buffer.from(await capture(true), 'base64');
    const mp4Base64 = await page.evaluate(async () => {
      const save = J.saveFile; let blob; J.saveFile = async (name, value) => { blob = value; return 'saved'; };
      try { await J.uiApi.runExport('mp4'); } finally { J.saveFile = save; }
      if (!(blob instanceof Blob)) throw new Error('No MP4 saved: ' + document.querySelector('.exp-text').textContent);
      return imageTest.base64(new Uint8Array(await blob.arrayBuffer()));
    });
    const mp4 = path.join(out, 'image-overlays.mp4'); fs.writeFileSync(mp4, Buffer.from(mp4Base64, 'base64'));
    const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', mp4]));
    const stream = probe.streams.find(x => x.codec_type === 'video'); assert.equal(stream.width, 320); assert.equal(stream.height, 180); near(Number(probe.format.duration), 2, .15);
    const frame = rawFrame(mp4, .5); let maxDifference = 0;
    for (const [x, y] of [[68, 45], [92, 45], [240, 45], [5, 5]]) for (let c = 0; c < 4; c++) { const i = (y * 320 + x) * 4 + c; maxDifference = Math.max(maxDifference, Math.abs(frame[i] - preview[i])); }
    assert.ok(maxDifference < 13, 'MP4 image pixels match preview within AVC color tolerance: ' + maxDifference);
    const pngBase64 = await page.evaluate(async () => {
      const blob = await J.exportPNGZip({ plan: J.ui.plan, project: J.ui.project, sequence: { timeline: J.ui.editTimeline, media: J.ui.media }, video: J.ui.video, overlays: { data: J.ui.project.images, media: J.ui.images }, transparent: true, every: 6 });
      return imageTest.base64(new Uint8Array(await blob.arrayBuffer()));
    });
    const png = path.join(out, 'image-overlays-alpha.png'); fs.writeFileSync(png, zipImage(Buffer.from(pngBase64, 'base64'), 1));
    const alphaFrame = rawFrame(png); assert.deepEqual(alphaFrame, alphaPreview, 'transparent PNG raster equals the composed preview at its frame time');
    assert.equal(alphaFrame[3], 0, 'transparent export excludes the video base');
    near(alphaFrame[(45 * 320 + 68) * 4 + 3], 128, 1); assert.ok(alphaFrame[(45 * 320 + 240) * 4 + 2] > 240, 'transparent export retains source image colors and independent opacity');
    console.log('PASS real MP4 image pixels match preview; transparent PNG preserves image colors, alpha and lyric composition');

    const heldLayer = (await layerData()).find(layer => layer.id === ids.layers[0]);
    await patch(ids.layers[0], { start: 0, end: 2, enter: 'assemble', inDur: 1, outDur: .4, mode: 'tiles' });
    await seek(.5);
    const animatedPreview = Buffer.from(await capture(true), 'base64');
    assert.notDeepEqual(animatedPreview, alphaPreview, 'assembly is visibly in progress at the sampled frame');
    const animatedZip = await page.evaluate(async () => {
      const blob = await J.exportPNGZip({ plan: J.ui.plan, project: J.ui.project, sequence: { timeline: J.ui.editTimeline, media: J.ui.media }, video: J.ui.video, overlays: { data: J.ui.project.images, media: J.ui.images }, transparent: true, every: 6 });
      return imageTest.base64(new Uint8Array(await blob.arrayBuffer()));
    });
    const animatedPNG = path.join(out, 'image-overlays-animated-alpha.png'); fs.writeFileSync(animatedPNG, zipImage(Buffer.from(animatedZip, 'base64'), 1));
    assert.deepEqual(rawFrame(animatedPNG), animatedPreview, 'tiled assembly PNG preserves the exact moving image fragments seen in preview');
    await patch(ids.layers[0], heldLayer);
    console.log('PASS animated-phase transparent PNG exactly matches tiled image assembly preview');

    await page.evaluate(() => { J.ui.project.res = 720; J.uiApi.syncUI(); J.uiApi.replan(); }); await seek(.5);
    await page.locator('#toast').waitFor({ state: 'hidden' });
    await page.screenshot({ path: path.join(out, 'images-desktop.png'), fullPage: true });
    await page.locator('#imageEditor').screenshot({ path: path.join(out, 'images-controls-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(out, 'images-mobile.png'), fullPage: true });
    await page.locator('#imageEditor').screenshot({ path: path.join(out, 'images-controls-mobile.png') });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'mobile image controls do not overflow the page');
    assert.deepEqual(errors, [], 'no uncaught browser exceptions');
    console.log('PASS desktop/mobile image editor layout; no uncaught browser exceptions');
    console.log('Image overlay checks complete' + (process.env.IMAGE_TEST_OUT ? ': ' + out : ' (temporary artifacts removed)'));
  } catch (error) {
    if (page && process.env.IMAGE_TEST_OUT) {
      await page.screenshot({ path: path.join(out, 'images-failure.png'), fullPage: true }).catch(() => {});
      const state = await page.evaluate(() => window.J && J.ui ? { images: J.ui.project.images, t: J.ui.t, media: [...J.ui.images.keys()] } : null).catch(() => null);
      fs.writeFileSync(path.join(out, 'images-failure.json'), JSON.stringify(state, null, 2));
    }
    throw error;
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    if (!process.env.IMAGE_TEST_OUT) fs.rmSync(out, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
