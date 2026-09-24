/* ============================================================
   JIZURA — local MV media and lyric-layer compositing
   ============================================================ */
(() => {
'use strict';

const pendingSeeks = new WeakMap();
const lyricLayers = new WeakMap();
const abortError = () => new DOMException('キャンセルしました', 'AbortError');
const finite = (value, fallback) => value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

J.videoSettings = (raw = {}) => {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    fit: s.fit === 'cover' ? 'cover' : 'contain',
    dim: clamp(finite(s.dim, 0.15), 0, 0.8),
    textScale: clamp(finite(s.textScale, 0.72), 0.2, 1),
    x: clamp(finite(s.x, 0.5), 0, 1),
    y: clamp(finite(s.y, 0.5), 0, 1),
    shadow: s.shadow !== false,
    audioSource: ['video', 'audio', 'mute'].includes(s.audioSource) ? s.audioSource : 'video',
  };
};

function mediaError(element) {
  const code = element.error && element.error.code;
  if (code === 3) return new Error('動画をデコードできませんでした。別の形式で保存して読み込んでください。');
  if (code === 4) return new Error('このブラウザでは動画の形式を再生できません。MP4（H.264）などに変換して読み込んでください。');
  return new Error('動画を読み込めませんでした。ファイルを確認してください。');
}

/* The object URL is retained until releaseVideo: the browser decodes frames on
   demand, including the independent frame-by-frame export pass. */
J.loadVideo = async (file, { signal } = {}) => {
  if (signal && signal.aborted) throw abortError();
  if (!file || !file.size) throw new Error('動画ファイルを選んでください。');
  const element = document.createElement('video');
  element.muted = true;
  element.defaultMuted = true;
  element.playsInline = true;
  element.preload = 'auto';
  element.setAttribute('playsinline', '');
  const url = URL.createObjectURL(file);
  const media = { element, url, file, name: file.name || 'MV', duration: 0, width: 0, height: 0 };
  try {
    await new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        element.removeEventListener('loadedmetadata', check);
        element.removeEventListener('loadeddata', check);
        element.removeEventListener('canplay', check);
        element.removeEventListener('error', fail);
        if (signal) signal.removeEventListener('abort', cancel);
      };
      const finish = error => {
        if (settled) return;
        settled = true; cleanup();
        error ? reject(error) : resolve();
      };
      const check = () => {
        if (element.error) return finish(mediaError(element));
        if (element.readyState < 2 || !element.videoWidth || !element.videoHeight) return;
        if (!(element.duration > 0) || !Number.isFinite(element.duration)) {
          return finish(new Error('動画の長さを取得できませんでした。動画編集ソフトなどで保存し直して読み込んでください。'));
        }
        finish();
      };
      const fail = () => finish(mediaError(element));
      const cancel = () => finish(abortError());
      const timer = setTimeout(() => finish(new Error('動画の読み込みがタイムアウトしました。ファイルの形式を確認してください。')), 30000);
      element.addEventListener('loadedmetadata', check);
      element.addEventListener('loadeddata', check);
      element.addEventListener('canplay', check);
      element.addEventListener('error', fail);
      if (signal) signal.addEventListener('abort', cancel, { once: true });
      if (signal && signal.aborted) return cancel();
      try { element.src = url; element.load(); check(); } catch (error) { finish(error); }
    });
    media.duration = element.duration;
    media.width = element.videoWidth;
    media.height = element.videoHeight;
    return media;
  } catch (error) {
    J.releaseVideo(media);
    throw error;
  }
};

J.releaseVideo = media => {
  if (!media) return;
  const element = media.element;
  if (element) {
    const pending = pendingSeeks.get(element);
    if (pending) pending.cancel();
    element.pause();
    element.removeAttribute('src');
    try { element.load(); } catch (error) {}
  }
  if (media.url) { URL.revokeObjectURL(media.url); media.url = null; }
};

/* A paused video does not reliably deliver requestVideoFrameCallback. Waiting
   for the completed seek and HAVE_CURRENT_DATA works for offline exports too.
   Each call supersedes an earlier seek on this element, so scrubbing cannot
   leave stale listeners or resolve an old frame as the latest request. */
