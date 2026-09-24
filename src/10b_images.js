/* ============================================================
   JIZURA — image layers using the same motion pipeline as lyrics
   A whole image is one glyph; tile mode is a 4 × 4 glyph grid.
   Source colours and alpha are retained, including in fragments.
   ============================================================ */
(() => {
'use strict';

const obj = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const num = (v, fallback) => (typeof v === 'number' || typeof v === 'string' && v.trim()) && Number.isFinite(Number(v)) ? Number(v) : fallback;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const idText = v => typeof v === 'string' ? v.trim().slice(0, 160) : '';
const abortError = () => new DOMException('キャンセルしました', 'AbortError');
let serial = 0;
J.newImageId = () => 'image-' + (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + '-' + (++serial).toString(36));
const unique = (v, used) => { let id = idText(v); while (!id || used.has(id)) id = J.newImageId(); used.add(id); return id; };

/* Explicitly audited geometry recipes. Letter replacement, drawn letter
   outlines and colour-only treatments have no honest image equivalent.
   Resolve the late-loaded expression packs when called, not at startup. */
const compatible = {
  enter: ('cut assemble slice type pop drop stretch wipe blur spin flicker zoom ' +
    'riseMask dropMask slideL slideR slideWhole flipY domino fold unroll splitJoin vSlice shutter iris diagWipe blinds checker ' +
    'randomOrder bounceBig squashDrop rubber glitchIn whip skewIn trackIn trackOut blurStagger fadeStagger waveIn spiralIn zoomOut magnet inkBleed neonOn cursorSweep stamp ' +
    'springIn pendulum rollIn slingshot rockSettle bounceBall snapRail fanOpen cylinder shuffle stopMotion ripple zipper zoomAlt tiltUp crumple noteUnfold tornJoin heatHaze crtOn interlace quarters liquidFill windBlown clockWipe bubbles').split(' '),
  hold: ('still jitter drift breathe wave glitchtick float sway pulse shimmer rotateSlow trackBreathe skewWobble beatHop hWave heartbeat orbitSmall jelly scanBand noiseDrift tilt zoomSlow stretchPulse glitchJump echoTrail ' +
    'glowFlicker windGust dangle eqBounce magnetJiggle typeRattle focusRack pluckString').split(' '),
  exit: ('cut explode fall drift slice wipe shrink blur stretch scatter glitch ' +
    'sinkMask riseOut slideOutL slideOutR flipOutX flipOutY foldOut squash trackOutWide collapse zoomThrough zoomFar spinOut twist waveOut blurOutStagger irisClose diagWipeOut blindsClose checkerOut splitApart vSliceDrop melt dissolve backspace glitchDissolve whipOut gravity popOut sweepCover shatterLite ' +
    'peelOff crumpleOut tearOut vacuumOut sandOut shredOut dominoOut hingeOut bounceOff balloonOff deflateOut hazeOut zipOut clapShut lampOff clockOut tornadoOut rollUpOut snakeOut flutterOut rollOff fanClose shockOut floodOut slashOut mosaicOut').split(' '),
};
J.imageMotionOptions = kind => {
  const reg = { enter: J.ENTER, hold: J.HOLD, exit: J.EXIT }[kind];
  return reg ? (compatible[kind] || []).filter(id => reg[id] && typeof reg[id].apply === 'function').map(id => ({ id, name: reg[id].name })) : [];
};
const motion = (kind, value) => J.imageMotionOptions(kind).some(o => o.id === value) ? value : kind === 'hold' ? 'still' : 'cut';

J.normalizeImageOverlays = raw => {
  const data = obj(raw), sources = [], layers = [], used = new Set(), refs = new Map();
  for (const value of Array.isArray(data.sources) ? data.sources : []) {
    const s = obj(value), oldId = idText(s.id);
    if (oldId && refs.has(oldId)) continue;
    const width = Math.floor(clamp(num(s.width, 0), 0, 16384)), height = Math.floor(clamp(num(s.height, 0), 0, 16384));
    if (!width || !height || width * height > 40000000) continue;
    const id = unique(oldId, used);
    const source = { id, name: typeof s.name === 'string' && s.name ? s.name.slice(0, 512) : '画像', size: Math.floor(clamp(num(s.size, 0), 0, Number.MAX_SAFE_INTEGER)), lastModified: Math.floor(clamp(num(s.lastModified, 0), 0, Number.MAX_SAFE_INTEGER)), width, height };
    sources.push(source); refs.set(oldId || id, source);
  }
  for (const value of Array.isArray(data.layers) ? data.layers : []) {
    const v = obj(value), source = refs.get(idText(v.sourceId));
    if (!source) continue;
    const start = clamp(num(v.start, 0), 0, 86400 - 0.01), end = clamp(num(v.end, start + 5), start + 0.01, 86400), dur = end - start;
    let inDur = clamp(num(v.inDur, 0.6), 0, dur), outDur = clamp(num(v.outDur, 0.6), 0, dur);
    if (inDur + outDur > dur) { const k = dur / (inDur + outDur); inDur *= k; outDur *= k; }
    layers.push({ id: unique(v.id, used), sourceId: source.id, start, end,
      x: clamp(num(v.x, 0.5), -1, 2), y: clamp(num(v.y, 0.5), -1, 2), scale: clamp(num(v.scale, 0.35), 0.01, 4),
      rotation: clamp(num(v.rotation, 0), -3600, 3600), opacity: clamp(num(v.opacity, 1), 0, 1), flip: v.flip === true,
      enter: motion('enter', v.enter), hold: motion('hold', v.hold), exit: motion('exit', v.exit), inDur, outDur,
      mode: v.mode === 'tiles' ? 'tiles' : 'whole', plane: v.plane === 'aboveText' ? 'aboveText' : 'belowText', seed: Math.floor(clamp(num(v.seed, 1), 0, 0x7fffffff)) });
  }
  return { sources, layers };
};

/* Inspect containers to reject animation rather than capture a frame whose
   identity depends on wall-clock decode timing. SVG is intentionally excluded. */
async function inspectFile(file, signal) {
  if (signal && signal.aborted) throw abortError();
  if (!file || !(file.size > 0)) throw new Error('画像ファイルを選んでください。');
  if (file.size > 100 * 1024 * 1024) throw new Error('画像は100MB以下のPNG・JPEG・WebPを選んでください。');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (signal && signal.aborted) throw abortError();
  const str = p => String.fromCharCode(...bytes.subarray(p, p + 4));
  const view = new DataView(bytes.buffer);
  let animated = false;
  if (bytes.length >= 24 && bytes[0] === 137 && str(1) === 'PNG\r') {
    for (let p = 8; p + 12 <= bytes.length;) { const n = view.getUint32(p); if (str(p + 4) === 'acTL') animated = true; if (n > bytes.length - p - 12) break; p += n + 12; }
  } else if (bytes.length >= 12 && str(0) === 'RIFF' && str(8) === 'WEBP') {
    for (let p = 12; p + 8 <= bytes.length;) { const n = view.getUint32(p + 4, true), tag = str(p); if (tag === 'ANIM' || tag === 'ANMF' || tag === 'VP8X' && n > 0 && (bytes[p + 8] & 2)) animated = true; if (n > bytes.length - p - 8) break; p += 8 + n + (n & 1); }
  } else if (!(bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)) {
    throw new Error('画像はPNG・JPEG・WebP形式を選んでください。');
  }
  if (animated) throw new Error('アニメーション画像は静止画のPNG・JPEG・WebPに保存して読み込んでください。');
}

J.loadOverlayImage = async (file, { signal } = {}) => {
  await inspectFile(file, signal);
  let bitmap = null, url = null, image = null;
  try {
    if (typeof createImageBitmap === 'function') {
      const task = createImageBitmap(file);
      bitmap = await new Promise((resolve, reject) => {
        let done = false;
        const finish = (error, value) => { if (done) { if (value) value.close(); return; } done = true; clearTimeout(timer); if (signal) signal.removeEventListener('abort', cancel); error ? reject(error) : resolve(value); };
        const cancel = () => finish(abortError());
        const timer = setTimeout(() => finish(new Error('画像の読み込みがタイムアウトしました。')), 30000);
        if (signal) signal.addEventListener('abort', cancel, { once: true });
        task.then(value => finish(null, value), error => finish(error));
        if (signal && signal.aborted) cancel();
      });
    } else {
      url = URL.createObjectURL(file); image = new Image();
      await new Promise((resolve, reject) => {
        const cleanup = () => { clearTimeout(timer); image.onload = image.onerror = null; if (signal) signal.removeEventListener('abort', cancel); };
        const cancel = () => { cleanup(); reject(abortError()); };
        const timer = setTimeout(() => { cleanup(); reject(new Error('画像の読み込みがタイムアウトしました。')); }, 30000);
        image.onload = () => { cleanup(); resolve(); }; image.onerror = () => { cleanup(); reject(new Error('画像を読み込めませんでした。')); };
        if (signal) signal.addEventListener('abort', cancel, { once: true });
        image.src = url; if (signal && signal.aborted) cancel();
      });
      if (image.naturalWidth * image.naturalHeight > 40000000 || image.naturalWidth > 16384 || image.naturalHeight > 16384) throw new Error('画像は4000万画素以下、各辺16384px以下にしてください。');
      bitmap = document.createElement('canvas'); bitmap.width = image.naturalWidth; bitmap.height = image.naturalHeight;
      bitmap.getContext('2d').drawImage(image, 0, 0);
    }
    if (signal && signal.aborted) throw abortError();
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40000000 || bitmap.width > 16384 || bitmap.height > 16384) throw new Error('画像は4000万画素以下、各辺16384px以下にしてください。');
    return { file, name: file.name || '画像', element: bitmap, width: bitmap.width, height: bitmap.height, url: null };
  } catch (error) {
    if (bitmap && bitmap.close) bitmap.close();
    throw error.name === 'AbortError' || /画像|image/i.test(error.message || '') ? error : new Error('画像を読み込めませんでした。ファイルの形式を確認してください。');
  } finally { if (image) image.src = ''; if (url) URL.revokeObjectURL(url); }
};
J.releaseOverlayImage = asset => {
  if (!asset) return;
  if (asset.element && asset.element.close) asset.element.close();
  else if (asset.element && asset.element.tagName === 'CANVAS') asset.element.width = asset.element.height = 1;
  if (asset.url) URL.revokeObjectURL(asset.url);
  asset.element = null; asset.url = null;
};

/* Add an image dispatch without changing any normal text execution path. */
const textLayout = J.layoutText, textMeasure = J.measure, textDraw = J.drawItem;
J.layoutText = it => {
  if (!it._image) return textLayout(it);
  const out = [], asset = it._image, cols = it._imageMode === 'tiles' ? 4 : 1, rows = cols;
  const H = it.size, W = H * asset.width / asset.height, tw = W / cols, th = H / rows, gap = (it.track || 0) * H;
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) out.push({ ch: '▣', i: out.length, li: row, ci: col, n: cols, x: (col - (cols - 1) / 2) * (tw + gap), y: (row - (rows - 1) / 2) * th, w: tw, h: th, r90: false, vx: 0, vy: 0,
    u: (it._imageFlip ? cols - 1 - col : col) / cols, v: row / rows, uw: 1 / cols, vh: 1 / rows });
  out.W = tw + (cols - 1) * Math.abs(tw + gap); out.H = H; out.N = out.length;
  return out;
};
J.measure = it => !it._image ? textMeasure(it) : (() => { const lay = J.layoutText(it); return { w: lay.W * Math.abs(it.sx ?? 1), h: lay.H * Math.abs(it.sy ?? 1), lay }; })();

