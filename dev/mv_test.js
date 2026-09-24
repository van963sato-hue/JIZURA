/* MV regression checks.
 *   node dev/mv_test.js --unit
 *   python3 build.py && node dev/mv_test.js
 * Browser checks need Playwright + Chromium and ffmpeg/ffprobe on PATH:
 *   npm install --no-save playwright && npx playwright install chromium
 * Optionally set CHROMIUM_PATH to an existing Chrome executable.
 * Fixtures and exports are temporary; set MV_TEST_OUT to keep browser artifacts.
 * Use MV_TEST_PAGE=/en/index.html to test the English edition.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');

async function unitTests() {
  let created = 0, revoked = 0;
  const videos = [];
  class Video extends EventTarget {
    constructor() { super(); this.readyState = 0; this.duration = 3; this.videoWidth = 640; this.videoHeight = 360; this.time = 0; this.seeking = false; this.paused = true; }
    setAttribute() {}
    removeAttribute(name) { if (name === 'src') this.src = ''; }
    pause() { this.paused = true; }
    load() {
      if (this.src) setTimeout(() => { this.readyState = 2; this.dispatchEvent(new Event('loadeddata')); }, 1);
    }
    get currentTime() { return this.time; }
    set currentTime(value) {
      this.time = value; this.seeking = true;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => { this.seeking = false; this.dispatchEvent(new Event('seeked')); }, 4);
    }
  }
  function canvas(width = 320, height = 180) {
    const canvas = { width, height };
    const ctx = { canvas, calls: [], save() {}, restore() {}, setTransform() {},
      clearRect(...v) { this.calls.push(['clear', ...v]); },
      fillRect(...v) { this.calls.push(['fill', this.fillStyle, ...v]); },
      drawImage(...v) { this.calls.push(['draw', ...v]); } };
    canvas.getContext = () => ctx;
    return canvas;
  }
  const context = { J: {}, DOMException, setTimeout, clearTimeout, document: { createElement(tag) {
    if (tag === 'video') { const video = new Video(); videos.push(video); return video; }
    if (tag === 'canvas') return canvas();
    throw new Error('Unexpected element ' + tag);
  } }, URL: { createObjectURL: () => 'blob:' + ++created, revokeObjectURL: () => revoked++ } };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'src/10_video.js'), 'utf8'), context);
  const J = context.J;
  assert.equal(J.videoSettings({ textScale: 100, dim: -2, x: NaN, y: Infinity }).textScale, 1);
  assert.equal(J.videoSettings({ dim: -2 }).dim, 0);
  assert.equal(J.videoSettings({ x: NaN, y: Infinity }).x, 0.5);
  assert.equal(J.videoSettings({ audioSource: 'invalid' }).audioSource, 'video');
  const media = await J.loadVideo({ size: 12, name: 'mv.mp4' });
  assert.equal(media.duration, 3);
  assert.ok(media.element.readyState >= 2, 'import resolves with a drawable frame');
  await J.seekVideo(media.element, 0);
  await J.seekVideo(media.element, 2.5);
  await J.seekVideo(media.element, 0.25);
  assert.equal(media.element.currentTime, 0.25, 'backwards seeking works');
  const first = J.seekVideo(media.element, 1).then(() => null, e => e.name);
  await J.seekVideo(media.element, 2);
  assert.equal(await first, 'AbortError', 'latest scrub request supersedes previous request');
  await J.seekVideo(media.element, 99);
  assert.ok(media.element.currentTime < 3, 'end seeks stay on a decodable frame');
  const abortSeek = new AbortController();
  const seek = J.seekVideo(media.element, 1, abortSeek.signal);
  abortSeek.abort();
  await assert.rejects(seek, { name: 'AbortError' });
  const abortLoad = new AbortController();
  const load = J.loadVideo({ size: 12, name: 'cancel.mp4' }, { signal: abortLoad.signal });
  abortLoad.abort();
  await assert.rejects(load, { name: 'AbortError' });
  assert.equal(revoked, 1, 'cancelled import releases its object URL');

  const dest = canvas(320, 320), ctx = dest.getContext('2d');
  let drawnPlan = null, drawnOptions = null;
  const renderer = { frame(c, p, t, opt) { drawnPlan = p; drawnOptions = opt; } };
  const plan = { W: 1920, H: 1080, keyBg: 'green' };
  J.drawComposite(renderer, ctx, plan, 0.5, { video: media, settings: { dim: 0, shadow: false, fit: 'contain' } });
  const contain = ctx.calls.find(c => c[0] === 'draw' && c[1] === media.element);
  assert.deepEqual(contain.slice(2), [0, 70, 320, 180], 'contain keeps full video and letterboxes');
  assert.equal(drawnPlan.keyBg, null, 'MV composition does not inherit chroma key background');
  assert.ok(drawnOptions.transparent && drawnOptions.noTrans && drawnOptions.noPost && drawnOptions.noHud,
    'lyric rendering leaves source footage and its edges visible');
  ctx.calls.length = 0;
  J.drawComposite(renderer, ctx, plan, 0.5, { video: media, settings: { fit: 'cover', shadow: false } });
  const cover = ctx.calls.find(c => c[0] === 'draw' && c[1] === media.element);
  assert.ok(cover[2] < 0 && cover[3] === 0 && cover[4] > 320 && cover[5] === 320, 'cover fills square by cropping edges');
  ctx.calls.length = 0;
  J.drawComposite(renderer, ctx, plan, 0.5, { video: media, transparent: true, settings: { shadow: false } });
  assert.ok(!ctx.calls.some(c => c[0] === 'fill' || (c[0] === 'draw' && c[1] === media.element)),
    'transparent output never draws footage, dimming or opaque background');
  const plainOptions = { scale: 0.5 };
  J.drawComposite(renderer, ctx, plan, 0.5, plainOptions);
  assert.equal(drawnPlan, plan, 'no-video projects use their original render plan');
  assert.equal(drawnOptions, plainOptions, 'no-video projects use their original render options');
  J.releaseVideo(media);
  assert.equal(media.url, null);
  assert.equal(media.element.src, '');
  assert.equal(revoked, created, 'all imported URLs are released');
  console.log('PASS media settings, import/abort/release, seek supersession, composition and legacy routing');
}

function run(command, args) {
  return execFileSync(command, args, { encoding: null, maxBuffer: 64 * 1024 * 1024 });
}
function zipImage(buffer, index = 0) {
  let offset = 0;
  for (let i = 0; i <= index; i++) {
    assert.equal(buffer.readUInt32LE(offset), 0x04034b50);
    assert.equal(buffer.readUInt16LE(offset + 8), 0, 'PNG archive uses stored entries');
    const start = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28);
    const end = start + buffer.readUInt32LE(offset + 18);
    if (i === index) return buffer.subarray(start, end);
    offset = end;
  }
}
function probe(file) { return JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file])); }
function decodedFrame(file, time = 0) {
  return run('ffmpeg', ['-v', 'error', '-ss', String(time), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']);
}
function color(frame, expected) {
  const [r, g, b] = frame;
  assert.ok(expected === 'red' ? r > 180 && g < 50 && b < 50 : b > 180 && r < 50 && g < 50,
    `Expected ${expected} source frame, got RGB ${r},${g},${b}`);
}
async function browserTests() {
  let playwright;
  try { playwright = require('playwright'); }
  catch (e) {
    const modules = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
    if (!modules) throw new Error('Install Playwright and its Chromium browser; see dev/mv_test.js.');
    playwright = require(path.join(modules, 'playwright'));
  }
  const out = process.env.MV_TEST_OUT ? path.resolve(process.env.MV_TEST_OUT) : fs.mkdtempSync(path.join(os.tmpdir(), 'jizura-mv-'));
  fs.mkdirSync(out, { recursive: true });
  const fixture = path.join(out, 'fixture.mp4');
  run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=640x360:r=24:d=1.5',
    '-f', 'lavfi', '-i', 'color=c=blue:s=640x360:r=24:d=1.5', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3',
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-map', '2:a',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', fixture]);
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = pathname === '/fixture.mp4' ? fixture : path.resolve(ROOT, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (file !== fixture && !file.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': file.endsWith('.mp4') ? 'video/mp4' : file.endsWith('.html') ? 'text/html' : 'text/plain' }); res.end(data);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true,
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
      args: ['--autoplay-policy=no-user-gesture-required'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
    await page.goto('http://127.0.0.1:' + server.address().port + (process.env.MV_TEST_PAGE || '/'));
    await page.waitForFunction(() => window.J && J.ui && J.ui.plan);
    await page.evaluate(() => {
      J.uiApi.pause();
      const p = J.ui.project;
      p.lyrics = '[00:00.00]MOVE\n[00:01.50]AGAIN'; p.res = 180; p.fps = 12;
      p.style = 'noir'; p.seed = 123;
      p.fx = { motion: 0.5, glitch: 0, chroma: 0, decor: 0, density: 0, texture: 0, flash: false, onTwos: false, koma: 0, hud: 'off', bgSwitch: 0 };
      p.overrides = { 0: { single: true, layout: 'center', enter: 'pop', hold: 'still', exit: 'shrink', decor: [], bg: 'none' },
        1: { single: true, layout: 'center', enter: 'pop', hold: 'still', exit: 'shrink', decor: [], bg: 'none' } };
      p.timing = { bpm: 0, offset: 0, snap: false, tail: 0, lineTimes: {}, lineScale: 1 };
      J.uiApi.syncUI(); J.uiApi.replan();
      const a = document.createElement('canvas'), b = document.createElement('canvas');
      a.width = b.width = 320; a.height = b.height = 180;
      const renderer = new J.Renderer(), opts = { scale: 320 / J.ui.plan.W };
      renderer.frame(a.getContext('2d'), J.ui.plan, 0.5, opts);
      J.drawComposite(renderer, b.getContext('2d'), J.ui.plan, 0.5, opts);
      if (a.toDataURL() !== b.toDataURL()) throw new Error('No-video composition changes existing rendering');
    });
    console.log('PASS original no-video rendering is unchanged');
    await page.setInputFiles('#videoFile', fixture);
    await page.waitForFunction(() => J.ui.video && J.ui.video.duration > 0);
    await page.waitForFunction(() => !J.ui.videoLoading, null, { timeout: 30000 });
    const metadata = await page.evaluate(() => ({ name: J.ui.video.name, duration: J.ui.video.duration, width: J.ui.video.width, height: J.ui.video.height, timeline: J.ui.plan.duration }));
    assert.equal(metadata.width, 640); assert.equal(metadata.height, 360);
    assert.ok(Math.abs(metadata.duration - 3) < 0.05);
    assert.ok(Math.abs(metadata.timeline - 3) < 0.05, 'MV determines timeline duration');
    await page.evaluate(() => {
      Object.assign(J.ui.project.video, { dim: 0, textScale: 0.55, x: 0.5, y: 0.5, shadow: false, audioSource: 'video' });
      J.uiApi.syncUI(); J.uiApi.replan();
    });
    async function seekPixel(time) {
      await page.evaluate(t => J.uiApi.seek(t), time);
      await page.waitForFunction(t => !J.ui.video.element.seeking && Math.abs(J.ui.video.element.currentTime - t) < 0.06, time);
      await page.waitForTimeout(100);
      return page.evaluate(() => Array.from(document.getElementById('view').getContext('2d').getImageData(0, 0, 1, 1).data));
    }
    color(await seekPixel(0.5), 'red');
    color(await seekPixel(2.0), 'blue');
    color(await seekPixel(0.4), 'red');
    console.log('PASS real video import and forward/backward scrub show different decoded frames');
    await page.evaluate(() => J.uiApi.play());
    await page.waitForTimeout(300);
    await page.evaluate(() => J.uiApi.pause());
    const paused = await page.evaluate(() => ({ t: J.ui.t, media: J.ui.video.element.currentTime, paused: J.ui.video.element.paused }));
    assert.ok(paused.t > 0.5 && paused.paused);
    assert.ok(Math.abs(paused.t - paused.media) < 0.2, 'playback timeline and media stay synchronized');
    await page.waitForTimeout(150);
    assert.ok(Math.abs((await page.evaluate(() => J.ui.t)) - paused.t) < 0.03, 'pause freezes timeline');
    console.log('PASS play/pause and media synchronization');
    await page.evaluate(() => { J.uiApi.play(); J.uiApi.seek(2); });
    await page.waitForFunction(() => !J.ui.videoSeeking && J.ui.playing && !J.ui.video.element.paused);
    await page.waitForTimeout(180);
    assert.ok(await page.evaluate(() => J.ui.t > 2.05), 'seeking during playback resumes at requested position');
    await page.evaluate(() => {
      J.uiApi.seek(1.1); J.uiApi.seek(2.4); J.uiApi.seek(0.2); J.uiApi.seek(1.8); J.uiApi.pause();
    });
    await page.waitForFunction(() => !J.ui.videoSeeking);
    await page.waitForTimeout(150);
    const rapid = await page.evaluate(() => ({ t: J.ui.t, media: J.ui.video.element.currentTime, paused: J.ui.video.element.paused, playing: J.ui.playing }));
    assert.ok(!rapid.playing && rapid.paused, 'late seek completions must not undo pause');
    assert.ok(Math.abs(rapid.t - 1.8) < 0.02 && Math.abs(rapid.media - 1.8) < 0.02, 'latest rapid seek wins');
    await seekPixel(0);
    await page.evaluate(() => { J.ui.loop = true; J.uiApi.play(); });
    await page.waitForTimeout(3400);
    const looped = await page.evaluate(() => ({ t: J.ui.t, paused: J.ui.video.element.paused, playing: J.ui.playing }));
    assert.ok(looped.playing && !looped.paused && looped.t > 0.1 && looped.t < 1.2,
      'MV resumes after reaching EOF and loops back to its first frame: ' + JSON.stringify(looped));
    await page.evaluate(() => J.uiApi.pause());
    console.log('PASS seek during playback, rapid seek/pause race and full MV loop past EOF');
    await page.evaluate(() => {
      const p = JSON.parse(JSON.stringify(J.ui.project));
      p.timing.lineTimes = { 0: 0.6 }; p.timing.lineEnds = { 0: 0.68 };
      p.fx.koma = 12; p.overrides[0].enter = 'cut'; p.overrides[0].exit = 'cut';
      const plan = J.plan(p, { duration: 3 });
      if (plan.lines[0].start !== 0.6 || plan.lines[0].end !== 0.68) throw new Error('Manual times must override LRC cues');
      const cv = document.createElement('canvas'); cv.width = 320; cv.height = 180;
      const ctx = cv.getContext('2d'), renderer = new J.Renderer();
      function alphaAt(t) {
        J.drawComposite(renderer, ctx, plan, t, { video: J.ui.video, transparent: true, settings: p.video, scale: 320 / plan.W });
        const data = ctx.getImageData(0, 0, 320, 180).data;
        let sum = 0; for (let i = 3; i < data.length; i += 4) sum += data[i];
        return sum;
      }
      if (alphaAt(0.59) !== 0) throw new Error('Short cue appears before its manual start');
      if (alphaAt(0.63) <= 0) throw new Error('Short cue disappears due to animation frame quantization');
      if (alphaAt(0.69) !== 0 || alphaAt(1.1) !== 0) throw new Error('Explicit cue end must leave a real lyric-free gap');
    });
    console.log('PASS manual LRC overrides, short-cue boundaries and explicit lyric-free gaps');
    await seekPixel(2);
    // Use offered output options in UI screenshots; the encoding fixture stays tiny.
    await page.evaluate(() => { J.ui.project.res = 720; J.ui.project.fps = 24; J.uiApi.syncUI(); J.uiApi.replan(); });
    await page.screenshot({ path: path.join(out, 'editor-mv.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(out, 'editor-mobile.png'), fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    assert.equal(overflow, false, 'mobile editor does not overflow horizontally');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => { J.ui.project.res = 180; J.ui.project.fps = 12; J.uiApi.syncUI(); J.uiApi.replan(); });

    // Real WebCodecs encoding, muxing, frame decode and audible signal verification.
    const exported = await page.evaluate(async () => {
      if (!J.ui.video.audio || !J.ui.video.audio.buffer) throw new Error('MV import failed to preserve source audio');
      const original = J.saveFile;
      let blob;
      J.saveFile = async (name, value) => { blob = value; return 'saved'; };
      try { await J.uiApi.runExport('mp4'); } finally { J.saveFile = original; }
      if (!blob) throw new Error('UI export did not save MP4: ' + document.querySelector('.exp-text').textContent);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = ''; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
      return { data: btoa(binary) };
    });
    const mp4 = path.join(out, 'export.mp4');
    fs.writeFileSync(mp4, Buffer.from(exported.data, 'base64'));
    const info = probe(mp4);
    assert.ok(info.streams.some(s => s.codec_type === 'video'));
    assert.ok(info.streams.some(s => s.codec_type === 'audio'), 'source audio is included');
    assert.ok(Math.abs(Number(info.format.duration) - 3) < 0.2);
    color(decodedFrame(mp4, 0.5), 'red'); color(decodedFrame(mp4, 2), 'blue');
    const pcm = run('ffmpeg', ['-v', 'error', '-i', mp4, '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-']);
    let energy = 0; for (let i = 0; i + 4 <= pcm.length; i += 4) energy += pcm.readFloatLE(i) ** 2;
    assert.ok(Math.sqrt(energy / (pcm.length / 4)) > 0.02, 'exported audio contains the source signal');
    console.log('PASS UI MP4 export decodes with source footage changes and non-silent source audio');
    const pngData = await page.evaluate(async () => {
      const plan = { ...J.ui.plan, duration: 1 };
      const blob = await J.exportPNGZip({ plan, project: J.ui.project, video: J.ui.video, transparent: true, every: 6 });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = ''; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
      return btoa(binary);
    });
    const png = path.join(out, 'transparent.png');
    fs.writeFileSync(png, zipImage(Buffer.from(pngData, 'base64'), 1));
    const transparentFrame = decodedFrame(png);
    assert.equal(transparentFrame[3], 0, 'transparent PNG corners contain no video background');
    let visible = 0;
    for (let i = 3; i < transparentFrame.length; i += 4) if (transparentFrame[i] > 0) visible++;
    assert.ok(visible > 5 && visible < transparentFrame.length / 8, 'transparent PNG contains the lyric layer');
    console.log('PASS transparent PNG sequence excludes source footage');

    const saved = await page.evaluate(async () => {
      const original = J.saveFile;
      let data;
      J.saveFile = async (name, value) => { data = String(value); return 'saved'; };
      document.getElementById('btnSave').click();
      J.saveFile = original;
      return data;
    });
    const project = JSON.parse(saved);
    assert.equal(project.video.textScale, 0.55);
    assert.ok(!saved.includes('blob:'), 'project JSON must not persist unusable object URLs');
    await page.setInputFiles('#fileProject', { name: 'saved.jizura.json', mimeType: 'application/json', buffer: Buffer.from(saved) });
    await page.waitForFunction(() => J.ui.project.video.textScale === 0.55);
    await page.reload();
    await page.waitForFunction(() => J.ui && J.ui.plan);
    assert.equal(await page.evaluate(() => J.ui.project.video.textScale), 0.55);
    assert.equal(await page.evaluate(() => !!J.ui.video), false, 'reload requires local file reattachment');
    assert.deepEqual(errors, [], 'browser must not raise uncaught exceptions');
    console.log('PASS project save/load and reload preserve settings without persisting local media');
    await page.screenshot({ path: path.join(out, 'editor.png'), fullPage: true });
    console.log('Browser checks complete' + (process.env.MV_TEST_OUT ? ': ' + out : ' (temporary artifacts removed)'));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    if (!process.env.MV_TEST_OUT) fs.rmSync(out, { recursive: true, force: true });
  }
}

(async () => {
  await unitTests();
  if (!process.argv.includes('--unit')) await browserTests();
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