J.seekVideo = (element, time, signal) => {
  const previous = pendingSeeks.get(element);
  if (previous) previous.cancel();
  if (signal && signal.aborted) return Promise.reject(abortError());
  if (element.error) return Promise.reject(mediaError(element));
  if (!(element.duration > 0) || !Number.isFinite(element.duration)) {
    return Promise.reject(new Error('動画の読み込みが完了していません。'));
  }
  const target = clamp(finite(time, 0), 0, Math.max(0, element.duration - 0.000001));
  if (!element.seeking && element.readyState >= 2 && Math.abs(element.currentTime - target) < 0.000001) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const token = { cancel: () => finish(abortError()) };
    const cleanup = () => {
      clearTimeout(timer);
      element.removeEventListener('seeked', check);
      element.removeEventListener('loadeddata', check);
      element.removeEventListener('canplay', check);
      element.removeEventListener('error', fail);
      if (signal) signal.removeEventListener('abort', cancel);
      if (pendingSeeks.get(element) === token) pendingSeeks.delete(element);
    };
    const finish = error => {
      if (settled) return;
      settled = true; cleanup();
      error ? reject(error) : resolve();
    };
    const check = () => {
      if (element.error) return finish(mediaError(element));
      if (!element.seeking && element.readyState >= 2 && Math.abs(element.currentTime - target) < 0.0001) finish();
    };
    const fail = () => finish(mediaError(element));
    const cancel = () => finish(abortError());
    const timer = setTimeout(() => finish(new Error('動画のフレーム取得がタイムアウトしました。別の形式で保存してお試しください。')), 20000);
    pendingSeeks.set(element, token);
    element.addEventListener('seeked', check);
    element.addEventListener('loadeddata', check);
    element.addEventListener('canplay', check);
    element.addEventListener('error', fail);
    if (signal) signal.addEventListener('abort', cancel, { once: true });
    if (signal && signal.aborted) return cancel();
    try { element.currentTime = target; check(); } catch (error) { finish(error); }
  });
};

/* The MV is never passed through the lyric renderer: its camera, colour shifts
   and full-screen transitions must not move, tint or hide the source footage. */
J.drawComposite = (renderer, ctx, plan, t, opt = {}) => {
  const media = opt.video;
  if (!media || !media.element) {
    renderer.frame(ctx, plan, t, opt);
    return;
  }
  const settings = J.videoSettings(opt.settings);
  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  let layer = lyricLayers.get(renderer);
  if (!layer) { layer = document.createElement('canvas'); lyricLayers.set(renderer, layer); }
  if (layer.width !== cw) layer.width = cw;
  if (layer.height !== ch) layer.height = ch;
  const lx = layer.getContext('2d');
  // keyBg is a separate export workflow; MV overlays retain the chosen colours.
  const lyricPlan = plan.keyBg ? Object.assign({}, plan, { keyBg: null }) : plan;
  renderer.frame(lx, lyricPlan, t, {
    scale: opt.scale || cw / plan.W, fast: !!opt.fast,
    transparent: true, noHud: true, noTrans: true, noPost: true, preciseCuts: true,
  });
  const size = clamp(finite(settings.textScale, 1), 0.2, 1);
  const x = clamp(finite(settings.x, 0.5), 0, 1);
  const y = clamp(finite(settings.y, 0.5), 0, 1);
  const dim = clamp(finite(settings.dim, 0), 0, 0.8);
  ctx.save();
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.filter = 'none';
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    ctx.clearRect(0, 0, cw, ch);
    if (!opt.transparent) {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cw, ch);
      const video = media.element;
      const vw = video.videoWidth || media.width, vh = video.videoHeight || media.height;
      if (video.readyState >= 2 && vw > 0 && vh > 0) {
        const ratio = (settings.fit === 'cover' ? Math.max : Math.min)(cw / vw, ch / vh);
        const dw = vw * ratio, dh = vh * ratio;
        ctx.drawImage(video, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
      }
      if (dim > 0) { ctx.fillStyle = `rgba(0,0,0,${dim})`; ctx.fillRect(0, 0, cw, ch); }
    }
    if (settings.shadow !== false) {
      ctx.shadowColor = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur = Math.max(2, ch / 1080 * 10);
      ctx.shadowOffsetY = Math.max(1, ch / 1080 * 2);
    }
    ctx.drawImage(layer, cw * x - cw * size / 2, ch * y - ch * size / 2, cw * size, ch * size);
  } finally { ctx.restore(); }
};
})();
