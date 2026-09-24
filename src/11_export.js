/* ============================================================
   JIZURA — export: MP4 (WebCodecs + mp4-muxer), PNG sequence ZIP,
   file saving (artifact download capability or plain browser download)
   ============================================================ */
(() => {
'use strict';

/* ---------- saving ---------- */
J.saveFile = async (filename, data) => {
  const blob = data instanceof Blob ? data : new Blob([data]);
  try {
    if (window.claude && typeof window.claude.use === 'function') {
      const dl = await window.claude.use('downloads');
      if (dl) { await dl.save({ filename, data: blob }); return 'saved'; }
    }
  } catch (e) {
    if (e && e.code === 'declined') return 'declined';
    if (e && e.code && e.code !== 'unavailable' && e.code !== 'not_granted') throw e;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'saved';
};

/* ---------- codec negotiation ---------- */
J.pickVideoCodec = async (w, h, fps, bitrate) => {
  if (typeof VideoEncoder === 'undefined') return null;
  const cands = [
    { codec: 'avc1.640033', mux: 'avc', label: 'H.264 High' },
    { codec: 'avc1.4d0033', mux: 'avc', label: 'H.264 Main' },
    { codec: 'avc1.42003e', mux: 'avc', label: 'H.264 Baseline' },
    { codec: 'vp09.00.51.08', mux: 'vp9', label: 'VP9' },
    { codec: 'av01.0.12M.08', mux: 'av1', label: 'AV1' },
  ];
  for (const c of cands) {
    const cfg = { codec: c.codec, width: w, height: h, bitrate, framerate: fps };
    if (c.mux === 'avc') cfg.avc = { format: 'avc' };
    try { const s = await VideoEncoder.isConfigSupported(cfg); if (s.supported) return Object.assign({}, c, { cfg }); } catch (e) {}
  }
  return null;
};
J.pickAudioCodec = async (sr, chn) => {
  if (typeof AudioEncoder === 'undefined') return null;
  for (const c of [{ codec: 'mp4a.40.2', mux: 'aac', sr: 48000 }, { codec: 'opus', mux: 'opus', sr: 48000 }]) {
    try { const s = await AudioEncoder.isConfigSupported({ codec: c.codec, sampleRate: c.sr, numberOfChannels: chn, bitrate: 192000 }); if (s.supported) return c; } catch (e) {}
  }
  return null;
};

async function resample(buffer, sr, duration) {
  const chn = Math.min(2, buffer.numberOfChannels);
  const len = Math.ceil(duration * sr);
  const oc = new OfflineAudioContext(chn, len, sr);
  const src = oc.createBufferSource(); src.buffer = buffer; src.connect(oc.destination); src.start(0);
  return oc.startRendering();
}

function checkExport(signal, error) {
  if (signal && signal.aborted) {
    const e = new Error('キャンセルしました'); e.name = 'AbortError'; throw e;
  }
  if (error) throw error;
}

// flush(), video loading and OfflineAudioContext rendering may take a while. Let
// cancellation leave immediately; the underlying promise still has a rejection
// handler, so closing an encoder cannot produce an unhandled rejection.
function abortable(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      const e = new Error('キャンセルしました'); e.name = 'AbortError'; reject(e);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(value => {
      signal.removeEventListener('abort', onAbort); resolve(value);
    }, e => {
      signal.removeEventListener('abort', onAbort); reject(e);
    });
    if (signal.aborted) onAbort();
  });
}

async function drainEncoder(encoder, limit, signal, getError) {
  checkExport(signal, getError());
  while (encoder.encodeQueueSize > limit) {
    await abortable(new Promise(resolve => setTimeout(resolve, 2)), signal);
    checkExport(signal, getError());
    if (encoder.state === 'closed') throw new Error('エンコーダーが停止しました。もう一度書き出してください。');
  }
}

function closeEncoder(encoder) {
  if (encoder && encoder.state !== 'closed') { try { encoder.close(); } catch (e) {} }
}

function renderExport(renderer, ctx, plan, t, scale, video, settings, transparent = false, clip = null, overlays = null) {
  if (J.drawComposite) J.drawComposite(renderer, ctx, plan, t, { scale, video, settings, transparent, clip, overlays });
  else renderer.frame(ctx, plan, t, { scale, transparent });
}

function validateOverlays(overlays, project) {
  const data = overlays && overlays.data || project.images;
  if (!data || !Array.isArray(data.layers) || !data.layers.length) return;
  for (const layer of data.layers) {
    if (!overlays || !overlays.media || !overlays.media.get(layer.sourceId)) {
      const source = (data.sources || []).find(s => s.id === layer.sourceId);
      const name = source ? source.name : layer.sourceId;
      throw new Error(`画像「${name}」を再選択してください。元ファイルが読み込まれていません。`);
    }
  }
}

function validateSequence(sequence) {
  if (!sequence) return;
  if (!sequence.timeline || !Array.isArray(sequence.timeline.clips) || !sequence.media || typeof sequence.media.get !== 'function') {
    throw new Error('動画の編集情報を読み込めません。動画を読み込み直してください。');
  }
  for (const clip of sequence.timeline.clips) {
    if (!sequence.media.get(clip.sourceId)) {
      const name = clip.source && clip.source.name || clip.sourceId;
      throw new Error(`動画「${name}」を再選択してください。元ファイルが読み込まれていません。`);
    }
  }
}

// Cache a decoder for each distinct source, independently of the live preview.
// Seeking a reused source backwards is necessary after reorders and splits.
function sequenceFrames(sequence, signal, transparent = false) {
  const decoders = new Map();
  return {
    async at(t) {
      checkExport(signal);
      const clip = J.videoClipAt(sequence.timeline, t);
      if (!clip) return { video: sequence.media.values().next().value || null, clip: null };
      const source = sequence.media.get(clip.sourceId);
      if (transparent) return { video: source, clip };
      let video = decoders.get(clip.sourceId);
      if (!video) {
        video = await J.loadVideo(source.file, { signal });
        decoders.set(clip.sourceId, video);
      }
      checkExport(signal);
      await J.seekVideo(video.element, J.clipSourceTime(clip, t), signal);
      checkExport(signal);
      return { video, clip };
    },
    release() { for (const video of decoders.values()) J.releaseVideo(video); decoders.clear(); },
  };
}

/* Edit source audio with the same cuts, order, speed and fades as the footage.
   playbackRate intentionally changes pitch, matching video.preservesPitch=false. */
J.renderSequenceAudio = async (sequence, { signal, sampleRate = 48000 } = {}) => {
  checkExport(signal);
  validateSequence(sequence);
  const timeline = sequence.timeline;
  const audible = timeline.clips.filter(clip => clip.volume > 0);
  if (!audible.length) return null;
  for (const clip of audible) {
    const source = sequence.media.get(clip.sourceId);
    if (!source.audio || !source.audio.buffer) {
      throw new Error(`動画「${source.name || clip.source && clip.source.name || clip.sourceId}」の音声を取得できません。このクリップを消音にするか、音楽ファイルを選んでください。`);
    }
  }
  if (!(timeline.duration > 0) || !Number.isFinite(timeline.duration)) throw new Error('書き出す動画の長さを確認してください。');
  const channels = Math.min(2, Math.max(...audible.map(clip => sequence.media.get(clip.sourceId).audio.buffer.numberOfChannels)));
  const oc = new OfflineAudioContext(channels, Math.ceil(timeline.duration * sampleRate), sampleRate);
  const nodes = [];
  try {
    for (const clip of audible) {
      checkExport(signal);
      const src = oc.createBufferSource(), gain = oc.createGain();
      nodes.push(src, gain);
      src.buffer = sequence.media.get(clip.sourceId).audio.buffer;
      src.playbackRate.value = clip.speed;
      src.connect(gain); gain.connect(oc.destination);
      const duration = clip.duration;
      const fadeIn = Math.min(duration, Math.max(0, clip.fadeIn || 0));
      const fadeOut = Math.min(duration, Math.max(0, clip.fadeOut || 0));
      const opacity = t => Math.max(0, Math.min(1, fadeIn ? t / fadeIn : 1, fadeOut ? (duration - t) / fadeOut : 1));
      // Include the intersection when fades overlap, keeping the audio envelope
      // identical to the visual minimum of fade-in and fade-out opacity.
      const points = [0, duration, fadeIn, duration - fadeOut];
      if (fadeIn + fadeOut > duration) points.push(duration * fadeIn / (fadeIn + fadeOut));
      const times = [...new Set(points)].filter(t => t >= 0 && t <= duration).sort((a, b) => a - b);
      gain.gain.setValueAtTime(clip.volume * opacity(0), clip.start);
      for (const t of times) if (t > 0) gain.gain.linearRampToValueAtTime(clip.volume * opacity(t), clip.start + t);
      src.start(clip.start, clip.in, clip.out - clip.in);
      src.stop(clip.end);
    }
    const buffer = await abortable(oc.startRendering(), signal);
    checkExport(signal);
    return { buffer, duration: timeline.duration, name: '編集した動画音声' };
  } finally {
    for (const node of nodes) { try { node.disconnect(); } catch (e) {} }
  }
};

/* ---------- MP4 ---------- */
J.exportMP4 = async ({ plan, project, audio, video, sequence, overlays, quality = 'high', onProgress, signal }) => {
  checkExport(signal);
  validateSequence(sequence);
  validateOverlays(overlays, project);
  const [w, h] = J.outputSize(project);
  const fps = plan.fps;
  const px = w * h * fps;
  const bitrate = Math.round(px * (quality === 'max' ? 0.42 : quality === 'high' ? 0.28 : 0.16));
  const vc = await J.pickVideoCodec(w, h, fps, bitrate);
  checkExport(signal);
  if (!vc) throw new Error('このブラウザは動画エンコード（WebCodecs）に対応していません。Chrome か Edge の最新版で開いてください。');
  if (sequence) {
    const source = J.videoSettings(project.video).audioSource;
    if (source === 'mute' || project.includeAudio === false) audio = null;
    else if (source === 'video') {
      onProgress && onProgress(0, '編集した音声を準備中');
      audio = await J.renderSequenceAudio(sequence, { signal });
    }
  }
  let ac = null;
  if (audio && audio.buffer && project.includeAudio !== false) {
    ac = await J.pickAudioCodec(48000, Math.min(2, audio.buffer.numberOfChannels));
    checkExport(signal);
    if (!ac || typeof AudioData === 'undefined') throw new Error('このブラウザでは音声付きMP4を書き出せません。Chrome / Edge で開くか、「音声を含める」をオフにしてください。');
  }
  const target = new Mp4Muxer.ArrayBufferTarget();
  const muxOpts = { target, video: { codec: vc.mux, width: w, height: h, frameRate: fps }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' };
  if (ac) muxOpts.audio = { codec: ac.mux, numberOfChannels: Math.min(2, audio.buffer.numberOfChannels), sampleRate: ac.sr };
  const muxer = new Mp4Muxer.Muxer(muxOpts);
  let err = null, venc = null, aenc = null, exportVideo = null;
  const frames = sequence ? sequenceFrames(sequence, signal) : null;
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('書き出し用の描画領域を作成できませんでした。');
  const R = new J.Renderer();
  const total = Math.max(1, Math.round(plan.duration * fps));
  const scale = w / plan.W;
  const prevRes = J.glyphs.maxRes; J.glyphs.maxRes = h >= 1000 ? 768 : 512;
  try {
    // A separate decoder prevents export seeks from disturbing the preview.
    if (video && !sequence) exportVideo = await J.loadVideo(video.file, { signal });
    checkExport(signal);
    venc = new VideoEncoder({
      output: (chunk, meta) => { try { muxer.addVideoChunk(chunk, meta); } catch (e) { err = e; } },
      error: e => { err = e; }
    });
    venc.configure(Object.assign({}, vc.cfg, { latencyMode: 'quality' }));
    const videoShare = ac ? 0.9 : 0.99;
    for (let i = 0; i < total; i++) {
      checkExport(signal, err);
      const frame = frames ? await frames.at(i / fps) : { video: exportVideo, clip: null };
      if (exportVideo) await J.seekVideo(exportVideo.element, i / fps, signal);
      checkExport(signal, err);
      renderExport(R, ctx, plan, i / fps, scale, frame.video, project.video, false, frame.clip, overlays);
      const vf = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
      try { venc.encode(vf, { keyFrame: i % Math.max(1, Math.round(fps * 2)) === 0 }); }
      finally { vf.close(); }
      await drainEncoder(venc, 4, signal, () => err);
      if (i % 3 === 0) {
        onProgress && onProgress((i + 1) / total * videoShare, `フレーム ${i + 1}/${total}`);
        await abortable(new Promise(resolve => setTimeout(resolve, 0)), signal);
      }
    }
    await abortable(venc.flush(), signal);
    checkExport(signal, err);
    closeEncoder(venc);
    if (ac) {
      onProgress && onProgress(0.9, '音声を準備中');
      const rs = await abortable(resample(audio.buffer, ac.sr, plan.duration), signal);
      checkExport(signal, err);
      const chn = rs.numberOfChannels;
      aenc = new AudioEncoder({
        output: (chunk, meta) => { try { muxer.addAudioChunk(chunk, meta); } catch (e) { err = e; } },
        error: e => { err = e; }
      });
      aenc.configure({ codec: ac.codec, sampleRate: ac.sr, numberOfChannels: chn, bitrate: 192000 });
      const frames = rs.length, block = 4800;
      for (let off = 0; off < frames; off += block) {
        checkExport(signal, err);
        const n = Math.min(block, frames - off);
        const data = new Float32Array(n * chn);
        for (let c = 0; c < chn; c++) data.set(rs.getChannelData(c).subarray(off, off + n), c * n);
        const ad = new AudioData({ format: 'f32-planar', sampleRate: ac.sr, numberOfFrames: n, numberOfChannels: chn, timestamp: Math.round(off * 1e6 / ac.sr), data });
        try { aenc.encode(ad); } finally { ad.close(); }
        await drainEncoder(aenc, 16, signal, () => err);
        if (off % (block * 8) === 0) {
          onProgress && onProgress(0.9 + (off + n) / frames * 0.09, '音声をエンコード中');
          await abortable(new Promise(resolve => setTimeout(resolve, 0)), signal);
        }
      }
      await abortable(aenc.flush(), signal);
      checkExport(signal, err);
      closeEncoder(aenc);
    }
    checkExport(signal, err);
    muxer.finalize();
    onProgress && onProgress(1, '完了');
    return { blob: new Blob([target.buffer], { type: 'video/mp4' }), codec: vc.label, audio: ac ? ac.mux : null, width: w, height: h };
  } finally {
    closeEncoder(venc); closeEncoder(aenc);
    if (exportVideo) J.releaseVideo(exportVideo);
    if (frames) frames.release();
    J.glyphs.maxRes = prevRes;
    canvas.width = 0; canvas.height = 0;
  }
};

/* ---------- PNG sequence as ZIP (store, no compression) ---------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
class ZipWriter {
  constructor() { this.parts = []; this.central = []; this.offset = 0; }
  add(name, u8) {
    const nb = new TextEncoder().encode(name), crc = crc32(u8);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true); lh.setUint32(14, crc, true); lh.setUint32(18, u8.length, true); lh.setUint32(22, u8.length, true);
    lh.setUint16(26, nb.length, true); lh.setUint16(28, 0, true);
    this.parts.push(lh.buffer, nb, u8);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, 0, true); ch.setUint16(14, 0x21, true); ch.setUint32(16, crc, true); ch.setUint32(20, u8.length, true); ch.setUint32(24, u8.length, true);
    ch.setUint16(28, nb.length, true); ch.setUint32(42, this.offset, true);
    this.central.push(ch.buffer, nb);
    this.offset += 30 + nb.length + u8.length;
  }
  finish() {
    const cdSize = this.central.reduce((s, p) => s + (p.byteLength ?? p.length), 0);
    const n = this.central.length / 2;
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, n, true); end.setUint16(10, n, true); end.setUint32(12, cdSize, true); end.setUint32(16, this.offset, true);
    return new Blob([...this.parts, ...this.central, end.buffer], { type: 'application/zip' });
  }
}
J.exportPNGZip = async ({ plan, project, video, sequence, overlays, transparent, onProgress, signal, every = 1 }) => {
  checkExport(signal);
  validateSequence(sequence);
  validateOverlays(overlays, project);
  const [w, h] = J.outputSize(project);
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('書き出し用の描画領域を作成できませんでした。');
  const R = new J.Renderer();
  const fps = plan.fps, total = Math.max(1, Math.round(plan.duration * fps));
  const zip = new ZipWriter();
  const scale = w / plan.W;
  const step = Math.max(1, Math.floor(Number(every) || 1));
  let exportVideo = null;
  const frames = sequence ? sequenceFrames(sequence, signal, transparent) : null;
  const prevRes = J.glyphs.maxRes; J.glyphs.maxRes = h >= 1000 ? 768 : 512;
  try {
    // Transparent sequences are an overlay asset: never include the MV pixels.
    if (video && !transparent && !sequence) exportVideo = await J.loadVideo(video.file, { signal });
    for (let i = 0; i < total; i += step) {
      checkExport(signal);
      const frame = frames ? await frames.at(i / fps) : { video: exportVideo || (transparent ? video : null), clip: null };
      if (exportVideo) await J.seekVideo(exportVideo.element, i / fps, signal);
      checkExport(signal);
      renderExport(R, ctx, plan, i / fps, scale, frame.video, project.video, transparent, frame.clip, overlays);
      const blob = await abortable(new Promise(resolve => canvas.toBlob(resolve, 'image/png')), signal);
      if (!blob) throw new Error('PNG画像を作成できませんでした。出力解像度を下げて再試行してください。');
      const bytes = await abortable(blob.arrayBuffer(), signal);
      checkExport(signal);
      zip.add(`jizura_${String(i).padStart(5, '0')}.png`, new Uint8Array(bytes));
      onProgress && onProgress((i + 1) / total, `PNG ${i + 1}/${total}`);
    }
    checkExport(signal);
    onProgress && onProgress(1, '完了');
    return zip.finish();
  } finally {
    if (exportVideo) J.releaseVideo(exportVideo);
    if (frames) frames.release();
    J.glyphs.maxRes = prevRes;
    canvas.width = 0; canvas.height = 0;
  }
};

/* ---------- plan JSON for the After Effects panel ---------- */
/* The After Effects panel implements the original expression set. Newer pack entries are exported as their
   closest original counterpart (the browser key is kept in web* fields so nothing is lost). */
J.AE_MAP = {
  layout: { lowerThird: 'center', corners: 'mixed', staircase: 'mixed', zigzag: 'wave', arcTop: 'ring', spiral: 'ring', gridCells: 'labels', dropCap: 'mixed', justified: 'tile', frameBox: 'center', bubble: 'pill', subtitleBar: 'center', ticker: 'marquee', splitScreen: 'diag', mirror: 'stack', sideways: 'vcols', edgeFrame: 'marquee', perspective: 'stack', hanko: 'vcols', genkou: 'vcols', panels: 'diag', filmstrip: 'labels', quote: 'center', ruler: 'gloss', searchBar: 'type', chat: 'labels', notification: 'pill', ticket: 'pill',
    rain: 'tile', hanging: 'scatter', orbit: 'ring', tunnel: 'tile', wordCloud: 'scatter', bounceLine: 'mixed', elastic: 'condensed', crossBands: 'diag', stickerBomb: 'labels', neon: 'center', keycaps: 'labels', bubbles: 'scatter', slotMachine: 'labels', flipBoard: 'labels', credits: 'type', zoomRepeat: 'stack', splitHalves: 'stack', columnsBig: 'vcols', circleWords: 'ring', dotMatrix: 'type', depthStack: 'stack', typeSpecimen: 'stack', kanjiFocus: 'huge', halfVertical: 'vcols', curtain: 'center', equalizer: 'mixed', tape: 'diag' },
  enter: { riseMask: 'drop', dropMask: 'drop', slideL: 'wipe', slideR: 'wipe', slideWhole: 'stretch', flipX: 'spin', flipY: 'spin', domino: 'spin', fold: 'pop', unroll: 'wipe', strokeDraw: 'assemble', outlineFill: 'blur', splitJoin: 'slice', vSlice: 'slice', shutter: 'wipe', iris: 'zoom', diagWipe: 'wipe', blinds: 'slice', checker: 'flicker', randomOrder: 'flicker', bounceBig: 'drop', squashDrop: 'drop', rubber: 'stretch', glitchIn: 'scramble', echoIn: 'zoom', whip: 'stretch', skewIn: 'stretch', trackIn: 'blur', trackOut: 'blur', blurStagger: 'blur', fadeStagger: 'blur', waveIn: 'pop', spiralIn: 'spin', zoomOut: 'zoom', resolve: 'scramble', magnet: 'assemble', inkBleed: 'blur', neonOn: 'flicker', cursorSweep: 'type', stamp: 'zoom' },
  exit: { sinkMask: 'fall', riseOut: 'drift', slideOutL: 'stretch', slideOutR: 'stretch', flipOutX: 'shrink', flipOutY: 'fall', foldOut: 'shrink', squash: 'shrink', trackOutWide: 'blur', collapse: 'shrink', zoomThrough: 'blur', zoomFar: 'shrink', spinOut: 'scatter', twist: 'shrink', waveOut: 'scatter', blurOutStagger: 'blur', undraw: 'blur', outlineOut: 'blur', irisClose: 'shrink', diagWipeOut: 'wipe', blindsClose: 'slice', checkerOut: 'glitch', splitApart: 'slice', vSliceDrop: 'fall', melt: 'fall', dissolve: 'drift', backspace: 'wipe', scrambleOut: 'glitch', glitchDissolve: 'glitch', echoOut: 'blur', whipOut: 'stretch', gravity: 'fall', popOut: 'scatter', burn: 'drift', sweepCover: 'wipe', shatterLite: 'explode' },
  hold: { float: 'drift', sway: 'wave', pulse: 'breathe', shimmer: 'still', colorRun: 'still', rotateSlow: 'drift', trackBreathe: 'breathe', skewWobble: 'wave', beatHop: 'wave', hWave: 'wave', heartbeat: 'breathe', orbitSmall: 'jitter', jelly: 'breathe', scanBand: 'glitchtick', noiseDrift: 'drift', tilt: 'drift', zoomSlow: 'drift', stretchPulse: 'breathe', glitchJump: 'glitchtick', echoTrail: 'drift' },
  decor: { crosshair: 'brackets', cropMarks: 'brackets', reticle: 'rings', radar: 'rings', progressRing: 'rings', timecodeBar: 'barcode', rulerEdge: 'grid', dimension: 'leaders', indexNum: 'counter', dateStamp: 'barcode', qrBlock: 'barcode', glitchRects: 'bars', concentricSquares: 'shapes', triangleSpin: 'shapes', lineBurst: 'sparks', plusGrid: 'grid', guides: 'grid', waveLine: 'waveform', spiralLine: 'rings', halftonePatch: 'shapes', checkerStrip: 'stripes', beatRing: 'rings', orbitDots: 'dots', constellation: 'sparks', confetti: 'shapes', petals: 'shapes', rainStreaks: 'slash', snow: 'dots', lightLeak: 'blobs', bokeh: 'blobs', speedCorner: 'slash', risingParticles: 'sparks', twinkle: 'sparks', brushStroke: 'bars', tapePieces: 'bars', scribbleCircle: 'rings', scribbleUnder: 'slash', crossOut: 'slash', highlightMark: 'bars', heartsStars: 'shapes', watermarkKanji: 'counter', verticalStrip: 'leaders', romajiLine: 'leaders', bracketsJP: 'brackets', seal: 'shapes' },
  fx: { rgbSplit: 'chroma', smear: 'slice', vhsRoll: 'slice', trackingNoise: 'slice', waveWarp: 'slice', pixelDrift: 'slice', tileShift: 'block', gridRepeat: 'block', mirrorFlash: 'block', strobe: 'invert', blackFrame: 'invert', whiteFrame: 'flash', filmBurn: 'flash', lightSweep: 'flash', panelWipe: 'flash', zoomPunch: 'zoom', whipBlur: 'zoom', posterize: 'mosaic', hueShift: 'chroma', irisTrans: 'zoom', doors: 'slice', blindsTrans: 'slice', splitSlide: 'slice', crtOff: 'flash' },
};
// The plan goes to the After Effects panel as-is (version 2): the panel builds every key it implements and
// picks the closest counterpart itself (from the exported metadata / J.AE_MAP) for anything it lacks.
J.planForAE = (plan, project) => {
  const clean = JSON.parse(JSON.stringify(plan, (k, v) => (k === 'energy' || k === 'buffer' || k === 'peaks' ? undefined : v)));
  clean.version = 2;
  clean.width = J.outputSize(project)[0]; clean.height = J.outputSize(project)[1];
  clean.extra = project.extra === true; clean.wa = project.wa !== false;
  clean.fonts = {};
  for (const [role, keys] of Object.entries(plan.style.fonts)) clean.fonts[role] = keys.map(k => J.FONTS[k] ? J.FONTS[k].label : k);
  clean.fontTable = Object.fromEntries(Object.entries(J.FONTS).map(([k, f]) => [k, { label: f.label, family: f.family.replace(/"/g, ''), weight: f.weight, kind: f.kind }]));
  // lyric language: the face each key is drawn with in the browser for this plan (the panel maps keys → AE fonts per language)
  clean.lang = plan.lang || 'ja';
  if (J.setLang && J.faceOf && clean.lang !== 'ja') {
    J.setLang(clean.lang);
    for (const k of Object.keys(clean.fontTable)) { const f = J.faceOf(k); clean.fontTable[k].langFamily = f.family.replace(/"/g, ''); clean.fontTable[k].langWeight = f.weight; }
  }
  return clean;
};
})();
