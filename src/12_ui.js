/* ============================================================
   JIZURA — editor UI
   ============================================================ */
(() => {
'use strict';
if (!document.getElementById('app')) return;          // engine-only pages (tests)
const $ = id => document.getElementById(id);
const LS_KEY = 'jizura.project.v1';
const HUD_CHARS = '0123456789:./-_()【】・No.LYRICRECUNTITLEDXYlinebpminterlude—─／ ';
const ICON = {
  dice: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="2" width="12" height="12" rx="2"/><circle cx="5.5" cy="5.5" r="1" fill="currentColor"/><circle cx="10.5" cy="10.5" r="1" fill="currentColor"/><circle cx="10.5" cy="5.5" r="1" fill="currentColor"/><circle cx="5.5" cy="10.5" r="1" fill="currentColor"/></svg>',
  lock: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5 7V5a3 3 0 0 1 6 0v2"/></svg>',
};

const S = { project: null, plan: null, audio: null, audioLoading: null, video: null, videoLoading: null, videoSeeking: false, seekId: 0, renderer: new J.Renderer(), playing: false, t: 0, t0: 0, loop: true, need: true, exporting: null, tap: null, slow: false, lineEls: [], curLine: -2 };
Object.assign(S, { media: new Map(), editTimeline: { clips: [], duration: 0 }, activeClip: null, selectedClip: null, editPast: [], editFuture: [], sequenceAudio: null });
Object.assign(S, { images: new Map(), imageLoading: null });
Object.assign(S, { directorAssemblyBackup: null });
const hasVideoEdit = () => !!(S.project && S.project.edit && S.project.edit.clips.length);
const endEpsilon = () => Math.min(1e-6, S.plan.duration / 1000);

/* WebAudio player (works inside sandboxed pages where blob media may be blocked) */
const AP = {
  ctx: null, src: null, startAt: 0,
  play(buffer, offset) {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.stop();
    const s = this.ctx.createBufferSource(); s.buffer = buffer; s.connect(this.ctx.destination);
    if (offset >= buffer.duration) return;
    const off = Math.max(0, offset);
    s.start(0, off); this.src = s; this.startAt = this.ctx.currentTime - off;
  },
  stop() { if (this.src) { try { this.src.stop(); } catch (e) {} try { this.src.disconnect(); } catch (e) {} this.src = null; } },
  time() { return this.ctx ? this.ctx.currentTime - this.startAt : 0; },
};

/* ---------------- project persistence ---------------- */
function mergeProject(p) {
  const d = J.defaultProject();
  const o = Object.assign(d, p || {});
  o.fx = Object.assign(J.defaultProject().fx, (p && p.fx) || {});
  o.timing = Object.assign(J.defaultProject().timing, (p && p.timing) || {});
  o.timing.lineTimes = o.timing.lineTimes || {};
  o.timing.lineEnds = o.timing.lineEnds || {};
  o.video = J.videoSettings(p && p.video);
  if (p && p.video && p.video.source && typeof p.video.source.name === 'string') o.video.source = p.video.source;
  o.edit = J.normalizeVideoEdit(p && p.edit, o.video.source);
  o.images = J.normalizeImageOverlays(p && p.images);
  o.director = J.directorNormalize(p && p.director);
  const en = J.defaultProject().enabled;
  for (const g of Object.keys(en)) en[g] = Object.assign(en[g], ((p && p.enabled) || {})[g] || {});
  o.enabled = en;
  o.overrides = (p && p.overrides) || {};
  o.colors = Object.assign({ enabled: false }, (p && p.colors) || {});
  o.fonts = (p && p.fonts) || {};
  o.userFonts = (p && p.userFonts) || [];
  for (const uf of o.userFonts) if (!J.FONTS[uf.key]) J.addUserFont(uf.key, uf.label, uf.family, uf.weight || 400);
  return o;
}
function setBadges(d) {
  return (d && d.extra ? '<span class="set-badge ex" title="最初の公開版のあとに追加">追加</span>' : '') + (d && d.wa ? '<span class="set-badge" title="和風の演出">和</span>' : '');
}
function loadLocal() { try { const s = localStorage.getItem(LS_KEY); if (s) return mergeProject(JSON.parse(s)); } catch (e) {} return mergeProject(null); }
let saveTimer = 0;
function autosave() { clearTimeout(saveTimer); saveTimer = setTimeout(flushSave, 700); }
function flushSave() { clearTimeout(saveTimer); try { localStorage.setItem(LS_KEY, JSON.stringify(S.project)); } catch (e) {} }
window.addEventListener('pagehide', () => { if (S.project) flushSave(); });

/* ---------------- planning ---------------- */
function audioLike() {
  const T = S.project.timing;
  const source = selectedAudio();
  if (source || hasVideoEdit()) {
    const a = Object.assign({}, source || {});
    if (hasVideoEdit()) a.duration = S.editTimeline.duration;
    if (T.bpm > 0) a.beats = J.beatGrid(T.bpm, T.beatOffset || 0, a.duration);
    return a;
  }
  if (T.bpm > 0) return { beats: J.beatGrid(T.bpm, T.beatOffset || 0, 600) };
  return null;
}
/* 自動判定のとき、判定結果を言語欄の横に出す */
function langNote() {
  const el = $('langNote'); if (!el) return;
  el.textContent = (S.project.lang || 'auto') === 'auto' ? '→ ' + J.LANG_LABEL[J.resolveLang(S.project)] : '';
  if (langNote.last !== undefined && langNote.last !== J.lang) { try { renderFontRoles(); } catch (e) {} }   // font menus show the language's faces
  langNote.last = J.lang;
}
function replan() {
  S.editTimeline = J.buildVideoTimeline(S.project.edit);
  S.sequenceAudio = null;
  let planningProject = S.project;
  if (hasVideoEdit() || S.project.images.layers.length) {
    // Full-frame transitions replace entrance/exit animations at planning time.
    // Disable them before planning for layered composition, preserving the
    // choices saved for a lyric-only project.
    planningProject = Object.assign({}, S.project, {
      enabled: Object.assign({}, S.project.enabled, { trans: Object.fromEntries(J.order('trans').map(k => [k, false])) }),
      overrides: Object.fromEntries(Object.entries(S.project.overrides).map(([k, v]) => [k, Object.assign({}, v, { trans: null })])),
    });
  }
  S.plan = J.plan(planningProject, audioLike());
  if (hasVideoEdit()) {
    S.plan.duration = S.editTimeline.duration;
    S.plan.cuts = S.plan.cuts.filter(c => c.line >= 0 && c.layout !== 'interlude' && c.start < S.plan.duration);
    S.plan.cuts.forEach((c, i) => { c.index = i; });
  } else if (S.project.images.layers.length) {
    const baseDuration = S.plan.lines.length || S.audio ? S.plan.duration : 0;
    S.plan.duration = S.project.images.layers.reduce((duration, layer) => Math.max(duration, layer.end), baseDuration);
  }
  langNote();
  if (S.t > S.plan.duration) S.t = 0;
  renderLines(); sizeViewport(); drawTimeline(); updateTimeUI();
  S.need = true; autosave(); ensureFonts(); drawSwatch(); showNow();
  syncVideoUI();
  renderVideoEditor();
  if (J.imageUI) J.imageUI.render();
  if (J.directorUI) J.directorUI.render();
  clearTimeout(warmTimer); warmTimer = setTimeout(warm, 450);
}
/* pre-decompose glyphs used by piece animations while the editor is idle, so playback does not hitch */
let warmTimer = 0, warmJob = 0;
function warm() {
  const job = ++warmJob;
  const cuts = S.plan.cuts.filter(c => c.enter === 'assemble' || ['explode', 'fall', 'drift'].includes(c.exit));
  const src = $('view');
  const cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height;
  const ctx = cv.getContext('2d');
  let i = 0;
  const idle = window.requestIdleCallback ? (f) => window.requestIdleCallback(f, { timeout: 400 }) : (f) => setTimeout(() => f(null), 40);
  const step = (deadline) => {
    if (job !== warmJob || S.exporting) return;
    do {
      const c = cuts[i++]; if (!c) break;
      const ts = [];
      if (c.enter === 'assemble') ts.push(c.start + Math.min(c.inDur * 0.3, c.dur * 0.2));
      if (c.outDur > 0) ts.push(c.end - c.outDur * 0.5);
      for (const t of ts) { try { S.renderer.frame(ctx, S.plan, t, { scale: cv.width / S.plan.W, fast: true, noHud: true, noGhost: true }); } catch (e) {} }
    } while (i < cuts.length && deadline && deadline.timeRemaining() > 10);
    if (i < cuts.length) idle(step);
  };
  idle(step);
}
let replanTimer = 0;
const replanSoon = (ms = 220) => { clearTimeout(replanTimer); replanTimer = setTimeout(replan, ms); };
let fontKey = '';
let thumbFonts = null;
async function ensureFonts() {
  const txt = S.project.lyrics + (S.project.title || '') + (S.project.artist || '') + HUD_CHARS;
  const keys = J.fontsOfPlan(S.plan);                       // only the faces this plan draws with
  const key = txt + '|' + keys.join(',') + '|' + Object.keys(J.FONTS).length;
  if (key === fontKey) return;
  fontKey = key;
  showMsg('フォントを読み込み中…');
  try { await J.ensureFonts(txt, keys); } catch (e) {}
  showMsg(null); S.need = true; drawStyleGrid(); loadThumbFonts();
}
// style thumbnails need two glyphs of every style's display face — fetched only once the style grid is actually shown
function loadThumbFonts() {
  if (thumbFonts || !$('styleGrid').offsetParent) return;
  thumbFonts = J.ensureFonts('字面', [...new Set(J.STYLE_ORDER.map(k => J.STYLES[k].fonts.display[0]))]).then(() => drawStyleGrid()).catch(() => {});
}
function showMsg(m) { const el = $('viewMsg'); if (!m) { el.hidden = true; return; } el.textContent = m; el.hidden = false; }

/* ---------------- viewport & drawing ---------------- */
function sizeViewport() {
  const vp = $('viewport'), c = $('view');
  const ar = S.plan.W / S.plan.H;
  let cssW = vp.clientWidth || 800, cssH = cssW / ar;
  const maxH = Math.max(220, window.innerHeight * 0.68);
  if (cssH > maxH) { cssH = maxH; cssW = cssH * ar; }
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pw = Math.round(Math.min(S.plan.W, cssW * dpr)), ph = Math.round(pw / ar);
  if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
  c.style.width = cssW + 'px'; c.style.height = cssH + 'px';
  S.need = true;
}
function draw() {
  const c = $('view'), ctx = c.getContext('2d');
  const t0 = performance.now();
  const clip = J.videoClipAt(S.editTimeline, S.t);
  const media = S.video || (hasVideoEdit() ? { element: { readyState: 0 }, width: 0, height: 0 } : null);
  const overlays = { data: S.project.images, media: S.images };
  J.drawComposite(S.renderer, ctx, S.plan, S.t, { scale: c.width / S.plan.W, fast: S.playing && S.slow, video: media, settings: S.project.video, clip, overlays });
  const dt = performance.now() - t0;
  S.slow = S.playing ? (dt > 30 ? true : dt < 14 ? false : S.slow) : false;
  updateTimeUI(); drawTimeline(); updateCutInfo();
  updateClipPlayhead();
}
function tick(now) {
  requestAnimationFrame(tick);
  if (S.exporting) return;
  if (S.playing && !S.videoSeeking) {
    // rAF timestamps can precede the moment play()/seek() stamped t0 → clamp so t never goes negative
    let t = Math.max(0, S.video && S.activeClip ? S.activeClip.start + (S.video.element.currentTime - S.activeClip.in) / S.activeClip.speed : S.audio ? AP.time() : (now - S.t0) / 1000);
    if (S.video && S.activeClip) {
      S.video.element.volume = S.activeClip.volume * J.clipOpacity(S.activeClip, t);
      if ((t >= S.activeClip.end - endEpsilon() || S.video.element.ended) && S.activeClip.end < S.plan.duration - endEpsilon()) {
        seek(S.activeClip.end); return;
      }
    }
    if (S.video && S.project.video.audioSource === 'audio' && S.audio && !S.video.element.seeking && !S.video.element.paused && S.video.element.readyState >= 3 && t < S.audio.duration) {
      if (!AP.src || Math.abs(AP.time() - t) > 0.18) AP.play(S.audio.buffer, t);
    }
    if (t >= S.plan.duration - endEpsilon()) {
      if (S.loop && !S.tap) { seek(0); t = 0; }
      else { pause(); t = S.plan.duration - endEpsilon(); if (S.tap) stopTap(); }
    }
    S.t = t; S.need = true;
  }
  if (S.need) { S.need = false; draw(); }
}
function updateTimeUI() {
  $('timeNow').textContent = J.fmtTime(S.t);
  $('timeDur').textContent = J.fmtTime(S.plan.duration);
  if (!S.scrubbing) $('scrub').value = String(Math.round(S.t / Math.max(0.001, S.plan.duration) * 10000));
}
function play() {
  if (S.exporting || S.videoLoading || S.audioLoading) return;
  if (J.directorUI) J.directorUI.stopPreview();
  if (hasVideoEdit() && missingVideoSources().length) { toast('未読み込みの動画があります。元ファイルを追加してから再生してください。'); return; }
  if (hasVideoEdit()) {
    const clip = J.videoClipAt(S.editTimeline, S.t);
    if (!S.video || !S.activeClip || !clip || clip.id !== S.activeClip.id || S.t >= S.plan.duration - endEpsilon()) {
      S.playing = true; seek(S.t >= S.plan.duration - endEpsilon() ? 0 : S.t); return;
    }
    const video = S.video;
    video.element.muted = S.project.video.audioSource !== 'video';
    video.element.playbackRate = clip.speed;
    video.element.preservesPitch = false;
    video.element.volume = clip.volume * J.clipOpacity(clip, S.t);
    if (!S.videoSeeking) video.element.play().catch(error => {
      if (S.video !== video || !S.playing || error.name === 'AbortError') return;
      pause(); toast('動画を再生できませんでした。再生ボタンをもう一度押してください。');
    });
  } else if (S.audio) AP.play(S.audio.buffer, S.t);
  else S.t0 = performance.now() - S.t * 1000;
  S.playing = true; $('btnPlay').textContent = '❚❚'; $('btnPlay').setAttribute('aria-label', '一時停止');
}
function pause() {
  if (J.directorUI) J.directorUI.stopPreview();
  S.playing = false; AP.stop();
  if (S.video) S.video.element.pause();
  $('btnPlay').textContent = '▶'; $('btnPlay').setAttribute('aria-label', '再生'); S.need = true;
}
function seek(t) {
  if (S.exporting) return;
  S.t = J.clamp(t, 0, Math.max(0, S.plan.duration - endEpsilon()));
  if (hasVideoEdit()) {
    AP.stop();
    if (S.video) S.video.element.pause();
    const clip = J.videoClipAt(S.editTimeline, S.t);
    const video = clip && S.media.get(clip.sourceId);
    const seekId = ++S.seekId;
    S.activeClip = clip; S.video = video || null;
    if (!video) { S.videoSeeking = false; pause(); S.need = true; return; }
    S.videoSeeking = true;
    video.element.pause();
    video.element.playbackRate = clip.speed; video.element.preservesPitch = false;
    J.seekVideo(video.element, J.clipSourceTime(clip, S.t)).then(() => {
      if (video !== S.video || seekId !== S.seekId) return;
      S.videoSeeking = false; S.need = true;
      if (S.playing) play();
    }).catch(error => {
      if (video !== S.video || seekId !== S.seekId) return;
      S.videoSeeking = false;
      if (error.name !== 'AbortError') { pause(); toast(error.message); }
    });
  } else if (S.audio) { if (S.playing) AP.play(S.audio.buffer, S.t); }
  else S.t0 = performance.now() - S.t * 1000;
  S.need = true;
}

/* ---------------- timeline ---------------- */
const layoutHue = k => (J.LAYOUT_ORDER.indexOf(k) * 37 + 30) % 360;
function drawTimeline() {
  const c = $('timeline'), dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(10, Math.round(c.clientWidth * dpr)), h = Math.max(10, Math.round(c.clientHeight * dpr));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const x = c.getContext('2d'), D = Math.max(0.001, S.plan.duration), X = t => t / D * w;
  x.fillStyle = '#131316'; x.fillRect(0, 0, w, h);
  const timelineAudio = selectedAudio();
  if (timelineAudio && timelineAudio.peaks) {
    const pk = timelineAudio.peaks, n = pk.length, sd = timelineAudio.duration;
    x.fillStyle = '#2b2b33';
    for (let i = 0; i < w; i += 2) { const t = i / w * D; if (t > sd) break; const v = pk[Math.min(n - 1, Math.floor(t / sd * n))]; const hh = v * h * 0.8; x.fillRect(i, h * 0.6 - hh / 2, 1.5, hh); }
  }
  const beats = S.plan.beats || [];
  x.fillStyle = '#3a3a44';
  for (const b of beats) { if (b > D) break; x.fillRect(Math.round(X(b)), h - 6 * dpr, 1, 6 * dpr); }
  const top = h * 0.3, bot = h - 8 * dpr;
  for (const cut of S.plan.cuts) {
    const x0 = X(cut.start), x1 = X(cut.end);
    const hue = layoutHue(cut.layout);
    x.fillStyle = `hsla(${hue},70%,58%,0.28)`; x.fillRect(x0, top, Math.max(1, x1 - x0 - 1), bot - top);
    x.fillStyle = `hsla(${hue},80%,62%,0.95)`; x.fillRect(x0, top, Math.max(1, 2 * dpr), bot - top);
    if (x1 - x0 > 34 * dpr) {
      x.fillStyle = 'rgba(236,231,225,0.85)'; x.font = `${10 * dpr}px ${getComputedStyle(document.body).getPropertyValue('--mono') || 'monospace'}`;
      x.save(); x.beginPath(); x.rect(x0, top, x1 - x0 - 3, bot - top); x.clip();
      x.fillText((J.LAYOUTS[cut.layout] || {}).name || cut.layout, x0 + 5 * dpr, top + 13 * dpr); x.restore();
    }
  }
  x.font = `${10 * dpr}px monospace`;
  for (const ln of S.plan.lines) {
    const lx = X(ln.start);
    x.fillStyle = '#5d5a63'; x.fillRect(lx, 0, 1, top);
    x.fillStyle = '#8e8a94'; x.fillText(String(ln.index + 1).padStart(2, '0'), lx + 3 * dpr, 12 * dpr);
  }
  const px = X(S.t);
  x.fillStyle = '#f5a50c'; x.fillRect(Math.round(px) - dpr, 0, 2 * dpr, h);
}
function timelineSeek(ev) {
  const r = $('timeline').getBoundingClientRect();
  seek((ev.clientX - r.left) / r.width * S.plan.duration);
}

/* ---------------- cut info ---------------- */
let lastCutIdx = -2;
function updateCutInfo() {
  const cut = J.cutAt(S.plan, S.t);
  const idx = cut ? cut.index : -1;
  const li = cut ? cut.line : -1;
  if (li !== S.curLine) { S.lineEls.forEach((el, i) => el.classList.toggle('cur', i === li)); S.curLine = li; }
  if (idx === lastCutIdx) return;
  lastCutIdx = idx;
  const el = $('cutInfo');
  if (!cut) { el.innerHTML = '<span class="hint">この位置にカットはありません</span>'; return; }
  const chip = (cls, k, v) => `<span class="chip ${cls}"><b>${k}</b>${v}</span>`;
  const n = (tbl, k) => (tbl[k] ? tbl[k].name : k);
  el.innerHTML = [
    `<span class="chip mono">#${String(cut.index + 1).padStart(2, '0')}</span>`,
    chip('l', 'レイアウト', n(J.LAYOUTS, cut.layout)), chip('e', '登場', n(J.ENTER, cut.enter)), chip('h', '保持', n(J.HOLD, cut.hold)), chip('x', '退場', n(J.EXIT, cut.exit)),
    cut.decor && cut.decor.length ? chip('', '装飾', cut.decor.map(d => n(J.DECOR, d.id)).join('・')) : '',
    cut.treat && cut.treat !== 'none' ? chip('t', '加工', n(J.TREAT, cut.treat)) : '',
    cut.bg && cut.bg !== 'none' ? chip('b', '背景', n(J.BG, cut.bg)) : '',
    cut.cam && cut.cam !== 'push' ? chip('c', 'カメラ', n(J.CAMERA, cut.cam)) : '',
    cut.trans ? chip('c', 'つなぎ', n(J.TRANS, cut.trans)) : '',
  ].join('');
}

/* ---------------- line list ---------------- */
function renderLines() {
  const ol = $('lineList'); ol.innerHTML = ''; S.lineEls = []; S.curLine = -2;
  const ov = S.project.overrides;
  const layoutOpts = '<option value="">自動</option>' + J.LAYOUT_ORDER.map(k => `<option value="${k}">${J.LAYOUTS[k].name}</option>`).join('');
  S.plan.lines.forEach((ln, i) => {
    const o = ov[i] || {};
    const li = document.createElement('li'); li.className = 'ln';
    const manual = S.project.timing.lineTimes && S.project.timing.lineTimes[i] != null;
    li.innerHTML = `<span class="no">${String(i + 1).padStart(2, '0')}</span>
      <input class="time mono" type="number" step="0.01" min="0" value="${ln.start.toFixed(2)}" title="開始（秒）${manual ? '・手動' : '・自動'}" aria-label="${i + 1}行目の開始秒" style="${manual ? 'border-color:var(--cyan)' : ''}">
      <span class="txt" title="${escapeHtml(ln.text)}">${escapeHtml(ln.text)}</span>
      <div class="line-end-row"><label>終了 <input class="end-time mono" type="number" step="0.01" min="${(ln.start + 0.05).toFixed(2)}" value="${ln.end.toFixed(2)}" aria-label="${i + 1}行目の終了秒"></label><button class="ghost mark-start" title="今の再生位置を開始にする">開始を現在位置へ</button><button class="ghost reset-end" title="終了を自動に戻す">自動</button></div>
      <div class="meta"><span class="cuts"></span>
      <span class="tools">
        <select aria-label="レイアウト指定">${layoutOpts}</select>
        <button class="icon ghost dice" title="この行を再抽選">${ICON.dice}</button>
        <button class="icon ghost lock" title="この行の構成をロック" aria-pressed="${o.lock ? 'true' : 'false'}">${ICON.lock}</button>
      </span></div>`;
    li.querySelector('select').value = o.layout || '';
    li.querySelector('.time').addEventListener('change', e => {
      const v = parseFloat(e.target.value);
      if (!S.project.timing.lineTimes) S.project.timing.lineTimes = {};
      if (isFinite(v)) S.project.timing.lineTimes[i] = Math.max(0, v); else delete S.project.timing.lineTimes[i];
      replan();
    });
    li.querySelector('.end-time').addEventListener('change', e => {
      if (!S.project.timing.lineEnds) S.project.timing.lineEnds = {};
      const v = parseFloat(e.target.value);
      if (Number.isFinite(v)) S.project.timing.lineEnds[i] = Math.max(ln.start + 0.05, v);
      else delete S.project.timing.lineEnds[i];
      replan();
    });
    li.querySelector('.mark-start').addEventListener('click', () => {
      S.project.timing.lineTimes[i] = +S.t.toFixed(3); replan();
    });
    li.querySelector('.reset-end').addEventListener('click', () => {
      delete S.project.timing.lineEnds[i]; replan();
    });
    li.querySelector('.txt').addEventListener('click', () => seek(ln.start + 0.001));
    li.querySelector('select').addEventListener('change', e => { setOv(i, { layout: e.target.value || undefined }); replan(); });
    li.querySelector('.dice').addEventListener('click', () => { const cur = ov[i] || {}; setOv(i, { seed: (cur.seed | 0) + 1, lock: false }); replan(); seek(ln.start + 0.001); });
    li.querySelector('.lock').addEventListener('click', () => {
      const cur = ov[i] || {};
      if (cur.lock) setOv(i, { lock: false, lockedSeed: undefined });
      else setOv(i, { lock: true, lockedSeed: ln.seed });
      replan();
    });
    const cutsEl = li.querySelector('.cuts');
    S.plan.cuts.filter(c => c.line === i && J.LAYOUTS[c.layout] && !J.LAYOUTS[c.layout].special).forEach(c => {
      const sp = document.createElement('span'); sp.textContent = J.LAYOUTS[c.layout].name; sp.title = `${c.text}｜${J.ENTER[c.enter].name} → ${J.EXIT[c.exit].name}`;
      sp.style.borderColor = `hsla(${layoutHue(c.layout)},70%,58%,0.7)`;
      sp.addEventListener('click', () => seek(c.start + Math.min(c.dur * 0.5, c.inDur + 0.05)));
      cutsEl.appendChild(sp);
    });
    ol.appendChild(li); S.lineEls.push(li);
  });
  $('linesInfo').textContent = `${S.plan.lines.length}行 / ${S.plan.cuts.length}カット`;
}
function setOv(i, patch) {
  const cur = Object.assign({}, S.project.overrides[i] || {}, patch);
  for (const k of Object.keys(cur)) if (cur[k] === undefined || cur[k] === false || cur[k] === '') delete cur[k];
  if (Object.keys(cur).length) S.project.overrides[i] = cur; else delete S.project.overrides[i];
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* ---------------- style tab ---------------- */
function drawStyleGrid() {
  const g = $('styleGrid');
  if (!g.children.length) {
    J.STYLE_ORDER.forEach(k => {
      const b = document.createElement('button'); b.className = 'stile'; b.dataset.k = k;
      b.title = J.STYLES[k].desc;
      b.innerHTML = `<canvas width="192" height="108"></canvas><span>${J.STYLES[k].name}</span><span class="badges">${setBadges(J.STYLES[k])}</span>`;
      b.addEventListener('click', () => { remember(); S.project.style = k; S.project.colors.enabled = false; syncUI(); replan(); commit(); });
      g.appendChild(b);
    });
  }
  [...g.children].forEach(b => {
    const k = b.dataset.k, st = J.STYLES[k], sc = st.schemes[0], cv = b.querySelector('canvas'), x = cv.getContext('2d');
    b.setAttribute('aria-pressed', S.project.style === k ? 'true' : 'false');
    const off = !J.randomOk(S.project, 'style', k);
    b.classList.toggle('set-off', off);
    b.title = st.desc + (off ? (st.extra && S.project.extra !== true ? '（追加分がオフのため、おまかせでは選ばれません）' : '（和風の演出がオフのため、おまかせでは選ばれません）') : '');
    x.fillStyle = sc.bg; x.fillRect(0, 0, 192, 108);
    st.schemes.slice(1, 4).forEach((s2, i) => { x.fillStyle = s2.bg; x.fillRect(192 - 14 * (i + 1), 0, 14, 10); });
    const f = st.fonts.display[0];
    x.font = J.fontCSS(f, 46); x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = sc.ghostB; x.fillText('字面', 96 - 3, 54 - 1);
    x.fillStyle = sc.ghostA; x.fillText('字面', 96 + 3, 54 + 2);
    x.fillStyle = sc.fg; x.fillText('字面', 96, 54);
    x.fillStyle = sc.accent; x.fillRect(12, 90, 30, 4);
    x.font = J.fontCSS('mono', 9); x.textAlign = 'left'; x.fillStyle = sc.sub; x.fillText(k.toUpperCase(), 48, 93);
  });
}
function fontSelectOptions(sel) {
  return '<option value="">スタイルの既定</option>' + Object.entries(J.FONTS).map(([k, f]) => {
    const g = J.faceOf ? J.faceOf(k) : f, alt = g.label && g.label !== f.label ? ' → ' + g.label : '';   // the face actually used for the lyric language
    return `<option value="${k}" ${sel === k ? 'selected' : ''}>${escapeHtml(f.label + alt)}</option>`;
  }).join('');
}
function renderFontRoles() {
  const box = $('fontRoles'); box.innerHTML = '';
  [['display', '見出し'], ['serif', '明朝枠'], ['body', '小さな文字']].forEach(([role, label]) => {
    const row = document.createElement('div'); row.className = 'font-row';
    row.innerHTML = `<span class="muted">${label}</span><select aria-label="${label}のフォント">${fontSelectOptions(S.project.fonts[role])}</select>`;
    row.querySelector('select').addEventListener('change', e => { if (e.target.value) S.project.fonts[role] = e.target.value; else delete S.project.fonts[role]; fontKey = ''; replan(); });
    box.appendChild(row);
  });
}
const BASE_KEYS = [['bg', '背景'], ['fg', '文字'], ['sub', '補助']];
const ACCENT_KEYS = [['accent', 'アクセント'], ['ghostA', 'ズレ色A'], ['ghostB', 'ズレ色B']];
function renderColors() {
  const st = J.STYLES[S.project.style] || J.STYLES.noir, sc = st.schemes[0];
  const c = S.project.colors;
  $('colorOn').checked = !!c.enabled;
  $('accentOn').checked = !!c.accentOn;
  const fill = (rowId, keys, flag) => {
    const row = $(rowId); row.innerHTML = '';
    keys.forEach(([k, label]) => {
      const l = document.createElement('label');
      const v = (c[flag] && c[k]) || c[k] || sc[k];
      l.innerHTML = `${label}<input type="color" value="${toColorInput(v)}">`;
      l.querySelector('input').addEventListener('input', e => {
        c[k] = e.target.value.toUpperCase();
        if (!c[flag]) { c[flag] = true; $(flag === 'enabled' ? 'colorOn' : 'accentOn').checked = true; }
        replanSoon(60); drawSwatch();
      });
      row.appendChild(l);
    });
  };
  fill('colorRow', BASE_KEYS, 'enabled');
  fill('colorRowAccent', ACCENT_KEYS, 'accentOn');
  drawSwatch();
}
const toColorInput = v => { const h = String(v || '#000000'); return /^#[0-9a-f]{6}$/i.test(h) ? h.toLowerCase() : J.toHex(...J.hex(h)).toLowerCase(); };
function swatchHTML(cols) { return cols.map(c => `<i style="background:${c}" title="${c}"></i>`).join(''); }
function drawSwatch() {
  const sc = S.plan ? S.plan.style.schemes[0] : null; if (!sc) return;
  $('paletteSwatch').innerHTML = swatchHTML([sc.accent, sc.ghostA, sc.ghostB]);
}
function randomPalette() {
  remember();
  const c = S.project.colors;
  const sc0 = J.STYLES[S.project.style].schemes[0];
  const bg = c.enabled && c.bg ? c.bg : sc0.bg;
  let p, guard = 0;
  do { p = J.randomPalette(bg); } while (guard++ < 6 && p.ghostA === c.ghostA && p.ghostB === c.ghostB);
  Object.assign(c, { accent: p.accent, ghostA: p.ghostA, ghostB: p.ghostB, accentOn: true });
  renderColors(); replan(); commit();
  toast('配色：アクセント・ズレ色A/Bを変更', [p.accent, p.ghostA, p.ghostB]);
}

/* ---------------- history of looks (◀ ▶) ---------------- */
// only the "look" is tracked — lyrics, timing and output settings are never rolled back
const HKEYS = ['style', 'mood', 'seed', 'fx', 'enabled', 'fonts', 'colors', 'overrides'];
const H = { list: [], i: -1 };
const lookSnap = () => JSON.stringify(Object.fromEntries(HKEYS.map(k => [k, S.project[k] ?? null])));
function remember() {            // call before changing the look: makes sure the current look is on the stack
  const s = lookSnap();
  if (H.i >= 0 && H.list[H.i] === s) return;
  H.list = H.list.slice(0, H.i + 1); H.list.push(s); H.i = H.list.length - 1;
}
function commit() {              // call after changing the look
  const s = lookSnap();
  if (H.list[H.i] !== s) { H.list = H.list.slice(0, H.i + 1); H.list.push(s); H.i = H.list.length - 1; }
  if (H.list.length > 80) { H.list.splice(0, H.list.length - 80); H.i = H.list.length - 1; }
  updateHist();
}
function histGo(d) {
  if (S.exporting) return;
  remember();                    // hand edits made since the last step become a stop of their own
  const j = H.i + d; if (j < 0 || j >= H.list.length) return;
  H.i = j;
  Object.assign(S.project, JSON.parse(H.list[j]));
  fontKey = ''; syncUI(); replan(); updateHist();
  toast(`${j + 1} / ${H.list.length} 案目`);
  restartPreview();
}
function updateHist() {
  const canB = H.i > 0, canF = H.i < H.list.length - 1;
  ['btnPrev', 'btnPrev2'].forEach(id => { $(id).disabled = !canB; });
  ['btnNext', 'btnNext2'].forEach(id => { $(id).disabled = !canF; });
  $('histPos').textContent = H.list.length > 1 ? `${H.i + 1} / ${H.list.length}` : '';
}

/* ---------------- おまかせ ---------------- */
function restartPreview() { seek(0); if (!S.playing && S.mode === 'easy') play(); }
function omakase() {
  if (S.exporting || S.tap) return;
  remember();
  const r = J.omakase(S.project);
  Object.assign(S.project, r);
  fontKey = ''; syncUI(); replan(); commit();
  toast(`おまかせ：${J.STYLES[r.style].name} × ${J.MOODS[r.mood].name}`, r.colors.accentOn ? [r.colors.accent, r.colors.ghostA, r.colors.ghostB] : null);
  restartPreview();
}
// change just one aspect of the current look
function rerollPart(part) {
  if (S.exporting || S.tap) return;
  remember();
  const P = S.project;
  let msg = '';
  if (part === 'style') {
    let pool = J.STYLE_ORDER.filter(k => k !== P.style && J.randomOk(P, 'style', k));
    if (!pool.length) pool = J.STYLE_ORDER.filter(k => k !== P.style);
    P.style = pool[Math.floor(Math.random() * pool.length)];
    P.colors.enabled = false;
    msg = `スタイル：${J.STYLES[P.style].name}`;
  } else if (part === 'mood') {
    const r = J.omakase(P);
    Object.assign(P, { mood: r.mood, fx: r.fx, enabled: r.enabled });
    msg = `雰囲気：${J.MOODS[r.mood].name}`;
  } else if (part === 'cut') {
    P.seed = (Math.random() * 1e9) | 0;
    msg = '構成：レイアウトと動きを再抽選';
  }
  fontKey = ''; syncUI(); replan(); commit();
  toast(msg);
  restartPreview();
}
function showNow() {
  const el = $('easyNow'); if (!el || !S.plan || el.closest('[hidden]')) return;
  const P = S.project, sc = S.plan.style.schemes[0];
  const moodName = P.mood && J.MOODS[P.mood] ? J.MOODS[P.mood].name : 'カスタム';
  const fk = S.plan.style.fonts.display[0];
  const fontName = J.FONTS[fk] ? J.FONTS[fk].label : fk;
  const cuts = S.plan.cuts.filter(c => c.line >= 0 && c.layout !== 'interlude');
  const kinds = new Set(cuts.map(c => c.layout)).size;
  const row = (k, v) => `<div class="now-row"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  el.innerHTML = row('スタイル', `<b>${escapeHtml(J.STYLES[P.style].name)}</b>`)
    + row('雰囲気', escapeHtml(moodName))
    + row('配色', `<span class="swatches">${swatchHTML([sc.bg, sc.fg, sc.accent, sc.ghostA, sc.ghostB])}</span>${P.colors.accentOn ? '<span class="tagl">ランダム</span>' : ''}`)
    + row('見出し書体', escapeHtml(fontName))
    + row('構成', `${cuts.length} カット・レイアウト ${kinds} 種`)
    + row('演出', `加工 ${cuts.filter(c => c.treat && c.treat !== 'none').length}・背景 ${new Set(cuts.map(c => c.bg).filter(b => b && b !== 'none')).size}種・カメラ ${cuts.filter(c => c.cam && c.cam !== 'push').length}`);
}
let toastTimer = 0;
function toast(m, cols) {
  const el = $('toast'); if (!el) return;
  el.innerHTML = escapeHtml(m) + (cols ? `<span class="swatches">${swatchHTML(cols)}</span>` : '');
  el.hidden = false; el.classList.remove('out'); void el.offsetWidth; el.classList.add('in');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove('in'); el.classList.add('out'); toastTimer = setTimeout(() => { el.hidden = true; }, 260); }, 1700);
}

/* ---------------- かんたん / 詳細 ---------------- */
function setMode(m) {
  S.mode = m === 'easy' ? 'easy' : 'pro';
  const easy = S.mode === 'easy';
  $('app').classList.toggle('is-easy', easy);
  $('easyPanel').hidden = !easy;
  $('modeEasy').setAttribute('aria-pressed', String(easy));
  $('modePro').setAttribute('aria-pressed', String(!easy));
  try { localStorage.setItem('jizura.mode', S.mode); } catch (e) {}
  if (easy) { showNow(); syncOut(); codecNote(); }
  sizeViewport(); drawTimeline(); loadThumbFonts();
}

/* ---------------- fx tab ---------------- */
const FX = [['motion', '動きの強さ'], ['glitch', 'グリッチ'], ['chroma', '色ズレ'], ['decor', '装飾の量'], ['density', 'カットの細かさ'], ['texture', '質感'], ['bgSwitch', '背景の切替']];
function renderFx() {
  const box = $('fxSliders'); box.innerHTML = '';
  FX.forEach(([k, label]) => {
    const row = document.createElement('div'); row.className = 'slider';
    const v = S.project.fx[k] ?? 0.5;
    row.innerHTML = `<label for="fx_${k}">${label}</label><input id="fx_${k}" type="range" min="0" max="1" step="0.01" value="${v}"><output>${Math.round(v * 100)}</output>`;
    const inp = row.querySelector('input'), out = row.querySelector('output');
    inp.addEventListener('input', () => { S.project.fx[k] = +inp.value; S.project.mood = null; out.textContent = Math.round(inp.value * 100); replanSoon(120); });
    box.appendChild(row);
  });
  $('fxFlash').checked = !!S.project.fx.flash;
  $('fxKoma').value = String(J.komaOf(S.project.fx));
  $('fxHud').value = S.project.fx.hud || 'auto';
  $('seed').value = S.project.seed;
}

/* ---------------- technique tab ---------------- */
const GROUPS = [['layout', 'レイアウト'], ['enter', '登場'], ['hold', '保持'], ['exit', '退場'], ['decor', '装飾'], ['treat', '文字の加工'], ['bg', '背景'], ['cam', 'カメラ'], ['fx', '画面効果'], ['trans', 'カット間のつなぎ']];
const openGroups = new Set();
function techItems(g) { return J.order(g).filter(k => J.registry(g)[k] && !J.registry(g)[k].special); }
function renderTech() {
  const box = $('techLists'); box.innerHTML = '';
  const q = ($('techFilter').value || '').trim().toLowerCase();
  let total = 0, onAll = 0;
  GROUPS.forEach(([g, label]) => {
    const tbl = J.registry(g), items = techItems(g), en = S.project.enabled[g] || (S.project.enabled[g] = {});
    const shown = q ? items.filter(k => (tbl[k].name + ' ' + k).toLowerCase().includes(q)) : items;
    const onN = items.filter(k => en[k] !== false).length;
    total += items.length; onAll += onN;
    if (q && !shown.length) return;
    const d = document.createElement('details'); d.className = 'tgroup';
    d.open = !!q || openGroups.has(g);
    d.addEventListener('toggle', () => { if (d.open) openGroups.add(g); else openGroups.delete(g); });
    d.innerHTML = `<summary><span class="tg-name">${label}</span><span class="tg-cnt mono">${onN}/${items.length}</span></summary><div class="tg-tools"><button class="ghost small" data-a="on">すべてON</button><button class="ghost small" data-a="off">すべてOFF</button><button class="ghost small" data-a="flip">反転</button></div>`;
    const list = document.createElement('div'); list.className = 'checks';
    shown.forEach(k => {
      const l = document.createElement('label');
      l.title = k + (tbl[k].tags && tbl[k].tags.length ? '（' + tbl[k].tags.map(t => (J.MOODS[t] ? J.MOODS[t].name : t)).join('・') + '）' : '');
      if (!J.randomOk(S.project, g, k)) { l.classList.add('set-off'); l.title += tbl[k].extra && S.project.extra !== true ? '（追加分がオフのため、自動では選ばれません）' : '（和風の演出がオフのため、自動では選ばれません）'; }
      l.innerHTML = `<input type="checkbox" ${en[k] !== false ? 'checked' : ''}> ${escapeHtml(tbl[k].name)}${setBadges(tbl[k])}`;
      l.querySelector('input').addEventListener('change', e => { en[k] = e.target.checked; S.project.mood = null; d.querySelector('.tg-cnt').textContent = `${items.filter(x => en[x] !== false).length}/${items.length}`; replanSoon(60); });
      list.appendChild(l);
    });
    d.querySelectorAll('.tg-tools button').forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.a;
      shown.forEach(k => { en[k] = a === 'on' ? true : a === 'off' ? false : en[k] === false; });
      // keep a fallback so the planner always has something to use
      if (g === 'layout' && !items.some(k => en[k] !== false)) en.center = true;
      if (g === 'enter') en.cut = true; if (g === 'exit') en.cut = true; if (g === 'hold') en.still = true;
      if (g === 'treat') en.none = true; if (g === 'bg') en.none = true; if (g === 'cam') en.push = true;
      S.project.mood = null; openGroups.add(g); renderTech(); replan();
    }));
    d.appendChild(list);
    box.appendChild(d);
  });
  $('techTotal').textContent = `${onAll}/${total}`;
}

/* ---------------- output tab ---------------- */
function syncOut() {
  ['outAspect', 'eAspect'].forEach(id => {
    const select = $(id);
    if (![...select.options].some(o => o.value === S.project.aspect)) {
      const option = document.createElement('option'); option.value = S.project.aspect;
      option.textContent = S.project.aspect + '（元動画）'; select.appendChild(option);
    }
  });
  $('outAspect').value = S.project.aspect; $('outRes').value = String(S.project.res); $('outFps').value = String(S.project.fps);
  $('eAspect').value = S.project.aspect; $('eRes').value = String(S.project.res); $('eFps').value = String(S.project.fps);
  $('outQuality').value = S.project.quality || 'high'; $('outAudio').checked = S.project.includeAudio !== false;
  const k = J.keyMode(S.project) || 'off';
  $('outKey').value = k; $('eKey').value = k;
  const kb = $('keyBadge');
  kb.hidden = k === 'off';
  if (k !== 'off') kb.innerHTML = `<i style="background:${J.KEY_BG[k]}"></i>${k === 'green' ? 'グリーンバック' : 'ブラックバック'}`;
  if (hasVideoEdit()) { kb.hidden = true; }
  ['outKey', 'eKey'].forEach(id => { $(id).disabled = hasVideoEdit(); });
}
async function codecNote() {
  const [w, h] = J.outputSize(S.project);
  const vc = await J.pickVideoCodec(w, h, S.project.fps, 12e6);
  $('codecNote').textContent = vc ? `このブラウザでは ${vc.label} で書き出します（${w}×${h} / ${S.project.fps}fps）。書き出し中はタブを開いたままにしてください。` : 'このブラウザは動画エンコード（WebCodecs）に対応していません。Chrome / Edge の最新版で開くか、連番PNGを使ってください。';
  $('btnMP4').disabled = !vc || !!S.exporting; $('eMP4').disabled = !vc || !!S.exporting;
  if (!vc) $('eMP4').title = 'このブラウザは MP4 書き出しに対応していません（Chrome / Edge 推奨）';
}
const EXP_BTNS = ['btnMP4', 'btnPNG', 'btnPNGA', 'eMP4'];
function baseName() {
  const k = hasVideoEdit() ? null : J.keyMode(S.project);
  return ((S.project.title || 'jizura').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60) || 'jizura') + (k ? (k === 'green' ? '_greenback' : '_blackback') : '');
}
async function runExport(kind) {
  if (S.exporting) return;
  if (J.directorUI && J.directorUI.loading && J.directorUI.loading()) { toast('MV素材の読み込みが終わってから書き出してください。'); return; }
  if (S.imageLoading) { toast('画像の読み込みが終わってから書き出してください。'); return; }
  if (J.imageUI && J.imageUI.missingSources().length) { toast('未読み込みの画像があります。元ファイルを追加してから書き出してください。'); return; }
  if (S.videoLoading || S.audioLoading) { toast('動画・音声の読み込みが終わってから書き出してください。'); return; }
  if (missingVideoSources().length) { toast('未読み込みの動画があります。元ファイルを追加してから書き出してください。'); return; }
  if (kind === 'mp4' && hasVideoEdit() && S.project.includeAudio !== false && S.project.video.audioSource === 'audio' && !S.audio) {
    toast('使用する曲を読み込んでください。');
    return;
  }
  clearTimeout(replanTimer); replan();
  pause();
  const project = JSON.parse(JSON.stringify(S.project)), plan = S.plan, video = S.video, audio = selectedAudio();
  const sequence = hasVideoEdit() ? { timeline: J.buildVideoTimeline(project.edit), media: new Map(S.media) } : null;
  const overlays = { data: project.images, media: new Map(S.images) };
  const locked = [...document.querySelectorAll('button,input,select,textarea')].filter(el => !el.classList.contains('exp-cancel')).map(el => [el, el.disabled]);
  locked.forEach(([el]) => { el.disabled = true; });
  const ac = new AbortController(); S.exporting = ac;
  const boxes = [...document.querySelectorAll('.exp-box')];
  const setText = m => boxes.forEach(b => { b.querySelector('.exp-text').textContent = m; });
  const txt = { set textContent(m) { setText(m); }, get textContent() { return boxes[0].querySelector('.exp-text').textContent; } };
  boxes.forEach(b => { b.hidden = false; b.querySelector('.exp-bar').style.width = '0%'; });
  setText('準備中…');
  EXP_BTNS.forEach(id => { $(id).disabled = true; });
  const onProgress = (p, m) => { boxes.forEach(b => { b.querySelector('.exp-bar').style.width = (p * 100).toFixed(1) + '%'; }); setText(m); };
  const t0 = performance.now();
  try {
    await J.ensureFonts(project.lyrics + (project.title || '') + (project.artist || '') + HUD_CHARS, J.fontsOfPlan(plan));
    if (kind === 'mp4') {
      const r = await J.exportMP4({ plan, project, video, sequence, overlays, audio: project.includeAudio !== false ? audio : null, quality: project.quality || 'high', onProgress, signal: ac.signal });
      txt.textContent = `完成 ${(r.blob.size / 1048576).toFixed(1)}MB・${r.codec}${r.audio ? ' + ' + r.audio.toUpperCase() : ''}・${((performance.now() - t0) / 1000).toFixed(0)}秒`;
      const res = await J.saveFile(baseName() + '.mp4', r.blob);
      if (res === 'declined') txt.textContent += '（保存はキャンセルされました）';
    } else {
      const blob = await J.exportPNGZip({ plan, project, video, sequence, overlays, transparent: kind === 'pnga', onProgress, signal: ac.signal });
      txt.textContent = `完成 ${(blob.size / 1048576).toFixed(1)}MB`;
      await J.saveFile(baseName() + (kind === 'pnga' ? '_alpha' : '') + '_png.zip', blob);
    }
  } catch (e) {
    txt.textContent = 'エラー: ' + (e && e.message ? e.message : e);
    console.error(e);
  } finally {
    S.exporting = null; S.need = true;
    locked.forEach(([el, disabled]) => { el.disabled = disabled; });
    codecNote();
  }
}

/* ---------------- tap sync ---------------- */
function startTap() {
  if (!S.plan.lines.length) return;
  S.tap = { i: 0 };
  if (!S.project.timing.lineTimes) S.project.timing.lineTimes = {};
  $('tapPanel').hidden = false; $('btnTap').setAttribute('aria-pressed', 'true');
  seek(0); play(); updateTap();
  $('tapBtn').focus();
}
function tapNow() {
  if (!S.tap) return;
  S.project.timing.lineTimes[S.tap.i] = +S.t.toFixed(3);
  S.tap.i++;
  replan();
  if (S.tap.i >= S.plan.lines.length) stopTap(); else updateTap();
}
function stopTap() { S.tap = null; $('tapPanel').hidden = true; $('btnTap').setAttribute('aria-pressed', 'false'); replan(); }
function updateTap() { const ln = S.plan.lines[S.tap.i]; $('tapLine').textContent = ln ? `${S.tap.i + 1}. ${ln.text}` : '—'; }

/* ---------------- sync all inputs from project ---------------- */
function syncUI() {
  $('songTitle').value = S.project.title || ''; $('songArtist').value = S.project.artist || '';
  $('lyrics').value = S.project.lyrics;
  $('bpm').value = S.project.timing.bpm > 0 ? S.project.timing.bpm : '';
  $('bpm').placeholder = S.audio ? `自動 ${S.audio.bpm}` : 'なし';
  $('offset').value = S.project.timing.offset ?? 0.4;
  $('lineScale').value = S.project.timing.lineScale ?? 1;
  $('snap').checked = !!S.project.timing.snap;
  document.querySelectorAll('.wa-toggle').forEach(el => { el.checked = S.project.wa !== false; });
  document.querySelectorAll('.extra-toggle').forEach(el => { el.checked = S.project.extra === true; });
  $('lyricLang').value = J.LANG_LABEL[S.project.lang] ? S.project.lang : 'auto'; langNote();
  renderFontRoles(); renderColors(); renderFx(); renderTech(); syncOut(); drawStyleGrid();
  syncVideoUI();
}

/* ---------------- wiring ---------------- */
function bind() {
  bindVideoEditor();
  $('lyrics').addEventListener('input', e => { S.project.lyrics = e.target.value; replanSoon(260); });
  $('lyricLang').addEventListener('change', e => {
    remember();
    S.project.lang = e.target.value; replan(); renderFontRoles(); commit(); flushSave();
    const l = J.resolveLang(S.project);
    toast((S.project.lang === 'auto' ? '歌詞の言語：自動判定 → ' : '歌詞の言語：') + J.LANG_LABEL[l]);
  });
  $('songTitle').addEventListener('input', e => { S.project.title = e.target.value; replanSoon(300); });
  $('songArtist').addEventListener('input', e => { S.project.artist = e.target.value; replanSoon(300); });
  $('btnSyntax').addEventListener('click', e => { const s = $('syntax'); s.hidden = !s.hidden; e.target.setAttribute('aria-expanded', String(!s.hidden)); });
  $('bpm').addEventListener('change', e => { S.project.timing.bpm = Math.max(0, parseFloat(e.target.value) || 0); replan(); });
  $('offset').addEventListener('change', e => { S.project.timing.offset = Math.max(0, parseFloat(e.target.value) || 0); replan(); });
  $('lineScale').addEventListener('change', e => { S.project.timing.lineScale = J.clamp(parseFloat(e.target.value) || 1, 0.3, 4); replan(); });
  $('snap').addEventListener('change', e => { S.project.timing.snap = e.target.checked; replan(); });
  $('btnResetTimes').addEventListener('click', () => { S.project.timing.lineTimes = {}; S.project.timing.lineEnds = {}; replan(); });
  $('videoFile').addEventListener('change', e => { const files = [...(e.target.files || [])]; e.target.value = ''; if (files.length) loadVideoFiles(files).catch(error => toast(error.message)); });
  $('btnRemoveVideo').addEventListener('click', removeVideo);
  $('videoFit').addEventListener('change', e => { S.project.video.fit = e.target.value; S.need = true; autosave(); });
  $('videoAudioSource').addEventListener('change', e => { pause(); S.project.video.audioSource = e.target.value; syncUI(); replan(); });
  [['videoTextScale', 'textScale'], ['videoX', 'x'], ['videoY', 'y'], ['videoDim', 'dim']].forEach(([id, key]) => {
    $(id).addEventListener('input', e => { S.project.video[key] = +e.target.value / 100; syncVideoUI(); S.need = true; autosave(); });
  });
  $('videoShadow').addEventListener('change', e => { S.project.video.shadow = e.target.checked; S.need = true; autosave(); });
  document.querySelectorAll('[data-mv-preset]').forEach(el => el.addEventListener('click', () => {
    const presets = { center: { textScale: 0.72, x: 0.5, y: 0.5 }, lower: { textScale: 0.42, x: 0.5, y: 0.76 }, upper: { textScale: 0.42, x: 0.5, y: 0.24 } };
    Object.assign(S.project.video, presets[el.dataset.mvPreset]); syncVideoUI(); S.need = true; autosave();
  }));
  $('audioFile').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) loadAudioFile(f); });
  $('btnTap').addEventListener('click', () => (S.tap ? stopTap() : startTap()));
  $('tapBtn').addEventListener('click', tapNow);
  $('tapStop').addEventListener('click', () => { pause(); stopTap(); });
  $('btnPlay').addEventListener('click', () => (S.playing ? pause() : play()));
  $('btnLoop').addEventListener('click', e => { S.loop = !S.loop; e.target.setAttribute('aria-pressed', String(S.loop)); });
  $('btnShuffle').addEventListener('click', () => { remember(); S.project.seed = (Math.random() * 1e9) | 0; $('seed').value = S.project.seed; replan(); commit(); });
  const sc = $('scrub');
  sc.addEventListener('input', () => { S.scrubbing = true; seek(sc.value / 10000 * S.plan.duration); });
  sc.addEventListener('change', () => { S.scrubbing = false; });
  const tl = $('timeline');
  let drag = false;
  tl.addEventListener('pointerdown', e => { drag = true; tl.setPointerCapture(e.pointerId); timelineSeek(e); });
  tl.addEventListener('pointermove', e => { if (drag) timelineSeek(e); });
  tl.addEventListener('pointerup', () => { drag = false; });
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach(x => x.setAttribute('aria-selected', String(x === b)));
    document.querySelectorAll('.tabpane').forEach(p => { p.hidden = p.dataset.pane !== b.dataset.tab; });
    if (b.dataset.tab === 'out') codecNote();
    loadThumbFonts();
  }));
  $('fxFlash').addEventListener('change', e => { S.project.fx.flash = e.target.checked; replan(); });
  $('techFilter').addEventListener('input', () => renderTech());
  const setSwitch = (cls, key, on, msgOn, msgOff) => document.querySelectorAll('.' + cls).forEach(el => el.addEventListener('change', e => {
    remember();
    S.project[key] = e.target.checked;
    document.querySelectorAll('.' + cls).forEach(x => { x.checked = e.target.checked; });
    renderTech(); drawStyleGrid(); replan(); commit(); flushSave();
    toast(e.target.checked ? msgOn : msgOff);
  }));
  setSwitch('extra-toggle', 'extra', true, '追加分の演出：使う', '追加分の演出：使わない（最初の公開版の演出だけ）');
  setSwitch('wa-toggle', 'wa', true, '和風の演出：使う', '和風の演出：使わない（おまかせ・シャッフルで選ばれません）');
  $('fxKoma').addEventListener('change', e => { const k = +e.target.value; S.project.fx.koma = k; S.project.fx.onTwos = k > 0; S.project.mood = null; replan(); });
  $('fxHud').addEventListener('change', e => { S.project.fx.hud = e.target.value; replan(); });
  $('seed').addEventListener('change', e => { S.project.seed = parseInt(e.target.value, 10) || 0; replan(); });
  $('btnSeed').addEventListener('click', () => { S.project.seed = (Math.random() * 1e9) | 0; $('seed').value = S.project.seed; replan(); });
  const colorToggle = (flag, keys) => e => {
    remember();
    const c = S.project.colors; c[flag] = e.target.checked;
    if (c[flag]) { const sc0 = J.STYLES[S.project.style].schemes[0]; keys.forEach(([k]) => { if (!c[k]) c[k] = sc0[k]; }); }
    renderColors(); replan(); commit();
  };
  $('colorOn').addEventListener('change', colorToggle('enabled', BASE_KEYS));
  $('accentOn').addEventListener('change', colorToggle('accentOn', ACCENT_KEYS));
  $('btnRandPalette').addEventListener('click', randomPalette);
  $('btnAddFont').addEventListener('click', () => {
    const name = $('localFont').value.trim(); if (!name) return;
    const key = 'local_' + name.replace(/\s+/g, '_');
    const weight = /bold|太|black|heavy|w[6-9]|[6-9]00/i.test(name) ? 700 : 400;
    J.addUserFont(key, name + '（PC）', name, weight);
    S.project.userFonts = (S.project.userFonts || []).filter(u => u.key !== key).concat([{ key, label: name + '（PC）', family: name, weight }]);
    S.project.fonts.display = key; $('localFont').value = '';
    fontKey = ''; renderFontRoles(); replan();
  });
  $('fontFile').addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    try { const key = await J.loadFontFile(f); S.project.fonts.display = key; fontKey = ''; renderFontRoles(); replan(); }
    catch (err) { showMsg('フォントを読み込めませんでした'); setTimeout(() => showMsg(null), 2500); }
  });
  ['outAspect', 'eAspect'].forEach(id => $(id).addEventListener('change', e => { S.project.aspect = e.target.value; syncOut(); replan(); codecNote(); }));
  ['outRes', 'eRes'].forEach(id => $(id).addEventListener('change', e => { S.project.res = +e.target.value; syncOut(); autosave(); codecNote(); }));
  ['outFps', 'eFps'].forEach(id => $(id).addEventListener('change', e => { S.project.fps = +e.target.value; syncOut(); replan(); codecNote(); }));
  $('outQuality').addEventListener('change', e => { S.project.quality = e.target.value; autosave(); });
  ['outKey', 'eKey'].forEach(id => $(id).addEventListener('change', e => {
    S.project.keyBg = e.target.value; syncOut(); replan(); flushSave();
    const k = J.keyMode(S.project);
    toast(k ? `背景：${k === 'green' ? 'グリーンバック' : 'ブラックバック'}（白い文字と演出だけ）` : '背景：通常（スタイルの配色）');
  }));
  $('outAudio').addEventListener('change', e => { S.project.includeAudio = e.target.checked; autosave(); });
  $('btnMP4').addEventListener('click', () => runExport('mp4'));
  $('btnPNG').addEventListener('click', () => runExport('png'));
  $('btnPNGA').addEventListener('click', () => runExport('pnga'));
  document.querySelectorAll('.exp-cancel').forEach(b => b.addEventListener('click', () => { if (S.exporting) S.exporting.abort(); }));
  $('eMP4').addEventListener('click', () => runExport('mp4'));
  // かんたんモード
  $('modeEasy').addEventListener('click', () => setMode('easy'));
  $('modePro').addEventListener('click', () => setMode('pro'));
  $('btnOmakase').addEventListener('click', omakase);
  $('btnOmakaseBig').addEventListener('click', omakase);
  ['btnPrev', 'btnPrev2'].forEach(id => $(id).addEventListener('click', () => histGo(-1)));
  ['btnNext', 'btnNext2'].forEach(id => $(id).addEventListener('click', () => histGo(1)));
  $('eStyle').addEventListener('click', () => rerollPart('style'));
  $('eMood').addEventListener('click', () => rerollPart('mood'));
  $('eCut').addEventListener('click', () => rerollPart('cut'));
  $('ePalette').addEventListener('click', () => { randomPalette(); restartPreview(); });
  // 利用について（出力物の権利・ライセンス）
  const dlg = $('termsDlg');
  const openTerms = () => { if (dlg.showModal) { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute('open', ''); };
  document.querySelectorAll('.terms-open').forEach(b => b.addEventListener('click', openTerms));
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close ? dlg.close() : dlg.removeAttribute('open'); });   // click on the backdrop
  $('btnSave').addEventListener('click', () => J.saveFile(baseName() + '.jizura.json', JSON.stringify(S.project, null, 1)));
  $('btnAE').addEventListener('click', () => J.saveFile(baseName() + '_ae.json', JSON.stringify(J.planForAE(S.plan, S.project), null, 1)));
  $('fileProject').addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    try {
      const project = mergeProject(JSON.parse(await f.text()));
      pause(); if (S.videoLoading) S.videoLoading.abort(); S.videoLoading = null;
      if (S.audioLoading) S.audioLoading.abort(); S.audioLoading = null;
      releaseAllMedia(); S.audio = null; S.editPast = []; S.editFuture = []; S.selectedClip = null;
      if (J.imageUI) J.imageUI.reset();
      if (J.directorUI) J.directorUI.reset();
      S.directorAssemblyBackup = null;
      $('audioName').textContent = '曲を使う場合は、曲も読み込み直してください。';
      S.project = project; S.t = 0; replan(); syncUI();
    }
    catch (err) { showMsg('プロジェクトを読み込めませんでした'); setTimeout(() => showMsg(null), 2500); }
    e.target.value = '';
  });
  document.addEventListener('keydown', e => {
    if (S.exporting) return;
    const tag = (e.target && e.target.tagName) || '';
    const typing = /INPUT|TEXTAREA|SELECT/.test(tag) && e.target.type !== 'range' && e.target.type !== 'checkbox';
    if (S.tap && (e.code === 'Space' || e.code === 'Enter') && !typing) { e.preventDefault(); tapNow(); return; }
    if (S.tap && e.code === 'Escape') { pause(); stopTap(); return; }
    if (typing || $('termsDlg').open) return;
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? editRedo() : editUndo(); return; }
    if (e.code === 'Space') { e.preventDefault(); S.playing ? pause() : play(); }
    else if (e.code === 'ArrowRight') seek(S.t + (e.shiftKey ? 1 : 1 / S.plan.fps));
    else if (e.code === 'ArrowLeft') seek(S.t - (e.shiftKey ? 1 : 1 / S.plan.fps));
    else if (e.code === 'KeyR' && !e.metaKey && !e.ctrlKey && !e.altKey && !S.exporting) { e.preventDefault(); omakase(); }
  });
  window.addEventListener('resize', () => { sizeViewport(); drawTimeline(); });
  if (window.ResizeObserver) new ResizeObserver(() => { sizeViewport(); drawTimeline(); }).observe($('viewport'));
}

/* ---------------- local MV and clip editing ---------------- */
function selectedAudio() {
  if (!hasVideoEdit()) return S.audio;
  if (S.project.video.audioSource === 'audio') return S.audio;
  if (S.project.video.audioSource === 'mute') return null;
  if (S.sequenceAudio) return S.sequenceAudio;
  const timeline = S.editTimeline, duration = timeline.duration;
  const peaks = new Float32Array(1600), beats = [];
  const energyRate = Math.min(50, 180000 / Math.max(1, duration));
  const energy = new Float32Array(Math.max(1, Math.ceil(duration * energyRate)));
  for (const clip of timeline.clips) {
    const a = S.media.get(clip.sourceId)?.audio;
    if (!a || !clip.volume) continue;
    for (const b of a.beats || []) if (b >= clip.in && b < clip.out) beats.push(clip.start + (b - clip.in) / clip.speed);
  }
  for (let i = 0; i < peaks.length; i++) {
    const t = duration * i / peaks.length, clip = J.videoClipAt(timeline, t);
    const a = clip && S.media.get(clip.sourceId)?.audio;
    if (!a?.peaks) continue;
    const index = Math.min(a.peaks.length - 1, Math.floor(J.clipSourceTime(clip, t) / a.duration * a.peaks.length));
    peaks[i] = a.peaks[index] * clip.volume * J.clipOpacity(clip, t);
  }
  for (let i = 0; i < energy.length; i++) {
    const t = i / energyRate, clip = J.videoClipAt(timeline, t);
    const a = clip && S.media.get(clip.sourceId)?.audio;
    if (!a?.energy || !a.energyRate) continue;
    const index = Math.min(a.energy.length - 1, Math.floor(J.clipSourceTime(clip, t) * a.energyRate));
    energy[i] = a.energy[index] * clip.volume * J.clipOpacity(clip, t);
  }
  return S.sequenceAudio = { duration, peaks, beats, energy, energyRate };
}
function missingVideoSources() {
  const ids = new Set(S.project.edit.clips.map(c => c.sourceId));
  return S.project.edit.sources.filter(source => ids.has(source.id) && !S.media.has(source.id));
}
function syncVideoUI() {
  const settings = S.project.video, active = hasVideoEdit();
  $('videoControls').hidden = !active;
  $('btnRemoveVideo').hidden = !active && !S.videoLoading;
  const missing = missingVideoSources();
  if (!S.videoLoading) $('videoName').textContent = active
    ? `${S.editTimeline.clips.length}クリップ · ${J.fmtTime(S.editTimeline.duration)}${missing.length ? ` · 未読み込み ${missing.length}本` : ''}`
    : '動画なし · 複数の動画を追加できます';
  $('videoFit').value = settings.fit;
  $('videoAudioSource').value = settings.audioSource;
  [['videoTextScale', 'textScale'], ['videoX', 'x'], ['videoY', 'y'], ['videoDim', 'dim']].forEach(([id, key]) => {
    $(id).value = String(Math.round(settings[key] * 100));
    $(id + 'Value').textContent = Math.round(settings[key] * 100) + '%';
  });
  $('videoShadow').checked = settings.shadow;
  const warnings = [];
  if (missing.length) warnings.push('元ファイルを追加して再接続してください: ' + missing.map(s => s.name).join(' / '));
  if (active && settings.audioSource === 'video' && S.editTimeline.clips.some(c => c.volume > 0 && S.media.has(c.sourceId) && !S.media.get(c.sourceId).audio)) warnings.push('音声を読み取れない動画があります。そのクリップの音量を0%にするか、別の曲を選んでください。');
  if (active && settings.audioSource === 'audio' && !S.audio) warnings.push('「曲を読み込む」で使用する音声を選んでください。');
  if (active && S.plan && S.plan.lines.some(l => l.start >= S.editTimeline.duration)) warnings.push('動画の終了より後に始まる歌詞があります。開始時刻を調整してください。');
  $('videoWarning').hidden = !warnings.length;
  $('videoWarning').textContent = warnings.join(' ');
}
function updateClipPlayhead() {
  const current = J.videoClipAt(S.editTimeline, S.t);
  for (const button of $('clipTimeline').querySelectorAll('button')) button.classList.toggle('playing', !!current && button.dataset.clipId === current.id);
}
function renderVideoEditor() {
  const clips = S.editTimeline.clips;
  $('videoEditor').hidden = !clips.length && !S.editPast.length && !S.editFuture.length;
  if (!clips.some(c => c.id === S.selectedClip)) S.selectedClip = clips[0]?.id || null;
  const selected = clips.find(c => c.id === S.selectedClip);
  const strip = $('clipTimeline'); strip.replaceChildren();
  clips.forEach((clip, i) => {
    const button = document.createElement('button'); button.type = 'button';
    button.dataset.clipId = clip.id; button.setAttribute('aria-pressed', String(clip.id === S.selectedClip));
    button.classList.toggle('missing', !S.media.has(clip.sourceId));
    button.style.flexGrow = String(Math.max(0.1, clip.duration));
    button.title = `${clip.source.name} · ${J.fmtTime(clip.start)}–${J.fmtTime(clip.end)}`;
    const index = document.createElement('span'); index.className = 'clip-index'; index.textContent = String(i + 1).padStart(2, '0');
    const name = document.createElement('span'); name.className = 'clip-name'; name.textContent = clip.source.name;
    const time = document.createElement('span'); time.className = 'clip-time'; time.textContent = `${clip.duration.toFixed(2)}s · ${clip.speed}×`;
    button.append(index, name, time); button.addEventListener('click', () => selectClip(clip.id)); strip.appendChild(button);
  });
  $('clipSummary').textContent = `${clips.length}クリップ · ${J.fmtTime(S.editTimeline.duration)}`;
  $('clipSelection').textContent = selected ? `${selected.source.name} · ${J.fmtTime(selected.start)} → ${J.fmtTime(selected.end)}` : '動画を追加して編集を始めてください';
  const missing = missingVideoSources();
  $('clipMissing').hidden = !missing.length;
  $('clipMissing').textContent = missing.length ? '未読み込み: ' + missing.map(s => s.name).join(' / ') : '';
  for (const id of ['clipSplit', 'clipDuplicate', 'clipDelete', 'clipApply', 'clipSetIn', 'clipSetOut', 'clipIn', 'clipOut', 'clipSpeed', 'clipVolume', 'clipFadeIn', 'clipFadeOut', 'clipFlip']) $(id).disabled = !selected || !!S.exporting || !!S.videoLoading;
  const index = clips.findIndex(c => c.id === S.selectedClip);
  $('clipMoveLeft').disabled = index <= 0 || !!S.exporting;
  $('clipMoveRight').disabled = index < 0 || index >= clips.length - 1 || !!S.exporting;
  $('editUndo').disabled = !S.editPast.length || !!S.exporting || !!S.videoLoading;
  $('editRedo').disabled = !S.editFuture.length || !!S.exporting || !!S.videoLoading;
  if (selected) {
    for (const [id, key] of [['clipIn', 'in'], ['clipOut', 'out'], ['clipFadeIn', 'fadeIn'], ['clipFadeOut', 'fadeOut']]) $(id).value = String(+selected[key].toFixed(4));
    $('clipIn').max = String(selected.source.duration); $('clipOut').max = String(selected.source.duration);
    const speed = $('clipSpeed');
    if (![...speed.options].some(o => +o.value === selected.speed)) speed.add(new Option(selected.speed + '×', String(selected.speed)));
    speed.value = String(selected.speed);
    $('clipVolume').value = String(Math.round(selected.volume * 100));
    $('clipVolumeValue').textContent = Math.round(selected.volume * 100) + '%';
    $('clipFlip').checked = selected.flip;
  }
  updateClipPlayhead();
}
function editSnapshot() { return { edit: JSON.parse(JSON.stringify(S.project.edit)), selected: S.selectedClip, t: S.t }; }
function pruneMedia() {
  const keep = new Set(S.project.edit.clips.map(c => c.sourceId));
  for (const segment of S.project.director?.segments || []) if (segment.sourceId) keep.add(segment.sourceId);
  if (S.directorAssemblyBackup) {
    for (const clip of S.directorAssemblyBackup.project.edit.clips) keep.add(clip.sourceId);
    for (const segment of S.directorAssemblyBackup.project.director?.segments || []) if (segment.sourceId) keep.add(segment.sourceId);
  }
  for (const snapshot of [...S.editPast, ...S.editFuture]) for (const clip of snapshot.edit.clips) keep.add(clip.sourceId);
  for (const [id, media] of S.media) if (!keep.has(id)) { J.releaseVideo(media); S.media.delete(id); }
}
function restoreEdit(snapshot) {
  pause(); S.seekId++; S.videoSeeking = false;
  S.project.edit = J.normalizeVideoEdit(snapshot.edit);
  S.selectedClip = snapshot.selected;
  const first = S.project.edit.clips[0];
  if (first) S.project.video.source = S.project.edit.sources.find(s => s.id === first.sourceId);
  else delete S.project.video.source;
  S.video = null; S.activeClip = null;
  pruneMedia();
  replan(); syncOut(); seek(snapshot.t || 0);
}
function changeEdit(next, selected = S.selectedClip, time = S.t) {
  if (S.exporting || S.videoLoading) return false;
  const normalized = J.normalizeVideoEdit(next);
  if (JSON.stringify(normalized) === JSON.stringify(S.project.edit)) return false;
  S.editPast.push(editSnapshot()); if (S.editPast.length > 60) S.editPast.shift(); S.editFuture = [];
  restoreEdit({ edit: normalized, selected, t: time });
  return true;
}
function editUndo() {
  if (S.exporting || S.videoLoading || !S.editPast.length) return;
  S.editFuture.push(editSnapshot()); restoreEdit(S.editPast.pop());
}
function editRedo() {
  if (S.exporting || S.videoLoading || !S.editFuture.length) return;
  S.editPast.push(editSnapshot()); restoreEdit(S.editFuture.pop());
}
function selectClip(id) {
  const clip = S.editTimeline.clips.find(c => c.id === id);
  if (!clip || S.exporting || S.videoLoading) return;
  pause(); S.selectedClip = id; renderVideoEditor(); seek(clip.start);
}
function applyClipPatch(id, patch) {
  if (S.exporting || S.videoLoading) return false;
  const next = J.updateVideoClip(S.project.edit, id, patch);
  const clip = J.buildVideoTimeline(next).clips.find(c => c.id === id);
  return changeEdit(next, id, clip.start);
}
function splitSelectedClip() {
  try {
    const next = J.splitVideoClip(S.project.edit, S.selectedClip, S.t);
    return changeEdit(next, S.selectedClip, S.t);
  } catch (error) { toast(error.message); return false; }
}
function bindVideoEditor() {
  $('clipApply').addEventListener('click', () => {
    const clip = S.editTimeline.clips.find(c => c.id === S.selectedClip); if (!clip) return;
    const patch = { in: +$('clipIn').value, out: +$('clipOut').value, speed: +$('clipSpeed').value, volume: +$('clipVolume').value / 100, fadeIn: +$('clipFadeIn').value, fadeOut: +$('clipFadeOut').value, flip: $('clipFlip').checked };
    if ([patch.in, patch.out, patch.speed, patch.volume, patch.fadeIn, patch.fadeOut].some(v => !Number.isFinite(v)) || patch.in < 0 || patch.out > clip.source.duration + 0.001 || patch.out <= patch.in || patch.out - patch.in < Math.min(0.04, clip.source.duration, clip.out - clip.in) - 0.0001) { toast('開始と終了を動画の範囲内で指定してください。終了は開始より後にしてください。'); return; }
    applyClipPatch(clip.id, patch);
  });
  $('clipVolume').addEventListener('input', () => { $('clipVolumeValue').textContent = $('clipVolume').value + '%'; });
  $('clipSplit').addEventListener('click', splitSelectedClip);
  const operation = fn => () => {
    if (!S.selectedClip || S.exporting || S.videoLoading) return;
    try {
      const next = fn(S.project.edit, S.selectedClip);
      const clip = J.buildVideoTimeline(next).clips.find(c => c.id === S.selectedClip);
      changeEdit(next, S.selectedClip, clip ? clip.start : 0);
    } catch (error) { toast(error.message); }
  };
  $('clipDuplicate').addEventListener('click', operation(J.duplicateVideoClip));
  $('clipDelete').addEventListener('click', operation(J.removeVideoClip));
  $('clipMoveLeft').addEventListener('click', operation((edit, id) => J.moveVideoClip(edit, id, -1)));
  $('clipMoveRight').addEventListener('click', operation((edit, id) => J.moveVideoClip(edit, id, 1)));
  $('editUndo').addEventListener('click', editUndo); $('editRedo').addEventListener('click', editRedo);
  for (const [id, target] of [['clipSetIn', 'clipIn'], ['clipSetOut', 'clipOut']]) $(id).addEventListener('click', () => {
    const clip = S.editTimeline.clips.find(c => c.id === S.selectedClip);
    if (!clip || S.t < clip.start || S.t > clip.end) { toast('選択したクリップの中へ再生位置を移動してください。'); return; }
    $(target).value = J.clipSourceTime(clip, S.t).toFixed(3);
  });
}
function releaseAllMedia() {
  pause(); S.seekId++; S.videoSeeking = false;
  for (const media of S.media.values()) J.releaseVideo(media);
  S.media.clear(); S.video = null; S.activeClip = null;
}
function removeVideo() {
  if (S.exporting) return;
  if (S.videoLoading) S.videoLoading.abort(); S.videoLoading = null;
  changeEdit({ sources: S.project.edit.sources, clips: [] }, null, 0);
  syncVideoUI();
}
async function loadVideoFiles(files) {
  if (S.exporting || !files.length) return false;
  pause();
  if (S.videoLoading) S.videoLoading.abort();
  const task = new AbortController(); S.videoLoading = task;
  const next = J.normalizeVideoEdit(S.project.edit), mediaMap = new Map(S.media), allocated = [];
  const errors = []; let changed = false, connected = false, firstNew = null;
  $('btnRemoveVideo').hidden = false;
  renderVideoEditor();
  try {
    for (const file of files) {
      if (task.signal.aborted) break;
      $('videoName').textContent = '動画を読み込み中: ' + file.name;
      let source = next.sources.find(s => s.name === file.name && s.size === file.size && (!s.lastModified || !file.lastModified || s.lastModified === file.lastModified));
      if (!source) {
        const candidates = next.sources.filter(s => s.name === file.name && s.size === file.size && !mediaMap.has(s.id) && next.clips.some(c => c.sourceId === s.id));
        // Copying a file between devices often changes its modification date.
        // Reconnect only an unambiguous saved source; never guess among matches.
        if (candidates.length === 1) source = candidates[0];
      }
      const reconnect = source && !mediaMap.has(source.id) && next.clips.some(c => c.sourceId === source.id);
      let media = source && mediaMap.get(source.id);
      try {
        if (!media) {
          media = await J.loadVideo(file, { signal: task.signal }); allocated.push(media);
          try { media.audio = await J.analyzeAudio(file); } catch (error) { media.audio = null; }
        }
        if (task.signal.aborted) break;
        if (!source) {
          source = { id: J.newVideoId(), name: file.name, size: file.size, lastModified: file.lastModified, duration: media.duration, width: media.width, height: media.height };
          next.sources.push(source);
        }
        Object.assign(source, { duration: media.duration, width: media.width, height: media.height });
        mediaMap.set(source.id, media); connected = true;
        if (!reconnect) {
          const clip = { id: J.newVideoId(), sourceId: source.id, in: 0, out: media.duration, speed: 1, volume: 1, fadeIn: 0, fadeOut: 0, flip: false };
          next.clips.push(clip); changed = true; if (!firstNew) firstNew = clip.id;
        }
      } catch (error) { if (!task.signal.aborted) errors.push(file.name + ': ' + error.message); }
    }
    if (task.signal.aborted || S.videoLoading !== task) return false;
    const wasEmpty = !hasVideoEdit();
    S.media = mediaMap;
    for (const media of allocated) {
      media.element.addEventListener('waiting', () => { if (S.video === media) AP.stop(); });
      media.element.addEventListener('seeked', () => { if (S.video === media) S.need = true; });
      media.element.addEventListener('error', () => { if (S.video === media) { pause(); toast('動画を再生できません。元ファイルを確認してください。'); } });
    }
    S.videoLoading = null;
    if (changed) changeEdit(next, firstNew || S.selectedClip, wasEmpty ? 0 : S.t);
    else { replan(); seek(S.t); }
    if (wasEmpty && next.clips.length) {
      const source = next.sources.find(s => s.id === next.clips[0].sourceId);
      const gcd = (a, b) => b ? gcd(b, a % b) : a, divisor = gcd(source.width, source.height);
      S.project.aspect = `${source.width / divisor}:${source.height / divisor}`;
    }
    syncUI(); replan(); codecNote();
    if (errors.length) toast(errors.join(' / '));
    return connected;
  } finally {
    if (task.signal.aborted || !connected) for (const media of allocated) if (![...S.media.values()].includes(media)) J.releaseVideo(media);
    if (S.videoLoading === task) S.videoLoading = null;
    syncVideoUI(); renderVideoEditor();
  }
}
const loadVideoFile = file => loadVideoFiles([file]);

/* song file -> beat analysis (file input, or a host such as the After Effects panel) */
async function loadAudioFile(f) {
  if (S.exporting) return false;
  if (S.audioLoading) S.audioLoading.abort();
  const task = new AbortController(); S.audioLoading = task;
  $('audioName').textContent = '解析中…';
  try {
    pause();
    const audio = await J.analyzeAudio(f);
    if (task.signal.aborted || S.audioLoading !== task) return false;
    audio.size = f.size; audio.lastModified = f.lastModified;
    S.audio = audio;
    if (hasVideoEdit()) S.project.video.audioSource = 'audio';
    $('audioName').textContent = `${f.name}（${J.fmtTime(S.audio.duration)}・約${S.audio.bpm}BPM）`;
    S.project.timing.snap = true;
    syncUI(); replan();
    return true;
  } catch (err) {
    if (!task.signal.aborted) $('audioName').textContent = '読み込めませんでした: ' + err.message;
    return false;
  } finally {
    if (S.audioLoading === task) { S.audioLoading = null; syncVideoUI(); if (J.directorUI) J.directorUI.render(); }
  }
}

/* Director assembly is one reversible operation, including lyric timing.
   Recompute from the validated model so stale or hand-edited result objects
   cannot bypass source-length and timing checks. */
function directorReady() {
  if (S.exporting || S.videoLoading || S.audioLoading || S.imageLoading ||
      (J.directorUI && J.directorUI.loading && J.directorUI.loading())) {
    throw new Error('素材の読み込み・書き出しが終わってから操作してください。');
  }
}
function applyDirectorAssembly(result, model) {
  directorReady();
  const director = J.directorNormalize(model);
  if (!director) throw new Error('MV設計データを確認してください。');
  const song = director.song, audio = S.audio;
  if (!audio || Math.abs(audio.duration - song.duration) > 0.05 ||
      (song.name && audio.name !== song.name) || (song.size && audio.size !== song.size)) {
    throw new Error('MV設計に使用した元の曲を読み込んでください。曲を変更した場合は設計を作り直してください。');
  }
  const assembled = J.directorAssemble(director, S.media);
  const next = mergeProject(JSON.parse(JSON.stringify(S.project)));
  next.director = director;
  next.edit = J.normalizeVideoEdit(assembled.edit);
  next.lyrics = assembled.lyrics;
  next.aspect = '16:9'; next.includeAudio = true;
  next.video.audioSource = 'audio';
  Object.assign(next.timing, { lineTimes: assembled.lyricTimes, lineEnds: assembled.lyricEnds, useAudioLength: true, snap: false });
  // Keep source references alive until the explicit assembly undo is discarded.
  S.directorAssemblyBackup = { project: JSON.parse(JSON.stringify(S.project)), audio: S.audio, selected: S.selectedClip, t: S.t };
  pause(); S.tap = null; $('tapPanel').hidden = true; $('btnTap').setAttribute('aria-pressed', 'false');
  S.editPast = []; S.editFuture = [];
  S.project = next;
  restoreEdit({ edit: next.edit, selected: next.edit.clips[0]?.id || null, t: 0 });
  syncUI(); flushSave();
  return true;
}
function restoreDirectorAssembly() {
  directorReady();
  const backup = S.directorAssemblyBackup;
  if (!backup) return false;
  // Undo the fields assembly owns. Preserve later image/style edits and their
  // live media history instead of resurrecting already released image assets.
  const restored = Object.assign({}, S.project);
  for (const key of ['edit', 'lyrics', 'timing', 'aspect', 'includeAudio', 'video', 'director']) restored[key] = backup.project[key];
  pause(); S.project = mergeProject(restored); S.audio = backup.audio;
  S.editPast = []; S.editFuture = []; S.directorAssemblyBackup = null;
  restoreEdit({ edit: S.project.edit, selected: backup.selected, t: backup.t });
  $('audioName').textContent = S.audio ? `${S.audio.name}（${J.fmtTime(S.audio.duration)}・約${S.audio.bpm}BPM）` : '曲を使う場合は、曲も読み込み直してください。';
  syncUI(); flushSave();
  return true;
}

/* ---------------- boot ---------------- */
function boot() {
  S.project = loadLocal();
  bind(); syncUI(); replan();
  let mode = 'easy'; try { mode = localStorage.getItem('jizura.mode') || 'easy'; } catch (e) {}
  setMode(mode); commit();
  // open on a representative frame (end of the first cut's entrance)
  const c0 = S.plan.cuts.find(c => c.line >= 0);
  if (c0) seek(c0.start + Math.min(c0.dur * 0.6, c0.inDur + 0.25));
  requestAnimationFrame(tick);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
J.ui = S;
// hooks for hosts that embed the app (the After Effects CEP panel)
J.uiApi = { toast, replan, syncUI, play, pause, seek, flushSave, loadAudioFile, loadVideoFile, loadVideoFiles, removeVideo, runExport, restartPreview, selectClip, applyClipPatch, splitSelectedClip, editUndo, editRedo, applyDirectorAssembly, restoreDirectorAssembly, pruneMedia };
})();