function glyphImage(ctx, it, g) {
  const a = it._image;
  if (it._imageFlip) ctx.scale(-1, 1);
  ctx.drawImage(a.element, g.u * a.width, g.v * a.height, g.uw * a.width, g.vh * a.height, -g.w / 2, -g.h / 2, g.w, g.h);
}

/* A piece's normalised geometry has the same shape as a font glyph piece.
   Crop the original glyph region through each moving rectangle/triangle. */
function imagePieces(env, it, g, gx, gy, rot, sx, sy, alpha) {
  const cols = it._imageMode === 'tiles' ? 2 : 6, rows = it._imageMode === 'tiles' ? 2 : 4;
  const pw = g.w / cols, ph = g.h / rows, pieces = [], size = it.size, rad = rot * J.DEG, cr = Math.cos(rad), sr = Math.sin(rad);
  let moving = false;
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const left = -g.w / 2 + col * pw, top = -g.h / 2 + row * ph;
    const polygons = it.shatter ? [[[left, top], [left + pw, top], [left + pw, top + ph]], [[left, top], [left + pw, top + ph], [left, top + ph]]] : [null];
    for (const poly of polygons) {
      const cx = poly ? poly.reduce((n, p) => n + p[0], 0) / 3 : left + pw / 2, cy = poly ? poly.reduce((n, p) => n + p[1], 0) / 3 : top + ph / 2;
      const p = { cx: cx / size, cy: cy / size, w: pw / size, h: ph / size, area: pw * ph / (size * size) / (poly ? 2 : 1), id: pieces.length };
      const ex = cx * sx, ey = cy * sy, ox = gx + ex * cr - ey * sr, oy = gy + ex * sr + ey * cr;
      const tr = it.pieceFn(g.i, pieces.length, p, ox, oy, g);
      if (tr !== J.PID) moving = true;
      pieces.push({ tr, ox, oy, cx, cy, left, top, poly });
    }
  }
  if (!moving) return false;
  const ctx = env.ctx;
  for (const { tr, ox, oy, cx, cy, left, top, poly } of pieces) {
    if (!tr || !(tr.a > 0.003) || !Number.isFinite(tr.dx + tr.dy + tr.rot + tr.s + tr.st)) continue;
    ctx.save(); ctx.translate(ox + tr.dx, oy + tr.dy);
    if (tr.st > 0 && tr.st !== 1) { const d = tr.sdir * J.DEG; ctx.rotate(d); ctx.scale(tr.st, 1 / Math.sqrt(tr.st)); ctx.rotate(-d); }
    ctx.rotate((rot + tr.rot) * J.DEG); ctx.scale(sx * tr.s, sy * tr.s); ctx.translate(-cx, -cy);
    ctx.beginPath();
    if (poly) { poly.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); }
    else ctx.rect(left, top, pw, ph);
    ctx.clip(); ctx.globalAlpha = clamp(alpha * tr.a, 0, 1); glyphImage(ctx, it, g); ctx.restore();
  }
  return true;
}

