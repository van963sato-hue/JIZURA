/* Pure MV director exchange/assembly tests: node dev/director_unit_test.js */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = { J: { LAYOUT_ORDER: [], ENTER_ORDER: [], EXIT_ORDER: [], HOLD_ORDER: [], DECOR_ORDER: [] }, Intl, console };
for (const name of ['08_planner.js', '10_audio.js', '10a_edit.js', '10c_director.js']) vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/', name), 'utf8'), context);
const J = context.J;
const clone = value => JSON.parse(JSON.stringify(value));
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, a + ' != ' + b);
const audio = { name: 'song.wav', size: 123, lastModified: 9, duration: 22.5, bpm: 123.4,
  beats: [0, 0.5, 1, 1, 22, 23, -1], energy: Float32Array.from({ length: 1125 }, (_, i) => i / 1125), energyRate: 50, buffer: { never: 'persist' } };
const draft = J.directorDraft({ audio, lyrics: '短い\nもっと長い歌詞の行\n最後', concept: '夜明けへ', identity: '参照画像の服と髪を維持', style: '水彩' });
assert.equal(draft.version, 1);
assert.equal(draft.segments.length, 3);
assert.deepEqual(clone(draft.segments.map(s => [s.id, s.start, s.end, s.generationDuration])), [['S001', 0, 10, 10], ['S002', 10, 20, 10], ['S003', 20, 22.5, 10]]);
assert.deepEqual(clone(draft.storyboard), { rows: 3, cols: 3, ratio: '16:9', secondsPerSheet: 10 });
for (const segment of draft.segments) {
  assert.equal(segment.panels.length, 9);
  near(segment.panels[0].start, segment.start); near(segment.panels[8].end, segment.end);
  segment.panels.forEach((panel, i) => { assert.equal(panel.index, i + 1); if (i) near(segment.panels[i - 1].end, panel.start); });
}
assert.equal(draft.song.energyBins.length, 23);
assert.equal(draft.song.analysis.tempo, 'estimated'); assert.equal(draft.song.analysis.vocalAlignment, false);
assert.equal(draft.song.buffer, undefined); assert.equal(draft.song.energy, undefined);
assert.deepEqual(clone(draft.song.beats), [0, 0.5, 1, 22]);
const manualGrid = J.directorDraft({ audio, lyrics: '', timing: { bpm: 120, offset: 0.4, beatOffset: 1.2 } });
assert.equal(manualGrid.song.beats[0], 1.2, 'manual beat phase uses beatOffset rather than lyric offset');
assert.equal(manualGrid.song.beats[1], 1.7); assert.equal(manualGrid.song.analysis.tempo, 'manual');
assert.equal(J.directorDraft({ audio, lyrics: '', timing: { bpm: 120, offset: 0.4 } }).song.beats[0], 0, 'missing beatOffset uses the editor default');
assert.ok(draft.lyrics.every(row => row.timing === 'estimated'));
assert.ok(draft.lyrics[1].end - draft.lyrics[1].start > draft.lyrics[0].end - draft.lyrics[0].start, 'plain lyrics use declared weighted estimates');
assert.throws(() => J.directorAssemble(draft, new Map()), /仮時刻/);
assert.equal(J.directorNormalize(null), null);
assert.equal(J.directorNormalize({}), null);
assert.throws(() => J.directorDraft({ audio: { duration: Infinity } }), /曲/);
assert.equal(J.directorDraft({ audio: { duration: 20 }, lyrics: '' }).segments.length, 2, 'exact multiple has no empty tail');
assert.equal(J.directorDraft({ audio: { duration: 0.01 }, lyrics: '' }).segments.length, 1, 'very short valid clip');
const offsetLrc = J.directorDraft({ audio, lyrics: '[offset:500]\n[00:01.00]ひとつ\n[00:08.00]ふたつ' });
assert.deepEqual(clone(offsetLrc.lyrics.map(l => [l.start, l.end, l.timing])), [[1.5, 8.5, 'lrc'], [8.5, 22.5, 'lrc']]);
const manual = J.directorDraft({ audio, lyrics: '[00:01.00]ひとつ\n[00:08.00]ふたつ', timing: { lineTimes: { 0: 2 }, lineEnds: { 0: 5, 1: 20 } } });
assert.deepEqual(clone(manual.lyrics.map(l => [l.start, l.end, l.timing])), [[2, 5, 'confirmed'], [8, 20, 'lrc']]);
assert.throws(() => J.directorDraft({ audio, lyrics: 'a\nb', timing: { lineTimes: { 0: 8, 1: 3 } } }), /開始時刻/);
assert.throws(() => J.directorDraft({ audio, lyrics: 'a\nb', timing: { lineTimes: { 0: 2, 1: 3 }, lineEnds: { 0: 4 } } }), /終了時刻/);
const anchored = J.directorDraft({ audio, lyrics: 'aa\nbbbb\ncc\ndd', timing: { lineTimes: { 1: 5, 3: 20 } } });
assert.equal(anchored.lyrics[1].start, 5); assert.equal(anchored.lyrics[3].start, 20);
assert.ok(anchored.lyrics[0].start < 5 && anchored.lyrics[2].start > 5 && anchored.lyrics[2].start < 20);

