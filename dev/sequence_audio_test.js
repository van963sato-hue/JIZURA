/* Focused editing export checks using a real OfflineAudioContext.
 *   node dev/sequence_audio_test.js
 * Requires Playwright + Chromium (same setup as dev/mv_test.js).
 * Video encoder doubles isolate decoder ownership and cancellation; full media
 * encoding is covered by the browser editor regression suite.
 */
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');

(async () => {
  let playwright;
  try { playwright = require('playwright'); }
  catch (e) { playwright = require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright')); }
  const browser = await playwright.chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  try {
    const page = await browser.newPage();
    await page.evaluate(() => { window.J = {}; });
    for (const file of ['src/10_video.js', 'src/10a_edit.js', 'src/11_export.js']) {
      await page.addScriptTag({ path: path.join(ROOT, file) });
    }
    const audio = await page.evaluate(async () => {
      const makeBuffer = values => {
        const buffer = new AudioBuffer({ length: 48000 * values.length, sampleRate: 48000, numberOfChannels: 1 });
        values.forEach((value, i) => buffer.getChannelData(0).fill(value, i * 48000, (i + 1) * 48000));
        return buffer;
      };
      const edit = J.normalizeVideoEdit({ sources: [{ id: 'a', name: 'A', duration: 2 }, { id: 'b', name: 'B', duration: 1 }],
        clips: [
          { id: 'a2', sourceId: 'a', in: 1, out: 2, speed: 2, volume: 0.5 },
          { id: 'b1', sourceId: 'b', in: 0, out: 0.5, volume: 0.25 },
          { id: 'a1', sourceId: 'a', in: 0, out: 1, fadeIn: 0.2, fadeOut: 0.2 },
        ] });
      const sequence = { timeline: J.buildVideoTimeline(edit), media: new Map([
        ['a', { name: 'A', audio: { buffer: makeBuffer([0.4, -0.2]) } }],
        ['b', { name: 'B', audio: { buffer: makeBuffer([0.8]) } }],
      ]) };
      const rendered = await J.renderSequenceAudio(sequence);
      const sample = t => rendered.buffer.getChannelData(0)[Math.round(t * 48000)];
      const missing = { ...sequence, media: new Map([['a', sequence.media.get('a')]]) };
      let missingError = '', silentError = '', aborted = '';
      try { await J.renderSequenceAudio(missing); } catch (e) { missingError = e.message; }
      sequence.media.get('b').audio = null;
      try { await J.renderSequenceAudio(sequence); } catch (e) { silentError = e.message; }
      const muted = { ...sequence, timeline: { ...sequence.timeline, clips: sequence.timeline.clips.map(c => ({ ...c, volume: 0 })) } };
      const muteResult = await J.renderSequenceAudio(muted);
      const controller = new AbortController(); controller.abort();
      try { await J.renderSequenceAudio(sequence, { signal: controller.signal }); } catch (e) { aborted = e.name; }
      return { duration: rendered.buffer.duration, channels: rendered.buffer.numberOfChannels,
        samples: [0.25, 0.75, 1.1, 1.5, 1.9].map(sample), missingError, silentError, muted: muteResult === null, aborted };
    });
    assert.equal(audio.duration, 2);
    assert.equal(audio.channels, 1);
    for (const [index, expected] of [-0.1, 0.2, 0.2, 0.4, 0.2].entries()) {
      assert.ok(Math.abs(audio.samples[index] - expected) < 0.002, `Audio sample ${index}: ${audio.samples[index]} versus ${expected}`);
    }
    assert.match(audio.missingError, /B/); assert.match(audio.silentError, /B/);
    assert.ok(audio.muted); assert.equal(audio.aborted, 'AbortError');
    console.log('PASS real offline audio trim, reorder, speed, gain, fades, mute and missing-source errors');

    const resources = await page.evaluate(async () => {
      J.outputSize = () => [32, 32];
      J.glyphs = { maxRes: 123 };
      J.Renderer = class {};
      J.drawComposite = () => {};
      J.pickVideoCodec = async () => ({ mux: 'avc', label: 'Test', cfg: {} });
      window.VideoFrame = class { close() {} };
      window.VideoEncoder = class {
        constructor() { this.state = 'unconfigured'; this.encodeQueueSize = 0; }
        configure() { this.state = 'configured'; }
        encode() {}
        async flush() {}
        close() { this.state = 'closed'; }
      };
      window.Mp4Muxer = {
        ArrayBufferTarget: class { constructor() { this.buffer = new ArrayBuffer(0); } },
        Muxer: class { addVideoChunk() {} finalize() {} },
      };
      const timeline = J.buildVideoTimeline({ sources: [{ id: 'a', duration: 2 }, { id: 'b', duration: 2 }],
        clips: [
          { sourceId: 'a', in: 1, out: 2, speed: 2 },
          { sourceId: 'b', in: 0, out: 0.5 },
          { sourceId: 'a', in: 0, out: 0.5 },
        ] });
      const sequence = { timeline, media: new Map([['a', { file: { name: 'a' } }], ['b', { file: { name: 'b' } }]]) };
      const plan = { fps: 2, duration: timeline.duration, W: 32 };
      const project = { includeAudio: false, video: { audioSource: 'video' } };
      let loaded = [], released = [], seeks = [];
      J.loadVideo = async file => { loaded.push(file.name); return { element: { name: file.name } }; };
      J.releaseVideo = media => released.push(media.element.name);
      J.seekVideo = async (element, time) => seeks.push([element.name, time]);
      await J.exportMP4({ plan, project, sequence });
      const reuse = { loaded: [...loaded], released: [...released], seeks: [...seeks], resolution: J.glyphs.maxRes };
      loaded = []; released = []; seeks = [];
      const controller = new AbortController();
      let abortName = '';
      try { await J.exportMP4({ plan, project, sequence, signal: controller.signal, onProgress: () => controller.abort() }); }
      catch (e) { abortName = e.name; }
      const abort = { name: abortName, loaded: [...loaded], released: [...released], resolution: J.glyphs.maxRes };
      loaded = []; released = [];
      J.loadVideo = async file => {
        loaded.push(file.name);
        if (file.name === 'b') throw new Error('decoder failure');
        return { element: { name: file.name } };
      };
      let failure = '';
      try { await J.exportMP4({ plan, project, sequence }); } catch (e) { failure = e.message; }
      const failed = { message: failure, loaded: [...loaded], released: [...released], resolution: J.glyphs.maxRes };
      loaded = []; released = [];
      await J.exportPNGZip({ plan, project, sequence, transparent: true });
      const transparentLoads = loaded.length, transparentReleases = released.length;
      // A separate soundtrack follows the output clock, irrespective of source
      // cuts or speed; missing source audio must never block this export mode.
      J.loadVideo = async file => ({ element: { name: file.name } });
      J.pickAudioCodec = async () => ({ codec: 'test', sr: 48000, mux: 'aac' });
      const encoded = [];
      window.AudioData = class { constructor(options) { Object.assign(this, options); } close() {} };
      window.AudioEncoder = class extends VideoEncoder { encode(data) { encoded.push({ sample: data.data[0], timestamp: data.timestamp }); } };
      const soundtrack = new AudioBuffer({ length: 48000, sampleRate: 48000, numberOfChannels: 1 });
      soundtrack.getChannelData(0).fill(0.3);
      await J.exportMP4({ plan, project: { includeAudio: true, video: { audioSource: 'audio' } }, sequence, audio: { buffer: soundtrack } });
      const external = [...encoded]; encoded.length = 0;
      await J.exportMP4({ plan, project: { includeAudio: true, video: { audioSource: 'mute' } }, sequence, audio: { buffer: soundtrack } });
      return { reuse, abort, failed, transparentLoads, transparentReleases, external, muteEncoded: encoded.length };
    });
    assert.deepEqual(resources.reuse.loaded, ['a', 'b']);
    assert.deepEqual(resources.reuse.released, ['a', 'b']);
    assert.deepEqual(resources.reuse.seeks, [['a', 1], ['b', 0], ['a', 0]]);
    assert.equal(resources.reuse.resolution, 123);
    assert.equal(resources.abort.name, 'AbortError');
    assert.deepEqual(resources.abort.loaded, ['a']); assert.deepEqual(resources.abort.released, ['a']);
    assert.equal(resources.abort.resolution, 123);
    assert.equal(resources.failed.message, 'decoder failure');
    assert.deepEqual(resources.failed.loaded, ['a', 'b']); assert.deepEqual(resources.failed.released, ['a']);
    assert.equal(resources.failed.resolution, 123);
    assert.equal(resources.transparentLoads, 0); assert.equal(resources.transparentReleases, 0);
    assert.ok(Math.abs(resources.external[0].sample - 0.3) < 0.002);
    assert.ok(Math.abs(resources.external.find(block => block.timestamp === 500000).sample - 0.3) < 0.002);
    assert.equal(resources.external.find(block => block.timestamp === 1100000).sample, 0);
    assert.equal(resources.muteEncoded, 0);
    console.log('PASS decoder reuse, backwards source mapping, cancellation/error cleanup and transparent PNG without decoding');
    console.log('PASS external soundtrack follows output time and mute overrides a supplied soundtrack');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
