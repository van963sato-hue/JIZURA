/* Pure timeline tests: node dev/edit_unit_test.js */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = { J: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/10a_edit.js'), 'utf8'), context);
const J = context.J;
const clone = value => JSON.parse(JSON.stringify(value));
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, actual + ' != ' + expected);
const source = { id: 'source-a', name: 'A.mp4', size: 900, lastModified: 123, duration: 12, width: 1920, height: 1080 };
const edit = {
  sources: [source, { ...source, id: 'source-b', name: 'B.mp4', duration: 6 }],
  clips: [
    { id: 'first', sourceId: 'source-a', in: 2, out: 10, speed: 2, volume: 0.6, fadeIn: 1, fadeOut: 0.5, flip: true },
    { id: 'second', sourceId: 'source-b', in: 1, out: 3, speed: 0.5, volume: 0.25, fadeIn: 0, fadeOut: 0, flip: false },
  ],
};
const original = clone(edit);

const legacy = J.normalizeVideoEdit(undefined, source);
assert.equal(legacy.sources.length, 1); assert.equal(legacy.clips.length, 1);
assert.equal(legacy.clips[0].in, 0); assert.equal(legacy.clips[0].out, 12);
assert.equal(legacy.clips[0].speed, 1); assert.equal(legacy.clips[0].volume, 1);
assert.equal(J.normalizeVideoEdit({}, source).clips.length, 0);
assert.equal(J.normalizeVideoEdit({ sources: [], clips: [] }, source).clips.length, 0);
assert.equal(J.normalizeVideoEdit(null, { ...source, duration: Infinity }).sources.length, 0);
const tinyTrim = J.normalizeVideoEdit({ sources: [source], clips: [{ id: 'tail', sourceId: source.id, in: 1, out: 1.01 }] });
close(tinyTrim.clips[0].out - tinyTrim.clips[0].in, 0.01);
close(J.buildVideoTimeline(J.normalizeVideoEdit(clone(tinyTrim))).duration, 0.01, 'explicit subframe trims survive a persistence roundtrip');
close(J.buildVideoTimeline(J.updateVideoClip(tinyTrim, 'tail', { volume: 0.4 })).duration, 0.01, 'changing volume does not expand a short clip');
assert.throws(() => J.splitVideoClip(tinyTrim, 'tail', 0.005), /分割位置/, 'short trims do not weaken the split minimum');

const corrupt = J.normalizeVideoEdit({
  sources: [source, { ...source, duration: 99 }, { ...source, id: 'bad', duration: NaN }, { ...source, id: 'short', duration: 0.01 }],
  clips: [
    { id: 'same', sourceId: 'source-a', in: 999, out: -3, speed: 99, volume: -5, fadeIn: Infinity, fadeOut: 4, flip: 'false' },
    { id: 'same', sourceId: 'short', in: 12, out: -2, speed: 0, volume: '0.3' },
    { id: 'orphan', sourceId: 'missing' },
    { sourceId: 'source-a', in: NaN, out: Infinity, speed: 'bad', volume: null },
  ],
});
assert.equal(corrupt.sources.length, 2, 'duplicate/invalid sources are removed');
assert.equal(corrupt.clips.length, 3, 'orphan source references are removed');
assert.equal(new Set(corrupt.clips.map(clip => clip.id)).size, 3, 'duplicate/missing clip ids repaired');
close(corrupt.clips[0].out - corrupt.clips[0].in, 0.04);
assert.equal(corrupt.clips[0].speed, 4); assert.equal(corrupt.clips[0].volume, 0);
assert.equal(corrupt.clips[0].fadeIn, 0); close(corrupt.clips[0].fadeOut, 0.005);
assert.equal(corrupt.clips[0].flip, false);
close(corrupt.clips[1].out - corrupt.clips[1].in, 0.01);
assert.equal(corrupt.clips[1].speed, 0.25); assert.equal(corrupt.clips[1].volume, 0.3);
assert.equal(corrupt.clips[2].in, 0); assert.equal(corrupt.clips[2].out, 12);
assert.equal(corrupt.clips[2].speed, 1); assert.equal(corrupt.clips[2].volume, 1);