J.drawItem = (env, it) => {
  if (!it._image) return textDraw(env, it);
  if (!it._image.element || !(it.size > 0.001) || it.fill === false) return null;
  const ctx = env.ctx, lay = J.layoutText(it), sx = it.sx ?? 1, sy = it.sy ?? 1, alpha = clamp(num(it.alpha, 1) * num(it.fillAlpha, 1), 0, 1), boxes = [];
  if (alpha <= 0.002 || !Number.isFinite(it.x + it.y + it.size + sx + sy)) return null;
  ctx.save(); ctx.translate(it.x, it.y); if (it.rot) ctx.rotate(it.rot * J.DEG); if (it.skew) ctx.transform(1, 0, Math.tan(it.skew * J.DEG), 1, 0, 0);
  if (it.blend) ctx.globalCompositeOperation = it.blend;
  if (it.blur > 0.4 && env.allowFilter) ctx.filter = `blur(${(it.blur * env.scale).toFixed(1)}px)`;
  if (it.shadow && env.pass === 'main') { const s = it.shadow; ctx.shadowColor = s.color || 'rgba(0,0,0,0.6)'; ctx.shadowBlur = env.allowFilter ? (s.blur || 0) * env.scale : 0; ctx.shadowOffsetX = (s.dx || 0) * env.scale; ctx.shadowOffsetY = (s.dy || 0) * env.scale; }
  for (const g of lay) {
    const c = it.charFn ? it.charFn(g.i, g, lay.N) : null;
    if (c && (c.hide || c.outline || c.ch)) continue;
    const a = alpha * (c && c.a != null ? c.a : 1), cs = c && c.s != null ? c.s : 1;
    const gx = g.x * sx + (c && c.dx || 0), gy = g.y * sy + (c && c.dy || 0), rot = c && c.rot || 0;
    const csx = sx * cs * (c && c.sx != null ? c.sx : 1), csy = sy * cs * (c && c.sy != null ? c.sy : 1);
    if (a <= 0.002 || Math.abs(csx * csy) < 1e-10 || !Number.isFinite(gx + gy + rot + csx + csy)) continue;
    boxes.push({ x: gx, y: gy, w: g.w * Math.abs(csx), h: g.h * Math.abs(csy) });
    if (it.pieceFn && !(c && (c.clipX || c.clipY || c.skew || c.blur)) && imagePieces(env, it, g, gx, gy, rot, csx, csy, a)) continue;
    ctx.save(); ctx.translate(gx, gy); if (rot) ctx.rotate(rot * J.DEG); if (c && c.skew) ctx.transform(1, 0, Math.tan(c.skew * J.DEG), 1, 0, 0); ctx.scale(csx, csy);
    if (c && (c.clipX || c.clipY)) { const x = c.clipX || [-1, 1], y = c.clipY || [-1, 1]; ctx.beginPath(); ctx.rect(x[0] * g.w, y[0] * g.h, Math.max(0, x[1] - x[0]) * g.w, Math.max(0, y[1] - y[0]) * g.h); ctx.clip(); }
    if (c && c.blur > 0.4 && env.allowFilter) ctx.filter = `blur(${(c.blur * env.scale).toFixed(1)}px)`;
    ctx.globalAlpha = clamp(a, 0, 1); glyphImage(ctx, it, g); ctx.restore();
  }
  ctx.restore();
  if (!boxes.length) return null;
  return { x0: it.x + Math.min(...boxes.map(b => b.x - b.w / 2)), y0: it.y + Math.min(...boxes.map(b => b.y - b.h / 2)), x1: it.x + Math.max(...boxes.map(b => b.x + b.w / 2)), y1: it.y + Math.max(...boxes.map(b => b.y + b.h / 2)), boxes, cx: it.x, cy: it.y };
};

