/* Real browser regression checks for the non-destructive video editor.
 * python3 build.py && node dev/edit_browser_test.js
 * Dependencies: Playwright + Chromium, ffmpeg and ffprobe.
 * CHROMIUM_PATH can select an installed browser. EDIT_TEST_OUT retains artifacts.
 * EDIT_TEST_PAGE=/en/index.html exercises the English edition.
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
const near = (actual, expected, tolerance = .035) => assert.ok(Math.abs(actual - expected) < tolerance, `Expected ${expected}, got ${actual}`);
function assertColor(rgba, expected) {
  const [r, g, b] = rgba;
  assert.ok(expected === 'red' ? r > 180 && g < 65 && b < 65 : b > 180 && r < 65 && g < 65,
    `Expected ${expected}, got RGB ${r},${g},${b}`);
}
function zipImage(buffer, index = 0) {
  let offset = 0;
  for (let i = 0; i <= index; i++) {
    assert.equal(buffer.readUInt32LE(offset), 0x04034b50);
    assert.equal(buffer.readUInt16LE(offset + 8), 0, 'PNG archive stores uncompressed entries');
    const start = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28);
    const end = start + buffer.readUInt32LE(offset + 18);
    if (i === index) return buffer.subarray(start, end);
    offset = end;
  }
}
const rawFrame = (file, time = 0) => run('ffmpeg', ['-v', 'error', '-ss', String(time), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']);
function audioWindow(pcm, start, end) {
  const from = Math.floor(start * 48000), to = Math.min(Math.floor(end * 48000), pcm.length / 4);
  let energy = 0, crossings = 0, previous = pcm.readFloatLE(from * 4);
  for (let i = from; i < to; i++) {
    const value = pcm.readFloatLE(i * 4);
    energy += value * value;
    if (value >= 0 && previous < 0) crossings++;
    previous = value;
  }
  return { rms: Math.sqrt(energy / (to - from)), hz: crossings * 48000 / (to - from) };
}

async function main() {
  let playwright;
  try { playwright = require('playwright'); }
  catch (error) {
    if (!process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES) throw error;
    playwright = require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright'));
  }
  const out = process.env.EDIT_TEST_OUT ? path.resolve(process.env.EDIT_TEST_OUT) : fs.mkdtempSync(path.join(os.tmpdir(), 'jizura-edit-'));
  fs.mkdirSync(out, { recursive: true });
  const fixture = [path.join(out, 'red-440.mp4'), path.join(out, 'blue-880.mp4')];
  for (let i = 0; i < fixture.length; i++) {
    run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${i ? 'blue' : 'red'}:s=640x360:r=24:d=2`,
      '-f', 'lavfi', '-i', `sine=frequency=${i ? 880 : 440}:sample_rate=48000:duration=2`,
      '-vf', 'drawbox=x=0:y=0:w=40:h=360:color=white:t=fill', '-c:v', 'libx264', '-preset', 'ultrafast',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', fixture[i]]);
  }
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
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
    await page.goto('http://127.0.0.1:' + server.address().port + (process.env.EDIT_TEST_PAGE || '/'));
    await page.waitForFunction(() => window.J && J.ui && J.ui.plan && J.uiApi.loadVideoFiles);
    await page.evaluate(() => {
      J.uiApi.pause();
      const p = J.ui.project;
      p.lyrics = '[00:00.00]EDIT\n[00:01.00]MOVE'; p.res = 180; p.fps = 12;
      p.style = 'noir'; p.seed = 123;
      p.fx = { motion: .5, glitch: 0, chroma: 0, decor: 0, density: 0, texture: 0, flash: false, onTwos: false, koma: 0, hud: 'off', bgSwitch: 0 };
      p.overrides = { 0: { single: true, layout: 'center', enter: 'cut', hold: 'still', exit: 'cut', decor: [], bg: 'none' },
        1: { single: true, layout: 'center', enter: 'cut', hold: 'still', exit: 'cut', decor: [], bg: 'none' } };
      p.timing = { bpm: 0, offset: 0, snap: false, tail: 0, lineTimes: {}, lineScale: 1 };
      Object.assign(p.video, { dim: 0, textScale: .55, x: .5, y: .5, shadow: false, audioSource: 'video' });
      J.uiApi.syncUI(); J.uiApi.replan();
    });
    const clips = () => page.evaluate(() => JSON.parse(JSON.stringify(J.ui.project.edit.clips)));
    const duration = () => page.evaluate(() => J.ui.plan.duration);
    async function idle() { await page.waitForFunction(() => !J.ui.videoLoading && !J.ui.videoSeeking); }
    async function choose(id) { await page.evaluate(id => J.uiApi.selectClip(id), id); }
    async function patch(id, value) { await page.evaluate(({ id, value }) => J.uiApi.applyClipPatch(id, value), { id, value }); await idle(); }
    async function seek(time) {
      await page.evaluate(t => J.uiApi.seek(t), time);
      await idle();
      await page.waitForTimeout(90);
      return page.evaluate(() => {
        const c = document.getElementById('view');
        return Array.from(c.getContext('2d').getImageData(Math.round(c.width * .2), 0, 1, 1).data);
      });
    }
    async function click(id) { await page.locator(id).click(); await idle(); }
    async function exported(kind) {
      return page.evaluate(async kind => {
        const save = J.saveFile; let blob;
        J.saveFile = async (name, value) => { blob = value; return 'saved'; };
        try { await J.uiApi.runExport(kind); } finally { J.saveFile = save; }
        if (!(blob instanceof Blob)) throw new Error('No export was saved: ' + document.querySelector('.exp-text').textContent);
        const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = '';
        for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
        return btoa(binary);
      }, kind);
    }
    await page.setInputFiles('#videoFile', fixture);
    await page.waitForFunction(() => J.ui.project.edit.clips.length === 2 && J.ui.media.size === 2);
    await idle();
    const imported = await clips(), redId = imported[0].id, blueId = imported[1].id;
    near(await duration(), 4);
    assert.equal(await page.locator('#clipTimeline').count(), 1);
    assertColor(await seek(.5), 'red'); assertColor(await seek(2.5), 'blue');
    console.log('PASS multi-file import creates ordered clips and both sources decode');

    await choose(redId);
    await page.locator('#clipIn').fill('.25');
    await page.locator('#clipOut').fill('1.75');
    await click('#clipApply');
    near((await clips())[0].in, .25); near((await clips())[0].out, 1.75); near(await duration(), 3.5);
    await choose(redId); await seek(.75); await click('#clipSplit');
    let current = await clips();
    assert.equal(current.length, 3, 'split adds a clip');
    near(current[0].in, .25); near(current[0].out, 1);
    near(current[1].in, 1); near(current[1].out, 1.75); near(await duration(), 3.5);
    const splitId = current[1].id;
    await choose(splitId); await click('#clipDuplicate');
    current = await clips();
    assert.equal(current.length, 4);
    const duplicate = current.find(c => ![redId, splitId, blueId].includes(c.id));
    assert.ok(duplicate && duplicate.sourceId === imported[0].sourceId);
    await choose(duplicate.id); await click('#clipMoveLeft');
    assert.equal((await clips())[1].id, duplicate.id, 'move left changes clip order');
    await click('#clipMoveRight');
    assert.equal((await clips())[2].id, duplicate.id, 'move right changes clip order');
    await click('#clipDelete'); assert.equal((await clips()).length, 3);
    await click('#editUndo'); assert.equal((await clips()).length, 4, 'undo restores deleted clip');
    await click('#editRedo'); assert.equal((await clips()).length, 3, 'redo reapplies deletion');
    await patch(redId, { speed: 2, volume: .4, fadeIn: .1, fadeOut: .1 });
    near(await duration(), 3.125);
    current = await clips(); near(current[0].speed, 2); near(current[0].volume, .4);
    await patch(redId, { flip: true }); await seek(.2);
    const flipped = await page.evaluate(() => {
      const c = document.getElementById('view'), x = c.getContext('2d');
      return [Array.from(x.getImageData(2, 0, 1, 1).data), Array.from(x.getImageData(c.width - 3, 0, 1, 1).data)];
    });
    assertColor(flipped[0], 'red');
    assert.ok(flipped[1][0] > 180 && flipped[1][1] > 180 && flipped[1][2] > 180, 'flip moves white source stripe to the right');
    console.log('PASS trim, split, duplicate, reorder, remove, undo/redo, speed and horizontal flip');

    // A deterministic edited sequence exercises rate mapping, source switching,
    // per-clip gain, audio fades, and a silent final clip in one real MP4.
    await choose(splitId); await click('#clipDelete');
    await patch(redId, { in: .25, out: 1.75, speed: 1.5, volume: 1, fadeIn: 0, fadeOut: 0, flip: false });
    await patch(blueId, { in: .25, out: 1.25, speed: 1, volume: .7, fadeIn: .2, fadeOut: .2 });
    await choose(blueId); await click('#clipMoveLeft');
    await click('#clipDuplicate');
    current = await clips();
    const muteId = current.find(c => ![redId, blueId].includes(c.id)).id;
    await choose(muteId); await click('#clipMoveRight');
    await patch(muteId, { in: .25, out: .75, speed: 1, volume: 0, fadeIn: 0, fadeOut: 0 });
    near(await duration(), 2.5);
    assertColor(await seek(.4), 'blue');
    assertColor(await seek(1.4), 'red');
    const rate = await page.evaluate(() => ({ source: J.ui.video.element.currentTime, speed: J.ui.video.element.playbackRate }));
    near(rate.source, .85, .065); near(rate.speed, 1.5);
    assertColor(await seek(2.3), 'blue');
    assert.equal(await page.evaluate(() => { J.uiApi.play(); const muted = J.ui.video.element.muted || J.ui.video.element.volume === 0; J.uiApi.pause(); return muted; }), true, 'muted clip preview has no source audio');
    assertColor(await seek(.5), 'blue');
    near(await page.evaluate(() => { J.uiApi.play(); const volume = J.ui.video.element.volume; J.uiApi.pause(); return volume; }), .7, .08);
    await seek(.02);
    assert.ok(await page.evaluate(() => { J.uiApi.play(); const volume = J.ui.video.element.volume; J.uiApi.pause(); return volume < .2; }), 'clip fade scales preview volume');
    await seek(.86); await page.evaluate(() => J.uiApi.play());
    await page.waitForFunction(() => J.ui.t > 1.15, null, { timeout: 4000 });
    await page.evaluate(() => J.uiApi.pause()); await idle();
    assert.equal(await page.evaluate(id => J.ui.video === J.ui.media.get(id), imported[0].sourceId), true, 'playback changes media at clip boundary');
    const pausedT = await page.evaluate(() => J.ui.t);
    await page.waitForTimeout(130); near(await page.evaluate(() => J.ui.t), pausedT, .02);
    await page.evaluate(() => { J.uiApi.play(); J.uiApi.seek(.2); J.uiApi.seek(1.3); J.uiApi.seek(.6); J.uiApi.pause(); });
    await idle(); await page.waitForTimeout(100);
    near(await page.evaluate(() => J.ui.t), .6);
    assert.equal(await page.evaluate(() => J.ui.playing || !J.ui.video.element.paused), false, 'pending seek never undoes pause');
    await seek(2.3); await page.evaluate(() => { J.ui.loop = true; J.uiApi.play(); });
    await page.waitForFunction(() => J.ui.t > .1 && J.ui.t < .7, null, { timeout: 4000 });
    assert.equal(await page.evaluate(() => J.ui.playing), true);
    await page.evaluate(() => J.uiApi.pause());
    console.log('PASS edited source-time mapping, clip gain/fades/mute, boundary playback, rapid seek/pause and sequence looping');
    await page.evaluate(() => {
      const backups = [...J.ui.media.values()].map(media => ({ media, energy: media.audio.energy, rate: media.audio.energyRate }));
      try {
        backups.forEach(({ media }) => {
          media.audio.energyRate = 50;
          media.audio.energy = Float32Array.from({ length: 100 }, (_, i) => media.name.startsWith('red') ? 1 - i / 100 : i / 100);
        });
        J.uiApi.replan();
        const energy = J.ui.sequenceAudio.energy, rate = J.ui.sequenceAudio.energyRate;
        for (const [time, expected] of [[.02, .0091], [.4, .224], [1.4, .58], [2.3, 0]]) {
          const actual = energy[Math.round(time * rate)];
          if (Math.abs(actual - expected) > .002) throw new Error('Edited energy envelope at ' + time + ': expected ' + expected + ', got ' + actual);
        }
      } finally {
        backups.forEach(({ media, energy, rate }) => { media.audio.energy = energy; media.audio.energyRate = rate; });
        J.uiApi.replan();
      }
    });
    console.log('PASS audio-reactive energy follows edited source times, speed, volume and fades');


    const saved = await page.evaluate(async () => {
      const original = J.saveFile; let value;
      J.saveFile = async (name, data) => { value = data; return 'saved'; };
      try { document.getElementById('btnSave').click(); await Promise.resolve(); }
      finally { J.saveFile = original; }
      return typeof value === 'string' ? value : await value.text();
    });
    const savedProject = JSON.parse(saved);
    assert.equal(savedProject.edit.sources.length, 2);
    assert.equal(savedProject.edit.clips.length, 3);
    assert.ok(!saved.includes('blob:'), 'saved project has no temporary object URLs');
    await page.setInputFiles('#fileProject', { name: 'edited.jizura.json', mimeType: 'application/json', buffer: Buffer.from(saved) });
    await page.waitForFunction(() => J.ui.project.edit.clips.length === 3 && J.ui.media.size === 0);
    near(await duration(), 2.5);
    assert.deepEqual(await clips(), savedProject.edit.clips, 'unresolved media retains all edit decisions');
    const copiedFiles = fixture.map(file => ({ name: path.basename(file), base64: fs.readFileSync(file).toString('base64') }));
    await page.evaluate(async items => {
      const files = items.map(item => new File([Uint8Array.from(atob(item.base64), c => c.charCodeAt(0))], item.name, { type: 'video/mp4', lastModified: 1 }));
      await J.uiApi.loadVideoFiles(files);
    }, copiedFiles);
    await page.waitForFunction(() => J.ui.media.size === 2);
    await idle();
    assert.deepEqual(await clips(), savedProject.edit.clips, 'copied files with changed modification dates restore media without duplicating clips');
    near(await duration(), 2.5); assertColor(await seek(1.4), 'red');
    await page.evaluate(() => J.uiApi.flushSave());
    await page.reload();
    await page.waitForFunction(() => J.ui && J.ui.plan && J.ui.project.edit.clips.length === 3);
    assert.equal(await page.evaluate(() => J.ui.media.size), 0, 'reload leaves local media unresolved');
    assert.deepEqual(await clips(), savedProject.edit.clips);
    await page.setInputFiles('#videoFile', fixture); await page.waitForFunction(() => J.ui.media.size === 2); await idle();
    assert.equal((await clips()).length, 3);
    console.log('PASS JSON save/load, page reload, missing-media retention and source relinking without duplicate clips');

    await page.evaluate(() => { J.ui.project.res = 720; J.ui.project.fps = 24; J.uiApi.syncUI(); J.uiApi.replan(); });
    await seek(.5);
    await page.screenshot({ path: path.join(out, 'edit-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(out, 'edit-mobile.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'mobile editor does not overflow horizontally');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => { J.ui.project.res = 180; J.ui.project.fps = 12; J.uiApi.syncUI(); J.uiApi.replan(); });
    const mp4 = path.join(out, 'edited.mp4');
    fs.writeFileSync(mp4, Buffer.from(await exported('mp4'), 'base64'));
    const info = JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', mp4]));
    const video = info.streams.find(s => s.codec_type === 'video');
    assert.ok(video && info.streams.some(s => s.codec_type === 'audio'));
    near(Number(info.format.duration), 2.5, .2);
    for (const [time, expected] of [[.4, 'blue'], [1.4, 'red'], [2.3, 'blue']]) {
      const pixels = rawFrame(mp4, time);
      assertColor(pixels.subarray(Math.floor(video.width * .2) * 4), expected);
    }
    const pcm = run('ffmpeg', ['-v', 'error', '-i', mp4, '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-']);
    const blueTone = audioWindow(pcm, .3, .7), redTone = audioWindow(pcm, 1.2, 1.8);
    near(blueTone.hz, 880, 12);
    near(redTone.hz, 660, 12);
    assert.ok(blueTone.rms > .025 && redTone.rms > .025, 'audible clips contain decoded source audio');
    assert.ok(audioWindow(pcm, .005, .045).rms < blueTone.rms * .4, 'exported fade-in rises from silence');
    assert.ok(audioWindow(pcm, .94, .98).rms < blueTone.rms * .5, 'exported fade-out falls toward silence');
    assert.ok(audioWindow(pcm, 2.1, 2.45).rms < .003, 'muted final clip is silent in MP4');
    console.log('PASS actual MP4 decode: edited colors/order, 2.5 s duration, two source tones, gain/fades and muted tail');
    const pngData = await page.evaluate(async () => {
      const blob = await J.exportPNGZip({ plan: { ...J.ui.plan, duration: 1 }, project: J.ui.project,
        sequence: { timeline: J.ui.editTimeline, media: J.ui.media }, video: J.ui.video, transparent: true, every: 6 });
      const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = '';
      for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
      return btoa(binary);
    });
    const png = path.join(out, 'transparent.png');
    fs.writeFileSync(png, zipImage(Buffer.from(pngData, 'base64'), 1));
    const rgba = rawFrame(png); assert.equal(rgba[3], 0);
    let visible = 0;
    for (let i = 3; i < rgba.length; i += 4) if (rgba[i]) visible++;
    assert.ok(visible > 5 && visible < rgba.length / 8, 'transparent export contains only the text layer');

    // Removed sources stay available while undo/redo can bring their clips
    // back, then release their decoder/object URL after the history expires.
    const redUrl = await page.evaluate(sourceId => J.ui.media.get(sourceId).url, imported[0].sourceId);
    await choose(redId); await click('#clipDelete');
    assert.equal(await page.evaluate(sourceId => J.ui.media.get(sourceId).url, imported[0].sourceId), redUrl);
    await click('#editUndo');
    assert.ok((await clips()).some(clip => clip.id === redId), 'undo revives a clip using retained source media');
    await click('#editRedo');
    const pruned = await page.evaluate(({ redSourceId, blueId }) => {
      const media = J.ui.media.get(redSourceId);
      for (let i = 0; i < 61; i++) J.uiApi.applyClipPatch(blueId, { volume: i % 2 ? .7 : .6 });
      return { retained: J.ui.media.has(redSourceId), url: media.url, src: media.element.getAttribute('src') };
    }, { redSourceId: imported[0].sourceId, blueId });
    assert.deepEqual(pruned, { retained: false, url: null, src: null }, 'expired history releases unused source decoding resources');
    console.log('PASS undo/redo retains source media and expired history releases it');

    // The minimum legal source span (.04 s) at 4x creates a 10 ms clip.
    // Its playback must yield to the event loop, including repeated looping.
    const tiny = JSON.parse(saved);
    tiny.edit.clips = [{ ...tiny.edit.clips[0], in: .25, out: .29, speed: 4, volume: 0, fadeIn: 0, fadeOut: 0 }];
    await page.setInputFiles('#fileProject', { name: 'tiny.jizura.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(tiny)) });
    await page.waitForFunction(() => J.ui.media.size === 0 && J.ui.project.edit.clips.length === 1);
    await page.setInputFiles('#videoFile', fixture[1]); await page.waitForFunction(() => J.ui.media.size === 1); await idle();
    near(await duration(), .01, .00001);
    await page.evaluate(() => { J.ui.loop = true; J.uiApi.seek(0); }); await idle();
    const shortest = await Promise.race([
      page.evaluate(async () => { J.uiApi.play(); await new Promise(resolve => setTimeout(resolve, 160)); const result = { playing: J.ui.playing, time: J.ui.t, duration: J.ui.plan.duration }; J.uiApi.pause(); return result; }),
      new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('10 ms clip playback blocked the browser event loop')), 4000); timer.unref(); }),
    ]);
    assert.equal(shortest.playing, true); assert.ok(shortest.time >= 0 && shortest.time < shortest.duration);
    console.log('PASS 10 ms minimum-length clip playback and loop remain responsive');
    assert.deepEqual(errors, [], 'browser raises no uncaught exceptions');
    console.log('PASS transparent text PNG and mobile layout; no uncaught browser exceptions');
    console.log('Editor browser checks complete' + (process.env.EDIT_TEST_OUT ? ': ' + out : ' (temporary artifacts removed)'));
  } catch (error) {
    if (page && process.env.EDIT_TEST_OUT) {
      await page.screenshot({ path: path.join(out, 'edit-failure.png'), fullPage: true }).catch(() => {});
      const state = await page.evaluate(() => window.J && J.ui ? { edit: J.ui.project.edit, t: J.ui.t, timeline: J.ui.editTimeline, loading: !!J.ui.videoLoading, seeking: J.ui.videoSeeking } : null).catch(() => null);
      fs.writeFileSync(path.join(out, 'edit-failure.json'), JSON.stringify(state, null, 2));
    }
    throw error;
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    if (!process.env.EDIT_TEST_OUT) fs.rmSync(out, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
