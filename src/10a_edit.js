/* ============================================================
   JIZURA — immutable video clip editing and timeline mapping
   Times in clips are source seconds; fades use output seconds.
   ============================================================ */
(() => {
'use strict';

const MIN_SPAN = 0.04;
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const number = (value, fallback) => {
  if (typeof value !== 'number' && typeof value !== 'string') return fallback;
  if (typeof value === 'string' && !value.trim()) return fallback;
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
};
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const identifier = value => typeof value === 'string' ? value.trim() : '';
let counter = 0;

J.newVideoId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return 'video-' + crypto.randomUUID();
  return 'video-' + Date.now().toString(36) + '-' + (++counter).toString(36) + '-' + Math.random().toString(36).slice(2, 10);
};

function uniqueId(value, used) {
  let id = identifier(value);
  if (!id || used.has(id)) do { id = J.newVideoId(); } while (used.has(id));
  used.add(id);
  return id;
}

function normalizeClip(value, source, used) {
  const clip = object(value), minSpan = Math.min(MIN_SPAN, source.duration);
  const begin = clamp(number(clip.in, 0), 0, Math.max(0, source.duration - minSpan));
  const end = clamp(number(clip.out, source.duration), begin + minSpan, source.duration);
  const speed = clamp(number(clip.speed, 1), 0.25, 4);
  const duration = (end - begin) / speed;
  return {
    id: uniqueId(clip.id, used), sourceId: source.id,
    in: begin, out: end, speed,
    volume: clamp(number(clip.volume, 1), 0, 1),
    fadeIn: clamp(number(clip.fadeIn, 0), 0, duration / 2),
    fadeOut: clamp(number(clip.fadeOut, 0), 0, duration / 2),
    flip: clip.flip === true,
  };
}

/* Only a genuinely absent edit migrates legacy metadata. An explicitly empty
   edit means the user removed the clips and must remain empty on reopening. */
J.normalizeVideoEdit = (raw, legacySource) => {
  const migrate = raw === undefined || raw === null;
  const edit = object(raw);
  const rawSources = migrate && legacySource ? [legacySource] : (Array.isArray(edit.sources) ? edit.sources : []);
  const used = new Set(), sources = [], sourceMap = new Map();
  for (const value of rawSources) {
    const source = object(value), duration = number(source.duration, 0);
    if (!(duration > 0)) continue;
    const oldId = identifier(source.id);
    // Duplicate source IDs cannot be disambiguated by existing clip refs.
    if (oldId && sourceMap.has(oldId)) continue;
    const id = uniqueId(oldId, used), file = object(source.file);
    const meta = {
      id,
      name: typeof source.name === 'string' && source.name ? source.name : (typeof file.name === 'string' && file.name ? file.name : '動画'),
      size: Math.max(0, Math.floor(number(source.size, number(file.size, 0)))),
      lastModified: Math.max(0, Math.floor(number(source.lastModified, number(file.lastModified, 0)))),
      duration,
      width: Math.max(0, Math.floor(number(source.width, 0))),
      height: Math.max(0, Math.floor(number(source.height, 0))),
    };
    sources.push(meta); sourceMap.set(id, meta);
  }
  const rawClips = migrate && sources.length ? [{ sourceId: sources[0].id }] : (Array.isArray(edit.clips) ? edit.clips : []);
  const clips = [];
  for (const value of rawClips) {
    const clip = object(value), source = sourceMap.get(identifier(clip.sourceId));
    if (!source) continue;
    clips.push(normalizeClip(clip, source, used));
  }
  return { sources, clips };
};

J.buildVideoTimeline = edit => {
  const normalized = J.normalizeVideoEdit(edit), sources = new Map(normalized.sources.map(source => [source.id, source]));
  let cursor = 0;
  const clips = normalized.clips.map(clip => {
    const duration = (clip.out - clip.in) / clip.speed;
    const entry = { ...clip, start: cursor, end: cursor + duration, duration, source: sources.get(clip.sourceId) };
    cursor = entry.end;
    return entry;
  });
  return { clips, duration: cursor };
};

/* End-exclusive intervals ensure the first frame at a cut belongs to the
   following clip. At the final endpoint there is no active frame. */
J.videoClipAt = (timeline, time) => {
  const t = number(time, NaN), clips = timeline && timeline.clips;
  if (!Number.isFinite(t) || !Array.isArray(clips) || t < 0) return null;
  let low = 0, high = clips.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1, clip = clips[middle];
    if (t < clip.start) high = middle - 1;
    else if (t >= clip.end) low = middle + 1;
    else return clip;
  }
  return null;
};

