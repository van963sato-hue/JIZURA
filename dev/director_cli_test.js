/* Real CLI -> browser -> director -> MP4 integration.
 * python3 build.py && CHROMIUM_PATH=/path/to/chromium node dev/director_cli_test.js
 * Requires Playwright, Chromium, ffmpeg and ffprobe. DIRECTOR_CLI_TEST_OUT keeps
 * the 12-second song, two generated-clip fixtures and the completed output.
 * DIRECTOR_TEST_FONT optionally exercises an explicitly supplied local font.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync, execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const out = process.env.DIRECTOR_CLI_TEST_OUT ? path.resolve(process.env.DIRECTOR_CLI_TEST_OUT) : fs.mkdtempSync(path.join(os.tmpdir(), 'jizura-cli-'));
fs.mkdirSync(out, { recursive: true });
const run = (bin, args) => execFileSync(bin, args, { maxBuffer: 64 * 1024 * 1024 });
const write = (name, value) => { const target = path.join(out, name); fs.writeFileSync(target, value); return target; };
const json = (name, value) => write(name, JSON.stringify(value, null, 2));
function cli(args, success = true) {
  const result = spawnSync(process.execPath, ['tools/mv_workflow.mjs', ...args], { cwd: ROOT, env: process.env, encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (success) {
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  }
  assert.notEqual(result.status, 0, 'Invalid input must fail');
  return result;
}
function tone(pcm, start, end) {
  let crossings = 0, energy = 0;
  const first = Math.floor(start * 48000), last = Math.floor(end * 48000);
  let previous = pcm.readFloatLE(first * 4);
  for (let i = first; i < last; i++) {
    const value = pcm.readFloatLE(i * 4);
    if (value >= 0 && previous < 0) crossings++;
    energy += value * value; previous = value;
  }
  return { hz: crossings / (end - start), rms: Math.sqrt(energy / (last - first)) };
}
function pixel(video, time) {
  return Array.from(run('ffmpeg', ['-v', 'error', '-ss', String(time), '-i', video, '-frames:v', '1', '-vf', 'crop=2:2:2:2', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-']).subarray(0, 3));
}
try {
  const audio = path.join(out, 'original-330.wav');
  run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000:duration=12', '-c:a', 'pcm_s16le', audio]);
  const clips = {};
  for (let i = 0; i < 2; i++) {
    const filename = path.join(out, `S00${i + 1}.mp4`); clips['S00' + (i + 1)] = filename;
    run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${i ? 'blue' : 'red'}:s=320x180:r=10:d=10`,
      '-f', 'lavfi', '-i', `sine=frequency=${i ? 660 : 880}:sample_rate=48000:duration=10`,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', filename]);
  }
  const manifest = json('clips.json', clips), plain = write('lyrics.txt', 'First line\nSecond line');
  const provisional = path.join(out, 'provisional.json');
  const analysis = cli(['analyze', '--audio', audio, '--lyrics', plain, '--concept', 'A continuous night journey', '--out', provisional]);
  assert.equal(analysis.duration, 12); assert.equal(analysis.segments, 2); assert.equal(analysis.pendingLyrics, 2);
  const draft = JSON.parse(fs.readFileSync(provisional, 'utf8'));
  assert.equal(draft.song.name, path.basename(audio)); assert.equal(draft.song.size, fs.statSync(audio).size);
  assert.equal(draft.song.lastModified, Math.floor(fs.statSync(audio).mtimeMs), 'Original file modification time is preserved');
  assert.deepEqual(draft.storyboard, { rows: 3, cols: 3, ratio: '16:9', secondsPerSheet: 10 });
  assert.deepEqual(draft.segments.map(segment => [segment.id, segment.start, segment.end, segment.generationDuration, segment.panels.length]), [['S001', 0, 10, 10, 9], ['S002', 10, 12, 10, 9]]);
  assert.ok(fs.readFileSync(analysis.gptPack, 'utf8').includes('MiniMax'));
  const blockedOut = path.join(out, 'must-not-render.mp4');
  const rejected = cli(['render', '--project', provisional, '--audio', audio, '--clips', manifest, '--out', blockedOut], false);
  assert.match(rejected.stderr, /Provisional lyric timing/); assert.equal(fs.existsSync(blockedOut), false);
  assert.ok(JSON.parse(fs.readFileSync(provisional, 'utf8')).lyrics.every(row => row.timing === 'estimated'));
  console.log('PASS analysis preserves audio metadata and nine-panel ten-second sheets; render refuses provisional timing');

  const lrc = write('lyrics.lrc', '[00:00.00]First line\n[00:10.00]Second line');
  const timedFile = path.join(out, 'timed.json');
  const timed = cli(['analyze', '--audio', audio, '--lyrics', lrc, '--out', timedFile]);
  assert.equal(timed.pendingLyrics, 0);
  const director = JSON.parse(fs.readFileSync(timedFile, 'utf8'));
  assert.ok(director.lyrics.every(row => row.timing === 'lrc'));
  const project = json('production.jizura.json', { director, title: 'CLI integration', res: 180, fps: 10, aspect: '16:9', style: 'noir', seed: 123,
    fx: { motion: .5, glitch: 0, chroma: 0, decor: 0, density: 0, texture: 0, flash: false, onTwos: false, koma: 0, hud: 'off', bgSwitch: 0 },
    overrides: { 0: { single: true, layout: 'center', enter: 'cut', hold: 'still', exit: 'cut', decor: [], bg: 'none' }, 1: { single: true, layout: 'center', enter: 'cut', hold: 'still', exit: 'cut', decor: [], bg: 'none' } },
    video: { dim: 0, textScale: .55, x: .5, y: .5, shadow: false }, timing: { bpm: 0, offset: 0, snap: false, tail: 0, lineTimes: {}, lineScale: 1 } });
  const video = path.join(out, 'complete.mp4');
  const font = process.env.DIRECTOR_TEST_FONT ? path.resolve(process.env.DIRECTOR_TEST_FONT) : null;
  const result = cli(['render', '--project', project, '--audio', audio, '--clips', manifest, '--out', video, '--res', '180', '--fps', '10', ...(font ? ['--font', font] : [])]);
  assert.equal(result.duration, 12); assert.equal(result.segments, 2); assert.ok(result.bytes > 10000);
  const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', video]).toString());
  assert.ok(Math.abs(Number(probe.format.duration) - 12) < .1);
  assert.deepEqual(probe.streams.find(stream => stream.codec_type === 'video'), { codec_type: 'video', width: 320, height: 180 });
  assert.ok(probe.streams.some(stream => stream.codec_type === 'audio'));
  const red = pixel(video, .5), blue = pixel(video, 10.5);
  assert.ok(red[0] > 180 && red[1] < 65 && red[2] < 65, 'First segment is red: ' + red);
  assert.ok(blue[2] > 180 && blue[0] < 65 && blue[1] < 65, 'Second segment is blue: ' + blue);
  const pcm = run('ffmpeg', ['-v', 'error', '-i', video, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-']);
  for (const [start, end] of [[.5, 1.5], [10.4, 11.4]]) {
    const sample = tone(pcm, start, end);
    assert.ok(sample.rms > .05 && Math.abs(sample.hz - 330) < 5, 'Export must use original song, not generated clip audio: ' + JSON.stringify(sample));
  }
  const saved = JSON.parse(fs.readFileSync(result.project, 'utf8'));
  if (font) {
    assert.equal(result.font.source.name, path.basename(font));
    assert.equal(result.font.source.size, fs.statSync(font).size);
    assert.ok(['display', 'serif', 'body', 'mono'].every(role => saved.fonts[role] === result.font.key));
    const choice = saved.userFonts.find(value => value.key === result.font.key);
    assert.equal(choice.family, result.font.family);
    assert.equal(choice.source.name, path.basename(font));
    assert.deepEqual(Object.keys(choice).sort(), ['family', 'key', 'label', 'source', 'weight'], 'Only font metadata is persisted');
  }
  assert.equal(saved.video.audioSource, 'audio'); assert.equal(saved.includeAudio, true);
  assert.deepEqual(saved.edit.clips.map(clip => [clip.in, clip.out, clip.speed, clip.volume]), [[0, 10, 1, 0], [0, 2, 1, 0]]);
  assert.ok(saved.director.lyrics.every(row => row.timing === 'lrc'));
  console.log('PASS CLI renders ordered clips, exact 12-second tail, original music and editable project sidecar');
  console.log('Artifacts: ' + out);
} finally {
  if (!process.env.DIRECTOR_CLI_TEST_OUT) fs.rmSync(out, { recursive: true, force: true });
}