const current = clone(draft);
current.segments[0].sourceId = 'source-a';
current.segments[0].videoSource = { id: 'source-a', name: 'S001.mp4', size: 1000, lastModified: 44, duration: 10, width: 1920, height: 1080 };
current.segments[0].storyboardSource = { name: 'S001.png', size: 234, lastModified: 45, width: 1920, height: 1080 };
const original = clone(current);
const gpt = { version: 1, segments: clone(current.segments), lyrics: clone(current.lyrics) };
gpt.segments[0].summary = '夜の駅を去る';
gpt.segments[0].panels[0].scene = '<img src=x onerror=alert(1)> は無害な文字データ';
gpt.segments[0].panels[0].frameOptions = ['wide', 'wide', 'low'];
gpt.segments[0].sourceId = 'malicious-rebinding';
gpt.segments[0].videoSource = { id: 'malicious-rebinding', name: 'wrong.mp4', duration: 100 };
gpt.lyrics.forEach(row => { row.timing = 'confirmed'; });
const imported = J.directorImport('```json\n' + JSON.stringify(gpt) + '\n```', current);
assert.equal(imported.segments[0].summary, '夜の駅を去る');
assert.equal(imported.segments[0].panels[0].scene, gpt.segments[0].panels[0].scene, 'scene is plain data, not evaluated HTML');
assert.deepEqual(clone(imported.segments[0].panels[0].frameOptions), ['wide', 'low']);
assert.equal(imported.segments[0].sourceId, 'source-a');
assert.deepEqual(clone(imported.segments[0].videoSource), original.segments[0].videoSource);
assert.deepEqual(clone(imported.segments[0].storyboardSource), original.segments[0].storyboardSource);
assert.ok(imported.lyrics.every(row => row.timing === 'estimated'), 'GPT cannot self-confirm guessed singing times');
assert.deepEqual(current, original, 'imports are atomic and immutable');
const minimal = J.directorImport({ version: 1, segments: clone(current.segments) }, current);
assert.deepEqual(clone(minimal.lyrics), current.lyrics, 'omitted lyrics preserve timing');
const manualReply = { version: 1, segments: clone(manual.segments), lyrics: clone(manual.lyrics) };
manualReply.lyrics[0].end = 4;
assert.equal(J.directorImport(manualReply, manual).lyrics[0].timing, 'estimated', 'changes to confirmed times require fresh confirmation');
for (const mutate of [
  value => { value.segments.pop(); },
  value => { value.segments[0].id = 'S002'; },
  value => { value.segments[0].end = 11; },
  value => { value.segments[0].generationDuration = 90; },
  value => { value.segments[0].panels.pop(); },
  value => { value.segments[0].panels[0].end -= 0.1; },
  value => { value.segments[0].panels[0].start = -1; },
  value => { value.segments[0].panels[8].end = 9.5; },
  value => { value.lyrics[0].text = 'changed'; },
  value => { value.lyrics[0].start = -1; },
  value => { value.lyrics[0].end = value.lyrics[1].start + 1; },
  value => { value.lyrics[0].start = null; },
  value => { value.song = { ...clone(current.song), duration: 99 }; },
  value => { value.identity = 'replace reference'; },
  value => { value.storyboard = { rows: 3, cols: 3, ratio: '9:16', secondsPerSheet: 10 }; },
  value => { value.segments[0].videoPrompt = 'x'.repeat(7001); },
]) {
  const bad = clone(gpt); mutate(bad); assert.throws(() => J.directorImport(bad, current));
  assert.deepEqual(current, original, 'failed import never mutates current project');
}
const rebalance = clone(gpt);
rebalance.segments[0].panels[0].end = 0.5; rebalance.segments[0].panels[1].start = 0.5;
assert.equal(J.directorImport(rebalance, current).segments[0].panels[0].end, 0.5, 'GPT may adjust keyframe boundaries inside the fixed clip');
assert.throws(() => J.directorImport('const a = {};', current), /JSON/);
assert.throws(() => J.directorImport('null', current), /JSON/);