const timeline = J.buildVideoTimeline(edit);
assert.equal(timeline.duration, 8);
assert.equal(timeline.clips[0].duration, 4); assert.equal(timeline.clips[1].start, 4);
assert.equal(timeline.clips[1].end, 8); assert.equal(timeline.clips[1].source.name, 'B.mp4');
assert.equal(J.videoClipAt(timeline, 0).id, 'first');
assert.equal(J.videoClipAt(timeline, 4 - 1e-8).id, 'first');
assert.equal(J.videoClipAt(timeline, 4).id, 'second', 'cut switches exactly at output boundary');
assert.equal(J.videoClipAt(timeline, 8), null); assert.equal(J.videoClipAt(timeline, -1), null);
assert.equal(J.videoClipAt(timeline, NaN), null); assert.equal(J.videoClipAt(timeline, null), null);
assert.equal(J.clipSourceTime(timeline.clips[0], 1), 4);
assert.equal(J.clipSourceTime(timeline.clips[1], 5), 1.5);
assert.equal(J.clipSourceTime(timeline.clips[1], -5), 1);
assert.equal(J.clipSourceTime(timeline.clips[1], 90), 3);
close(J.clipOpacity(timeline.clips[0], 0), 0);
close(J.clipOpacity(timeline.clips[0], 0.25), 0.25);
close(J.clipOpacity(timeline.clips[0], 2), 1);
close(J.clipOpacity(timeline.clips[0], 3.75), 0.5);
close(J.clipOpacity(timeline.clips[0], 4), 0);
close(J.clipOpacity(timeline.clips[1], 4), 1);

const split = J.splitVideoClip(edit, 'first', 1.5);
assert.equal(split.clips.length, 3);
assert.equal(split.clips[0].id, 'first'); assert.notEqual(split.clips[1].id, 'first');
assert.equal(split.clips[0].out, 5); assert.equal(split.clips[1].in, 5, 'split converts output time through speed');
assert.equal(split.clips[0].fadeOut, 0); assert.equal(split.clips[1].fadeIn, 0);
assert.equal(split.clips[0].fadeIn, 0.75, 'outer fade clamps to shortened duration');
assert.equal(split.clips[1].fadeOut, 0.5);
assert.equal(split.clips[1].volume, 0.6); assert.equal(split.clips[1].flip, true);
assert.equal(J.buildVideoTimeline(split).duration, 8, 'splitting preserves output duration');
const splitSecond = J.splitVideoClip(edit, 'second', 5);
assert.equal(splitSecond.clips[1].out, 1.5, 'split accounts for previous clip duration');
assert.equal(splitSecond.clips[2].in, 1.5);
for (const t of [-1, 0, 0.001, 3.999, 4, 7, NaN, null]) {
  assert.throws(() => J.splitVideoClip(edit, 'first', t), /分割位置/);
}
assert.throws(() => J.splitVideoClip(corrupt, corrupt.clips[1].id, 0.02), /分割位置/);

const changed = J.updateVideoClip(edit, 'first', { in: 3, out: 7, speed: 4, id: 'replace', sourceId: 'missing', volume: 3 });
assert.equal(changed.clips[0].id, 'first'); assert.equal(changed.clips[0].sourceId, 'source-a');
assert.equal(changed.clips[0].volume, 1); assert.equal(J.buildVideoTimeline(changed).duration, 5);
assert.equal(J.moveVideoClip(edit, 'first', 100).clips[1].id, 'first');
assert.equal(J.moveVideoClip(edit, 'second', -100).clips[0].id, 'second');
assert.equal(J.moveVideoClip(edit, 'first', NaN).clips[0].id, 'first');
const copied = J.duplicateVideoClip(edit, 'first');
assert.equal(copied.clips.length, 3); assert.equal(copied.clips[1].sourceId, 'source-a');
assert.notEqual(copied.clips[1].id, copied.clips[0].id); assert.equal(J.buildVideoTimeline(copied).duration, 12);
const removed = J.removeVideoClip(J.removeVideoClip(edit, 'first'), 'second');
assert.equal(removed.clips.length, 0); assert.equal(removed.sources.length, 2);
assert.equal(J.buildVideoTimeline(removed).duration, 0);
assert.equal(J.normalizeVideoEdit(removed, source).clips.length, 0, 'deleted last clip stays deleted');
assert.throws(() => J.updateVideoClip(edit, 'missing', {}), /選び直し/);
assert.deepEqual(edit, original, 'all edit operations are immutable');
const normalized = J.normalizeVideoEdit(edit);
normalized.sources[0].name = 'mutated'; normalized.clips[0].in = 9;
assert.deepEqual(edit, original, 'normalization does not share mutable source or clip objects');
console.log('PASS edit normalization/migration, speed-aware timeline and splits, exact cuts/fades, immutable trim/reorder/duplicate/delete');
