/* Real media round trip for the MV production planner.
 * python3 build.py && node dev/director_browser_test.js
 * Requires Playwright, Chromium, ffmpeg and ffprobe. Set CHROMIUM_PATH to use
 * an installed browser, DIRECTOR_TEST_OUT to retain output, and
 * DIRECTOR_TEST_PAGE=/en/index.html to exercise the English edition.
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
const near = (actual, expected, epsilon = .035) => assert.ok(Math.abs(actual - expected) < epsilon, `Expected ${expected}, got ${actual}`);
function assertColor(pixel, color) {
  const [r, g, b] = pixel;
  assert.ok(color === 'red' ? r > 180 && g < 65 && b < 65 : b > 180 && r < 65 && g < 65,
    `Expected ${color}, got RGB ${r},${g},${b}`);
}
function audioWindow(pcm, start, end) {
  const from = Math.floor(start * 48000), to = Math.min(Math.floor(end * 48000), pcm.length / 4);
  let power = 0, crossings = 0, previous = pcm.readFloatLE(from * 4);
  for (let i = from; i < to; i++) {
    const value = pcm.readFloatLE(i * 4);
    power += value * value;
    if (value >= 0 && previous < 0) crossings++;
    previous = value;
  }
  return { rms: Math.sqrt(power / (to - from)), hz: crossings * 48000 / (to - from) };
}
async function main() {
  let playwright;
  try { playwright = require('playwright'); }
  catch (error) {
    if (!process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES) throw error;
    playwright = require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright'));
  }
  const out = process.env.DIRECTOR_TEST_OUT ? path.resolve(process.env.DIRECTOR_TEST_OUT) : fs.mkdtempSync(path.join(os.tmpdir(), 'jizura-director-'));
  fs.mkdirSync(out, { recursive: true });
  const song = path.join(out, 'original-song-330.wav');
  run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000:duration=12', '-c:a', 'pcm_s16le', song]);
  const fixture = [path.join(out, 'slot-001-red-880.mp4'), path.join(out, 'slot-002-blue-660.mp4')];
  for (let i = 0; i < fixture.length; i++) run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${i ? 'blue' : 'red'}:s=320x180:r=10:d=10`,
    '-f', 'lavfi', '-i', `sine=frequency=${i ? 660 : 880}:sample_rate=48000:duration=10`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', fixture[i]]);
  const short = path.join(out, 'too-short.mp4');
  run('ffmpeg', ['-y', '-v', 'error', '-i', fixture[0], '-t', '1', '-c', 'copy', short]);
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(ROOT, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(ROOT + path.sep)) return res.writeHead(403).end();
    fs.readFile(file, (error, data) => {
      if (error) return res.writeHead(404).end();
      res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html' : 'text/plain' }); res.end(data);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser, page;
  try {
    browser = await playwright.chromium.launch({ headless: true,
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
      args: ['--autoplay-policy=no-user-gesture-required'] });
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [], remote = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname === '127.0.0.1' || url.protocol === 'blob:' || url.protocol === 'data:') return route.continue();
      if (!/^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) remote.push(url.href);
      return route.abort();
    });
    await page.goto('http://127.0.0.1:' + server.address().port + (process.env.DIRECTOR_TEST_PAGE || '/'));
    await page.waitForFunction(() => window.J && J.ui && J.ui.plan && J.uiApi.loadAudioFile);
    const idle = () => page.waitForFunction(() => !J.ui.audioLoading && !J.ui.videoLoading && !J.ui.videoSeeking && !J.directorUI?.loading());
    const click = async id => { await page.locator(id).click(); await idle(); };
    async function seek(time) {
      await page.evaluate(t => J.uiApi.seek(t), time); await idle();
      return page.evaluate(() => {
        const c = document.getElementById('view');
        return Array.from(c.getContext('2d').getImageData(Math.floor(c.width * .1), 0, 1, 1).data);
      });
    }
    async function exported(kind) {
      return page.evaluate(async kind => {
        const original = J.saveFile; let blob;
        J.saveFile = async (name, value) => { blob = value; return 'saved'; };
        try { await J.uiApi.runExport(kind); } finally { J.saveFile = original; }
        if (!(blob instanceof Blob)) throw new Error('No export: ' + document.querySelector('.exp-text').textContent);
        const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = '';
        for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
        return btoa(binary);
      }, kind);
    }
    // Workflow checks are below; the plan's generated ids are intentionally read
    // from the application instead of reconstructed by this test.
    await page.setInputFiles('#audioFile', song); await idle();
    near(await page.evaluate(() => J.ui.audio.duration), 12);

    await page.waitForFunction(() => J.directorUI && J.directorDraft && J.directorAssemble);
    await page.evaluate(() => {
      J.uiApi.pause();
      const p = J.ui.project;
      p.lyrics = 'FIRST LIGHT\nSECOND SKY'; p.res = 90; p.fps = 2;
      p.style = 'noir'; p.seed = 123;
      p.fx = { motion: .5, glitch: 0, chroma: 0, decor: 0, density: 0, texture: 0, flash: false, onTwos: false, koma: 0, hud: 'off', bgSwitch: 0 };
      p.overrides = { 0: { single: true, layout: 'center', enter: 'cut', hold: 'still', exit: 'cut', decor: [], bg: 'none' },
        1: { single: true, layout: 'center', enter: 'cut', hold: 'still', exit: 'cut', decor: [], bg: 'none' } };
      p.timing = { bpm: 0, offset: 0, snap: false, tail: 0, lineTimes: {}, lineEnds: {}, lineScale: 1 };
      Object.assign(p.video, { dim: 0, textScale: .5, x: .5, y: .5, shadow: false, audioSource: 'audio' });
      J.uiApi.syncUI(); J.uiApi.replan();
      const lrc = J.directorDraft({ audio: J.ui.audio, lyrics: '[00:01.00]ONE\n[00:08.00]TWO', timing: { lineTimes: { 1: 9 }, lineEnds: { 0: 3 } } });
      if (lrc.lyrics[0].start !== 1 || lrc.lyrics[0].end !== 3 || lrc.lyrics[0].timing !== 'lrc' || lrc.lyrics[1].start !== 9 || lrc.lyrics[1].timing !== 'confirmed') throw new Error('LRC/manual timestamps lost');
      if (lrc.song.analysis.vocalAlignment !== false || lrc.song.analysis.tempo !== 'estimated') throw new Error('Audio analysis overclaims timing recognition');
    });
    await page.locator('#directorPanel > summary').click();
    await page.locator('#directorConcept').fill('A bird leaves the red shore and reaches the blue sky.');
    await page.locator('#directorIdentity').fill('Exactly one white bird. Preserve its shape.');
    await page.locator('#directorStyle').fill('Watercolor backgrounds, cel-shaded subject.');
    await click('#directorDraft');
    const model = () => page.evaluate(() => JSON.parse(JSON.stringify(J.ui.project.director)));
    let draft = await model();
    assert.equal(draft.song.duration, 12);
    assert.deepEqual(draft.storyboard, { rows: 3, cols: 3, ratio: '16:9', secondsPerSheet: 10 });
    assert.equal(draft.segments.length, 2);
    assert.deepEqual(draft.segments.map(s => [s.id, s.start, s.end, s.generationDuration, s.panels.length]), [['S001', 0, 10, 10, 9], ['S002', 10, 12, 10, 9]]);
    assert.ok(draft.lyrics.every(row => row.timing === 'estimated'));
    console.log('PASS actual song analysis and 10+2 s plan: two 16:9 / 3×3 sheets, 18 ordered panels, honest provisional timing');

    const packDownload = page.waitForEvent('download');
    await click('#directorDownloadPack');
    const downloaded = await packDownload, pack = fs.readFileSync(await downloaded.path(), 'utf8');
    assert.ok(pack && pack.includes('"segments"') && pack.includes('S001'));
    const prompts = await page.evaluate(() => {
      const m = J.ui.project.director, s = m.segments[0];
      return { sheet: J.directorStoryboardPrompt(s, m), video: J.directorVideoPrompt(s, m) };
    });
    assert.match(prompts.sheet, /3 columns × 3 rows/);
    assert.match(prompts.sheet, /No lyrics, letters/);
    assert.match(prompts.video, /full-frame/);
    assert.match(prompts.video, /never the entire 3×3 sheet/);
    assert.match(prompts.video, /Generated audio will be muted/);
    const bad = structuredClone(draft); bad.segments[0].end = 9;
    const badInput = JSON.stringify(bad);
    await page.setInputFiles('#directorImport', { name: 'invalid-production.json', mimeType: 'application/json', buffer: Buffer.from(badInput) });
    await page.waitForTimeout(60);
    assert.deepEqual(await model(), draft, 'invalid GPT import is atomic');
    const response = structuredClone(draft);
    response.lyrics.forEach(row => { row.timing = 'confirmed'; });
    response.segments.forEach((s, i) => {
      s.summary = i ? 'Bird reaches the blue sky' : '<img src=x onerror="window.directorInjected=true">';
      s.continuity = 'One bird, white feathers, continuous left-to-right motion.';
      s.sourceId = 'untrusted-video-id';
      s.panels.forEach((p, j) => { p.scene = `The same white bird flies toward ${i ? 'blue sky' : 'red shore'}, moment ${j + 1}.`; p.frameOptions = ['full', 'low', 'diagonal']; });
    });
    await page.setInputFiles('#directorImport', { name: 'production.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(response)) });
    await page.waitForFunction(() => J.ui.project.director.segments[0].summary.includes('<img'));
    draft = await model();
    assert.ok(draft.lyrics.every(row => row.timing === 'estimated'), 'GPT cannot mark its own guesses reviewed');
    assert.ok(draft.segments.every(s => s.sourceId === null), 'GPT cannot choose local source IDs');
    assert.equal(await page.evaluate(() => !!window.directorInjected), false, 'GPT text is never executed as HTML');
    assert.equal(await page.locator('#directorSegments img[src="x"]').count(), 0);
    assert.equal(await page.locator('#directorAssemble').isEnabled(), false, 'assembly is gated until required reviews and media are ready');
    await page.evaluate(() => {
      const next = JSON.parse(JSON.stringify(J.ui.project.director));
      next.segments[0].summary = 'A white bird leaves the red shore.';
      J.directorUI.importModel(next);
    });
    console.log('PASS GPT production pack export, valid import, invalid import rollback, untrusted text and review-state isolation');

    // FRAME links are recipes of explicit composition choices, never copies of
    // source lyrics. They are created locally without network calls.
    const frame = await page.locator('#directorSegments a.director-frame').first().getAttribute('href');
    assert.ok(frame && frame.startsWith('https://frame-composition-atelier.lycov.chatgpt.site/#recipe='));
    const encoded = new URL(frame).hash.split('recipe=')[1].replace(/-/g, '+').replace(/_/g, '/');
    const recipe = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    assert.equal(recipe.version, 1); assert.equal(recipe.state.ratio, '16:9');
    assert.equal(recipe.state.lettering, '');
    assert.ok(!JSON.stringify(recipe).includes('FIRST LIGHT') && !JSON.stringify(recipe).includes('SECOND SKY'), 'review links omit source lyrics');
    assert.ok(recipe.state.selected.includes('full') && recipe.state.selected.includes('low'));
    console.log('PASS canonical FRAME recipe links preserve composition and omit lyrics / image lettering');

    await page.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 540;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = 'red'; ctx.fillRect(0, 0, 960, 540);
      ctx.fillStyle = '#00ff00'; ctx.fillRect(0, 0, 320, 180);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      await J.directorUI.loadStoryboard(new File([blob], 'S001-storyboard.png', { type: 'image/png' }), 'S001');
    });
    const firstFrameDownload = page.waitForEvent('download');
    await click('[data-segment-id="S001"] [data-action="first-frame"]');
    const firstFrame = await firstFrameDownload;
    const firstFramePath = path.join(out, 'S001-first-frame.png'); await firstFrame.saveAs(firstFramePath);
    const firstInfo = JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', firstFramePath]));
    assert.equal(firstInfo.streams[0].width, 320); assert.equal(firstInfo.streams[0].height, 180);
    const pixel = run('ffmpeg', ['-v', 'error', '-i', firstFramePath, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']);
    assert.ok(pixel[1] > 200 && pixel[0] < 30 && pixel[2] < 30, 'start image contains only the first storyboard panel');
    console.log('PASS storyboard stays a reference and a separate full-frame start image can be saved');

    const timingDetails = page.locator('#directorTiming').locator('xpath=ancestor::details[1]');
    await timingDetails.locator('summary').click();
    await page.locator('#directorConfirmAll').check();
    assert.ok((await model()).lyrics.every(row => row.timing === 'confirmed'));
    const priorEdit = await page.evaluate(() => JSON.stringify(J.ui.project.edit));
    const failures = await page.evaluate(() => {
      const m = J.ui.project.director, results = [];
      try { J.directorAssemble(m, new Map()); } catch (e) { results.push(e.message); }
      const short = JSON.parse(JSON.stringify(m)); short.segments[0].sourceId = 'short';
      try { J.directorAssemble(short, new Map([['short', { duration: 1 }]])); } catch (e) { results.push(e.message); }
      return results;
    });
    assert.equal(failures.length, 2, 'missing and short source videos are refused');
    assert.equal(await page.evaluate(() => JSON.stringify(J.ui.project.edit)), priorEdit, 'failed assembly leaves previous edits untouched');

    // Import the tail slot first to prove that timeline order follows IDs, not
    // the order files arrive in. Both generated videos are ten seconds long.
    const slotFile = (file, name) => ({ name, mimeType: 'video/mp4', buffer: fs.readFileSync(file) });
    await page.setInputFiles('#directorVideos', [slotFile(fixture[1], 'S002.mp4'), slotFile(fixture[0], 'S001.mp4')]);
    await page.waitForFunction(() => J.ui.project.director.segments.every(s => s.sourceId && J.ui.media.has(s.sourceId)));
    await idle();
    assert.equal(await page.locator('#directorAssemble').isEnabled(), true);
    const assigned = await model();
    const assignedNames = await page.evaluate(() => J.ui.project.director.segments.map(s => J.ui.media.get(s.sourceId).name));
    assert.deepEqual(assignedNames, ['S001.mp4', 'S002.mp4']);
    await click('#directorAssemble');
    const assembled = await page.evaluate(() => ({ duration: J.ui.plan.duration, edit: J.ui.project.edit, audioSource: J.ui.project.video.audioSource, ratio: J.ui.project.ratio, timing: J.ui.project.timing, lyrics: J.ui.project.lyrics }));
    near(assembled.duration, 12);
    assert.equal(assembled.edit.clips.length, 2);
    assert.deepEqual(assembled.edit.clips.map(c => [c.in, c.out, c.speed, c.volume]), [[0, 10, 1, 0], [0, 2, 1, 0]]);
    assert.equal(assembled.audioSource, 'audio');
    assert.deepEqual(assembled.edit.clips.map(c => c.sourceId), assigned.segments.map(s => s.sourceId));
    assert.equal(assembled.timing.lineTimes[0], assigned.lyrics[0].start);
    assert.equal(assembled.timing.lineTimes[1], assigned.lyrics[1].start);
    assert.equal(assembled.timing.lineEnds[1], assigned.lyrics[1].end);
    assertColor(await seek(1), 'red'); assertColor(await seek(11), 'blue');
    await click('#directorRestore');
    assert.equal(await page.evaluate(() => JSON.stringify(J.ui.project.edit)), priorEdit, 'assembly undo restores the previous footage arrangement');
    assert.equal(await page.evaluate(() => J.ui.project.lyrics), 'FIRST LIGHT\nSECOND SKY');
    await click('#directorAssemble');
    near(await page.evaluate(() => J.ui.plan.duration), 12);
    console.log('PASS reverse-arrival slot mapping and atomic assembly: exact source order, tail trim, original song, reviewed lyric timing');

    const mp4 = path.join(out, 'assembled.mp4');
    fs.writeFileSync(mp4, Buffer.from(await exported('mp4'), 'base64'));
    const info = JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', mp4]));
    const video = info.streams.find(s => s.codec_type === 'video');
    assert.ok(video && info.streams.some(s => s.codec_type === 'audio'));
    near(Number(info.format.duration), 12, .12);
    for (const [time, color] of [[1, 'red'], [11, 'blue']]) {
      const pixels = run('ffmpeg', ['-v', 'error', '-ss', String(time), '-i', mp4, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']);
      assertColor(pixels.subarray(Math.floor(video.width * .1) * 4), color);
    }
    const pcm = run('ffmpeg', ['-v', 'error', '-i', mp4, '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-']);
    for (const [start, end] of [[.3, 2], [10.3, 11.7]]) {
      const tone = audioWindow(pcm, start, end); near(tone.hz, 330, 5); assert.ok(tone.rms > .03);
    }
    console.log('PASS real MP4: twelve seconds, red → blue footage, original 330 Hz song only in both clips');

    const saved = await page.evaluate(async () => {
      const original = J.saveFile; let value;
      J.saveFile = async (name, data) => { value = data; return 'saved'; };
      try { document.getElementById('btnSave').click(); await Promise.resolve(); } finally { J.saveFile = original; }
      return typeof value === 'string' ? value : await value.text();
    });
    assert.ok(!saved.includes('blob:') && !saved.includes('base64'), 'project stores metadata, not temporary URLs or source media');
    assert.ok(!/api[_-]?key|authorization|bearer/i.test(saved), 'project does not carry credentials');
    await page.setInputFiles('#fileProject', { name: 'finished.jizura.json', mimeType: 'application/json', buffer: Buffer.from(saved) });
    await page.waitForFunction(() => J.ui.media.size === 0 && !!J.ui.project.director);
    await page.setInputFiles('#audioFile', song); await idle();
    await page.setInputFiles('#directorVideos', [slotFile(fixture[1], 'S002.mp4'), slotFile(fixture[0], 'S001.mp4')]);
    await page.waitForFunction(() => J.ui.media.size === 2);
    await idle();
    assert.equal(await page.evaluate(() => J.ui.project.edit.clips.length), 2);
    assert.deepEqual((await model()).segments.map(s => s.sourceId), assigned.segments.map(s => s.sourceId), 'relink preserves production slot IDs');
    assert.equal(await page.locator('#clipMissing').isVisible(), false, 'relink clears the normal video editor missing-media warning');
    assertColor(await seek(11), 'blue');
    await page.evaluate(() => { document.getElementById('directorPanel').open = true; });
    await page.screenshot({ path: path.join(out, 'director-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(out, 'director-mobile.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'production editor fits a narrow viewport');
    if (process.env.DIRECTOR_TEST_PAGE?.startsWith('/en/')) {
      assert.equal(await page.locator('#directorPanel').evaluate(el => /[ぁ-んァ-ヶ一-龯]/.test(el.textContent)), false, 'English production panel is fully localized');
    }
    console.log('PASS project save/reopen, source relink and mobile layout');

    assert.deepEqual(remote, [], 'planning and assembly never send files or generation requests to external services');
    assert.deepEqual(errors, [], 'browser has no uncaught exceptions');
    console.log('MV production browser checks complete' + (process.env.DIRECTOR_TEST_OUT ? ': ' + out : ' (temporary artifacts removed)'));
  } catch (error) {
    if (page && process.env.DIRECTOR_TEST_OUT) {
      await page.screenshot({ path: path.join(out, 'director-failure.png'), fullPage: true }).catch(() => {});
      const state = await page.evaluate(() => window.J && J.ui ? { project: J.ui.project, time: J.ui.t, duration: J.ui.plan.duration } : null).catch(() => null);
      fs.writeFileSync(path.join(out, 'director-failure.json'), JSON.stringify(state, null, 2));
    }
    throw error;
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    if (!process.env.DIRECTOR_TEST_OUT) fs.rmSync(out, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