const layersByRenderer = new WeakMap();
function beatAt(beats, t) {
  if (!beats || !beats.length) return null;
  let lo = 0, hi = beats.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (beats[m] <= t) lo = m + 1; else hi = m; }
  if (!lo) return null;
  const i = lo - 1, len = Math.max(0.01, i + 1 < beats.length ? beats[i + 1] - beats[i] : i ? beats[i] - beats[i - 1] : 0.5);
  return { index: i, since: Math.max(0, t - beats[i]), len, phase: clamp((t - beats[i]) / len, 0, 1) };
}
J.drawImageOverlays = (renderer, ctx, plan, t, opt = {}) => {
  const overlays = opt.overlays, data = overlays && overlays.data, media = overlays && overlays.media;
  if (!data || !Array.isArray(data.layers) || !media || !Number.isFinite(t)) return;
  const active = data.layers.filter(l => l.plane === opt.plane && l.opacity > 0 && t >= l.start && t < l.end);
  if (!active.length) return;
  const W = plan.W, H = plan.H, scale = opt.scale || 1, cw = ctx.canvas.width, ch = ctx.canvas.height;
  let cv = layersByRenderer.get(renderer);
  if (!cv) { cv = document.createElement('canvas'); layersByRenderer.set(renderer, cv); }
  if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
  const x = cv.getContext('2d'), style = plan.style, fx = Object.assign({ motion: 0.7, glitch: 0.55 }, plan.fx), fps = plan.fps || 30;
  const stepDur = J.stepDur(fx, fps), clock = J.komaOf(fx) > 0 ? stepDur : 1 / 24;
  const baseCut = J.cutAt(plan, t), sc = style.schemes[baseCut ? baseCut.scheme % style.schemes.length : 0] || style.schemes[0];
  for (const l of active) {
    const asset = media.get(l.sourceId); if (!asset || !asset.element || !asset.width || !asset.height) continue;
    x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.filter = 'none'; x.clearRect(0, 0, cw, ch); x.setTransform(scale, 0, 0, scale, 0, 0);
    const dur = l.end - l.start, text = '▣'.repeat(l.mode === 'tiles' ? 16 : 1), cut = { start: l.start, end: l.end, dur, inDur: l.inDur, outDur: l.outDur, enter: l.inDur > 0 ? motion('enter', l.enter) : 'cut', hold: motion('hold', l.hold), exit: motion('exit', l.exit), seed: l.seed, stagger: 0, text };
    let tq = Math.floor(t / stepDur + 1e-6) * stepDur; if (tq < l.start || dur < stepDur) tq = t;
    const lt = tq - l.start, energy = plan.energy && plan.energy.length ? plan.energy[Math.min(plan.energy.length - 1, Math.max(0, Math.floor(t * plan.energyRate)))] : null;
    const env = renderer.makeEnv(x, plan, cut, sc, { pass: 'main', t: tq, lt, ltb: lt, step: Math.floor(tq / clock + 1e-6), scale, allowFilter: renderer.filterOK && !opt.fast, energy, beat: beatAt(plan.beats, tq), fx });
    const size = Math.min(W / asset.width, H / asset.height) * asset.height * l.scale;
    const item = { _image: asset, _imageMode: l.mode, _imageFlip: l.flip, text, font: 'gothic_black', size, x: l.x * W, y: l.y * H, rot: l.rotation, sx: 1, sy: 1, track: 0, alpha: 1, plain: true, color: sc.fg, seed: l.seed };
    // Recipes reset globalAlpha inside their helper graphics. Isolate the
    // complete result, then apply user opacity exactly once at composition.
    x.save(); try { J.mainDraw(env, item); } finally { x.restore(); }
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = l.opacity; ctx.filter = 'none'; ctx.drawImage(cv, 0, 0); ctx.restore();
  }
};
})();