J.clipSourceTime = (entry, time) => {
  if (!entry) return 0;
  return clamp(entry.in + (number(time, entry.start) - entry.start) * entry.speed, entry.in, entry.out);
};

/* Identical envelope for image opacity and the source-audio gain. */
J.clipOpacity = (entry, time) => {
  if (!entry) return 0;
  const t = number(time, NaN);
  if (!Number.isFinite(t) || t < entry.start || t >= entry.end) return 0;
  let opacity = 1;
  if (entry.fadeIn > 0) opacity = Math.min(opacity, (t - entry.start) / entry.fadeIn);
  if (entry.fadeOut > 0) opacity = Math.min(opacity, (entry.end - t) / entry.fadeOut);
  return clamp(opacity, 0, 1);
};

function findClip(edit, id) {
  const index = edit.clips.findIndex(clip => clip.id === id);
  if (index < 0) throw new Error('編集するクリップが見つかりません。タイムラインから選び直してください。');
  return index;
}

J.updateVideoClip = (edit, id, patch) => {
  const next = J.normalizeVideoEdit(edit), index = findClip(next, id);
  // Identity and source binding are stable for a trim/settings operation.
  next.clips[index] = { ...next.clips[index], ...object(patch), id, sourceId: next.clips[index].sourceId };
  return J.normalizeVideoEdit(next);
};

J.splitVideoClip = (edit, id, timelineTime) => {
  const next = J.normalizeVideoEdit(edit), index = findClip(next, id);
  const entry = J.buildVideoTimeline(next).clips[index], time = number(timelineTime, NaN);
  const minSpan = Math.min(MIN_SPAN, entry.source.duration);
  const at = entry.in + (time - entry.start) * entry.speed;
  const tolerance = minSpan * 1e-8;
  if (!Number.isFinite(time) || !(time > entry.start && time < entry.end) ||
      at - entry.in < minSpan - tolerance || entry.out - at < minSpan - tolerance) {
    throw new Error('分割位置をクリップの内側へ動かしてください。分割後の両側に元動画の0.04秒以上が必要です。');
  }
  const splitAt = clamp(at, entry.in + minSpan, entry.out - minSpan), clip = next.clips[index];
  next.clips.splice(index, 1,
    { ...clip, out: splitAt, fadeOut: 0 },
    { ...clip, id: J.newVideoId(), in: splitAt, fadeIn: 0 });
  return J.normalizeVideoEdit(next);
};

J.moveVideoClip = (edit, id, delta) => {
  const next = J.normalizeVideoEdit(edit), index = findClip(next, id);
  const target = clamp(index + Math.trunc(number(delta, 0)), 0, next.clips.length - 1);
  const [clip] = next.clips.splice(index, 1); next.clips.splice(target, 0, clip);
  return next;
};

J.duplicateVideoClip = (edit, id) => {
  const next = J.normalizeVideoEdit(edit), index = findClip(next, id);
  next.clips.splice(index + 1, 0, { ...next.clips[index], id: J.newVideoId() });
  return J.normalizeVideoEdit(next);
};

J.removeVideoClip = (edit, id) => {
  const next = J.normalizeVideoEdit(edit), index = findClip(next, id);
  next.clips.splice(index, 1);
  // Retain source metadata so a removed clip can be added again without import.
  return next;
};
})();