const ready = J.directorConfirmTimings(current);
assert.ok(ready.lyrics.every(l => l.timing === 'confirmed'));
assert.ok(current.lyrics.every(l => l.timing === 'estimated'));
assert.throws(() => J.directorAssemble(ready, new Map()), /S001/);
ready.segments.forEach((s, i) => { s.sourceId = 'source-' + i; });
const media = new Map(ready.segments.map((s, i) => [s.sourceId, { file: { name: s.id + '.mp4', size: 100 + i, lastModified: 1000 + i }, duration: 10, width: 1920, height: 1080 }]));
const assembly = J.directorAssemble(ready, media);
assert.equal(assembly.edit.sources.length, 3); assert.equal(assembly.edit.clips.length, 3);
assert.equal(J.buildVideoTimeline(assembly.edit).duration, 22.5);
assert.deepEqual(clone(assembly.edit.clips.map(c => [c.in, c.out, c.speed, c.volume])), [[0, 10, 1, 0], [0, 10, 1, 0], [0, 2.5, 1, 0]]);
assert.equal(assembly.lyrics, '短い\nもっと長い歌詞の行\n最後');
assert.equal(assembly.lyricTimes[0], ready.lyrics[0].start); assert.equal(assembly.lyricEnds[2], 22.5);
media.get('source-1').duration = 9.9;
assert.throws(() => J.directorAssemble(ready, media), /S002.*短すぎ/);
media.get('source-1').duration = 10;
ready.segments[2].sourceId = 'source-0';
assert.equal(J.directorAssemble(ready, media).edit.sources.length, 2, 'reused clip shares its source');
const tinyTail = J.directorDraft({ audio: { duration: 10.01 }, lyrics: '' });
tinyTail.segments.forEach((s, i) => { s.sourceId = 'source-' + i; });
const tinyAssembly = J.directorAssemble(tinyTail, media);
near(tinyAssembly.edit.clips[1].out, 0.01);
near(J.buildVideoTimeline(tinyAssembly.edit).duration, 10.01);
near(J.buildVideoTimeline(J.normalizeVideoEdit(clone(tinyAssembly.edit))).duration, 10.01, 'a subframe song tail survives saved-project normalization');

const pack = J.directorPromptPack(current);
assert.ok(pack.includes('1シーン＝10秒の動画1本')); assert.ok(pack.includes('文字・歌詞・字幕・番号'));
assert.ok(pack.includes('信号解析による推定')); assert.ok(pack.includes('架空IDを作らず'));
assert.ok(!pack.includes('S001.mp4')); assert.ok(!pack.includes('S001.png'));
const shot = J.directorVideoPrompt(draft.segments[2], draft);
assert.ok(shot.includes('one 10-second, 16:9')); assert.ok(shot.includes('never the entire 3×3 sheet'));
assert.ok(shot.includes('2.5s')); assert.ok(shot.length <= 7000);
const board = J.directorStoryboardPrompt(draft.segments[0], draft);
assert.ok(board.includes('3 columns × 3 rows')); assert.ok(board.includes('No lyrics')); assert.equal((board.match(/Panel \d /g) || []).length, 9);
assert.ok(J.directorNormalize(current));
const roundtrip = J.directorNormalize(JSON.parse(JSON.stringify(current)));
assert.deepEqual(clone(roundtrip.segments[0].videoSource), current.segments[0].videoSource);
// The actual FRAME catalog travels with the handoff, so GPT need not invent IDs.
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/10d_frame.js'), 'utf8'), context);
const catalog = J.directorFrameCatalog();
assert.equal(catalog.options.length, 330);
const packWithFrame = J.directorPromptPack(current);
assert.ok(packWithFrame.includes('"catalog_version":"4.0.0"'));
assert.ok(packWithFrame.includes('"id":"' + catalog.options[0].id + '"'));
const frameShot = clone(draft.segments[0]);
frameShot.panels[0].frameOptions = [catalog.options[0].id];
assert.ok(J.directorVideoPrompt(frameShot, draft).includes(catalog.options[0].prompt), 'H3 fallback uses canonical English technique wording');
console.log('PASS director: 10-second/9-panel timing, truthful estimates, LRC/manual anchors, immutable strict GPT import, review gate, exact muted assembly and metadata relink');
