/* Image overlay editor; source files stay local and project JSON stores metadata. */
(() => {
'use strict';
const $ = id => document.getElementById(id);
if (!$('imageEditor')) return;
let S, api, past = [], future = [], dirty = false, formKey = '', listKey = '', pendingSeed = null;
const copy = value => JSON.parse(JSON.stringify(value));
const uid = () => 'image-' + (globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2));
const model = () => S.project.images;
const selected = () => model().layers.find(layer => layer.id === S.selectedImage);
const blocked = () => !!S.exporting || !!S.imageLoading;
const round = value => String(+Number(value).toFixed(4));
function missingSources() {
  if (!S?.project?.images) return [];
  const used = new Set(model().layers.map(layer => layer.sourceId));
  return model().sources.filter(source => used.has(source.id) && !S.images.has(source.id));
}
function snapshot() { return { images: copy(model()), selected: S.selectedImage, time: S.t }; }
function prune() {
  const keep = new Set(model().layers.map(layer => layer.sourceId));
  for (const state of [...past, ...future]) for (const layer of state.images.layers) keep.add(layer.sourceId);
  for (const [id, asset] of S.images) if (!keep.has(id)) { J.releaseOverlayImage(asset); S.images.delete(id); }
}
function restore(state) {
  api.pause();
  S.project.images = J.normalizeImageOverlays(state.images);
  S.selectedImage = state.selected;
  dirty = false; formKey = ''; listKey = ''; pendingSeed = null;
  prune(); api.replan(); api.seek(state.time || 0); render();
}
function change(next, id = S.selectedImage, time = S.t) {
  if (blocked()) return false;
  const images = J.normalizeImageOverlays(next);
  if (JSON.stringify(images) === JSON.stringify(model())) { dirty = false; formKey = ''; render(); return false; }
  past.push(snapshot()); if (past.length > 60) past.shift(); future = [];
  restore({ images, selected: id, time });
  return true;
}
function undo() {
  if (blocked() || !past.length) return false;
  future.push(snapshot()); restore(past.pop()); return true;
}
function redo() {
  if (blocked() || !future.length) return false;
  past.push(snapshot()); restore(future.pop()); return true;
}
function select(id) {
  const layer = model().layers.find(item => item.id === id);
  if (!layer || blocked()) return false;
  api.pause(); S.selectedImage = id;
  dirty = false; pendingSeed = null; formKey = ''; render();
  const previewTime = S.t >= layer.start && S.t < layer.end ? S.t : layer.start + Math.min((layer.end - layer.start) / 2, layer.inDur + .1);
  api.seek(previewTime); return true;
}
function applyPatch(id, patch) {
  if (blocked()) return false;
  const next = copy(model()), layer = next.layers.find(item => item.id === id);
  if (!layer) return false;
  Object.assign(layer, patch);
  return change(next, id);
}
function orderedLayers() {
  return [...model().layers.filter(layer => layer.plane === 'belowText'), ...model().layers.filter(layer => layer.plane === 'aboveText')];
}
function render() {
  if (!S?.project) return;
  if (!S.project.images) S.project.images = J.normalizeImageOverlays(null);
  if (!model().layers.some(layer => layer.id === S.selectedImage)) { S.selectedImage = model().layers[0]?.id || null; dirty = false; formKey = ''; }
  const layer = selected(), loading = !!S.imageLoading, locked = blocked();
  const sources = new Map(model().sources.map(source => [source.id, source]));
  const layers = orderedLayers();
  const key = JSON.stringify([model(), S.selectedImage, [...S.images.keys()], locked]);
  if (listKey !== key) {
    const strip = $('imageLayerList'), scroll = strip.scrollLeft; strip.replaceChildren();
    layers.forEach((item, index) => {
      const source = sources.get(item.sourceId), asset = S.images.get(item.sourceId);
      const button = document.createElement('button'); button.type = 'button'; button.dataset.imageId = item.id;
      button.setAttribute('aria-pressed', String(item.id === S.selectedImage)); button.disabled = locked;
      button.classList.toggle('missing', !asset);
      const thumb = document.createElement('span'); thumb.className = 'image-thumb'; thumb.setAttribute('aria-hidden', 'true');
      if (asset?.element) {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 88;
        const scale = Math.min(88 / asset.width, 88 / asset.height), width = asset.width * scale, height = asset.height * scale;
        canvas.getContext('2d').drawImage(asset.element, (88 - width) / 2, (88 - height) / 2, width, height); thumb.append(canvas);
      }
      else thumb.textContent = '?';
      const name = document.createElement('span'); name.className = 'image-layer-name'; name.textContent = source?.name || '画像';
      const order = document.createElement('span'); order.className = 'image-layer-order'; order.textContent = `${index + 1} · ${item.plane === 'aboveText' ? '文字の前' : '文字の後ろ'}`;
      const time = document.createElement('span'); time.className = 'image-layer-time'; time.textContent = `${item.start.toFixed(2)}–${item.end.toFixed(2)}s`;
      button.title = `${source?.name || ''} · ${time.textContent}`;
      button.append(thumb, name, order, time); button.addEventListener('click', () => select(item.id)); strip.append(button);
    });
    strip.scrollLeft = scroll; listKey = key;
  }
  $('imageSummary').textContent = model().layers.length ? `${model().layers.length}レイヤー` : '';
  $('imageLoadStatus').textContent = loading ? '画像を読み込み中…' : '透過PNGも使えます';
  $('imageFile').disabled = !!S.exporting;
  $('imageEmpty').hidden = !!model().layers.length;
  $('imageToolbar').hidden = !model().layers.length && !past.length && !future.length;
  $('imageControls').hidden = !layer;
  const missing = missingSources(), warnings = [];
  if (missing.length) warnings.push('画像を再読み込み: ' + missing.map(source => source.name).join(' / '));
  if (S.editTimeline?.clips.length && model().layers.some(item => item.end > S.editTimeline.duration + 1e-6)) warnings.push('動画の終了より後の画像は書き出されません。表示時刻を調整してください。');
  $('imageMissing').hidden = !warnings.length;
  $('imageMissing').textContent = warnings.join(' ');
  for (const element of $('imageControls').querySelectorAll('input,select,button')) element.disabled = locked || !layer;
  for (const id of ['imageDuplicate', 'imageDelete']) $(id).disabled = locked || !layer;
  const peers = layer ? model().layers.filter(item => item.plane === layer.plane) : [], peerIndex = peers.findIndex(item => item.id === layer?.id);
  $('imageBack').disabled = locked || peerIndex <= 0;
  $('imageFront').disabled = locked || peerIndex < 0 || peerIndex >= peers.length - 1;
  $('imageUndo').disabled = locked || !past.length; $('imageRedo').disabled = locked || !future.length;
  if (layer) {
    const source = sources.get(layer.sourceId);
    $('imageSelection').textContent = `${source?.name || '画像'} · ${source?.width || 0} × ${source?.height || 0}`;
    const nextKey = JSON.stringify(layer);
    if (formKey !== nextKey) {
      for (const [id, key] of [['imageStart', 'start'], ['imageEnd', 'end'], ['imageRotation', 'rotation'], ['imageInDur', 'inDur'], ['imageOutDur', 'outDur']]) $(id).value = round(layer[key]);
      for (const [id, key] of [['imageX', 'x'], ['imageY', 'y'], ['imageScale', 'scale']]) $(id).value = round(layer[key] * 100);
      for (const [id, key] of [['imageMode', 'mode'], ['imagePlane', 'plane'], ['imageEnter', 'enter'], ['imageHold', 'hold'], ['imageExit', 'exit']]) $(id).value = layer[key];
      $('imageTransparency').value = round((1 - layer.opacity) * 100);
      $('imageFlip').checked = layer.flip;
      dirty = false; pendingSeed = null; formKey = nextKey;
    }
  }
  $('imageTransparencyValue').textContent = $('imageTransparency').value + '%';
  $('imageDirty').hidden = !dirty;
}
function readForm() {
  const ids = ['imageStart', 'imageEnd', 'imageX', 'imageY', 'imageScale', 'imageRotation', 'imageInDur', 'imageOutDur', 'imageTransparency'];
  if (ids.some(id => !$(id).value.trim() || !Number.isFinite(Number($(id).value)))) throw new Error('画像の位置・大きさ・時刻は数値で指定してください。');
  const patch = {
    start: +$('imageStart').value, end: +$('imageEnd').value,
    x: +$('imageX').value / 100, y: +$('imageY').value / 100, scale: +$('imageScale').value / 100,
    rotation: +$('imageRotation').value, opacity: 1 - +$('imageTransparency').value / 100,
    inDur: +$('imageInDur').value, outDur: +$('imageOutDur').value,
    mode: $('imageMode').value, plane: $('imagePlane').value,
    enter: $('imageEnter').value, hold: $('imageHold').value, exit: $('imageExit').value, flip: $('imageFlip').checked,
  };
  if (patch.start < 0 || patch.end <= patch.start || patch.end - patch.start < .01) throw new Error('画像の終了は開始より0.01秒以上後にしてください。');
  if (patch.inDur < 0 || patch.outDur < 0 || patch.inDur + patch.outDur > patch.end - patch.start + 1e-6) throw new Error('登場と退場の秒数の合計を、画像の表示時間以内にしてください。');
  if (patch.x < -1 || patch.x > 2 || patch.y < -1 || patch.y > 2 || patch.scale < .01 || patch.scale > 4 || Math.abs(patch.rotation) > 360) throw new Error('位置は−100～200%、大きさは1～400%、回転は−360～360°で指定してください。');
  if (pendingSeed !== null) patch.seed = pendingSeed;
  return patch;
}
function applyForm() {
  const layer = selected(); if (!layer || blocked()) return false;
  try { return applyPatch(layer.id, readForm()); }
  catch (error) { api.toast(error.message); return false; }
}
function reorder(delta) {
  const layer = selected(); if (!layer || blocked()) return;
  const next = copy(model()), indices = next.layers.flatMap((item, index) => item.plane === layer.plane ? [index] : []);
  const index = indices.findIndex(i => next.layers[i].id === layer.id), target = index + delta;
  if (target < 0 || target >= indices.length) return;
  [next.layers[indices[index]], next.layers[indices[target]]] = [next.layers[indices[target]], next.layers[indices[index]]];
  change(next);
}
async function loadFiles(files) {
  if (S.exporting) return false;
  const selectedFiles = Array.from(files || []); if (!selectedFiles.length) return false;
  S.imageLoading?.abort();
  const task = new AbortController(); S.imageLoading = task;
  api.pause(); render();
  const next = copy(model()), assets = new Map(S.images), allocated = [], errors = [];
  let firstNew = null, connected = false, changed = false;
  try {
    for (const file of selectedFiles) {
      if (task.signal.aborted) break;
      try {
        const used = new Set(next.layers.map(layer => layer.sourceId));
        const missing = next.sources.filter(source => used.has(source.id) && !assets.has(source.id) && source.name === file.name && source.size === file.size);
        let source = missing.find(source => source.lastModified === file.lastModified) || (missing.length === 1 ? missing[0] : null);
        const reconnect = !!source;
        if (!source) source = next.sources.find(item => assets.has(item.id) && item.name === file.name && item.size === file.size && item.lastModified === file.lastModified);
        let asset = source && assets.get(source.id);
        if (!asset) { asset = await J.loadOverlayImage(file, { signal: task.signal }); allocated.push(asset); }
        if (task.signal.aborted) break;
        if (!source) {
          source = { id: uid(), name: file.name, size: file.size, lastModified: file.lastModified, width: asset.width, height: asset.height };
          next.sources.push(source);
        }
        Object.assign(source, { width: asset.width, height: asset.height });
        assets.set(source.id, asset); connected = true;
        if (!reconnect) {
          const start = Math.max(0, S.t), duration = Math.max(.01, (S.plan?.duration || start + 5) - start);
          const entrance = J.imageMotionOptions('enter'), exits = J.imageMotionOptions('exit');
          const id = uid();
          next.layers.push({ id, sourceId: source.id, start, end: start + duration, x: .5, y: .5, scale: .35, rotation: 0, opacity: 1, flip: false,
            enter: entrance.find(option => option.id === 'fadeStagger')?.id || entrance[0]?.id,
            hold: 'still', exit: exits.find(option => option.id === 'blur')?.id || exits[0]?.id,
            inDur: Math.min(.45, duration / 3), outDur: Math.min(.35, duration / 3), mode: 'whole', plane: 'belowText', seed: Math.floor(Math.random() * 2147483647) });
          firstNew ||= id; changed = true;
        }
      } catch (error) { if (!task.signal.aborted) errors.push(file.name + ': ' + error.message); }
    }
    if (task.signal.aborted || S.imageLoading !== task) return false;
    S.images = assets; S.imageLoading = null;
    if (changed) change(next, firstNew || S.selectedImage);
    else if (connected) { S.project.images = J.normalizeImageOverlays(next); listKey = ''; api.replan(); S.need = true; }
    if (firstNew) select(firstNew);
    if (errors.length) api.toast(errors.join(' / '));
    return connected;
  } finally {
    for (const asset of allocated) if (![...S.images.values()].includes(asset)) J.releaseOverlayImage(asset);
    if (S.imageLoading === task) S.imageLoading = null;
    render();
  }
}
function reset() {
  S.imageLoading?.abort(); S.imageLoading = null;
  for (const asset of S.images.values()) J.releaseOverlayImage(asset);
  S.images.clear(); S.selectedImage = null;
  past = []; future = []; dirty = false; formKey = ''; listKey = ''; pendingSeed = null;
}
function boot() {
  S = J.ui; api = J.uiApi;
  if (!S || !api || !J.normalizeImageOverlays) return;
  S.images ||= new Map(); S.imageLoading ||= null; S.selectedImage = null;
  S.project.images = J.normalizeImageOverlays(S.project.images);
  for (const [id, kind] of [['imageEnter', 'enter'], ['imageHold', 'hold'], ['imageExit', 'exit']]) {
    const select = $(id); select.replaceChildren();
    for (const option of J.imageMotionOptions(kind)) select.add(new Option(option.name, option.id));
  }
  const markDirty = () => { dirty = true; $('imageDirty').hidden = false; $('imageTransparencyValue').textContent = $('imageTransparency').value + '%'; };
  for (const element of $('imageControls').querySelectorAll('input,select')) { element.addEventListener('input', markDirty); element.addEventListener('change', markDirty); }
  $('imageFile').addEventListener('change', event => { const files = Array.from(event.target.files); event.target.value = ''; loadFiles(files).catch(error => api.toast(error.message)); });
  $('imageApply').addEventListener('click', applyForm);
  $('imageUndo').addEventListener('click', undo); $('imageRedo').addEventListener('click', redo);
  $('imageBack').addEventListener('click', () => reorder(-1)); $('imageFront').addEventListener('click', () => reorder(1));
  $('imageDuplicate').addEventListener('click', () => {
    const layer = selected(); if (!layer || blocked()) return;
    const next = copy(model()), index = next.layers.findIndex(item => item.id === layer.id), duplicate = { ...layer, id: uid() };
    next.layers.splice(index + 1, 0, duplicate); change(next, duplicate.id);
  });
  $('imageDelete').addEventListener('click', () => {
    const layer = selected(); if (!layer || blocked()) return;
    const next = copy(model()), index = next.layers.findIndex(item => item.id === layer.id); next.layers.splice(index, 1);
    change(next, next.layers[Math.min(index, next.layers.length - 1)]?.id || null);
  });
  $('imageSetStart').addEventListener('click', () => { $('imageStart').value = round(S.t); markDirty(); });
  $('imageSetEnd').addEventListener('click', () => { $('imageEnd').value = round(S.t); markDirty(); });
  $('imageReroll').addEventListener('click', () => { pendingSeed = Math.floor(Math.random() * 2147483647); markDirty(); });
  $('imageControls').addEventListener('keydown', event => { if (event.key === 'Enter' && event.target.tagName === 'INPUT') { event.preventDefault(); applyForm(); } });
  // Handle image history only when focus is in this editor; keep the video shortcuts elsewhere.
  $('imageEditor').addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z' || /INPUT|SELECT|TEXTAREA/.test(event.target.tagName)) return;
    event.preventDefault(); event.stopPropagation(); event.shiftKey ? redo() : undo();
  });
  J.imageUI = { render, reset, loadFiles, missingSources, select, applyPatch, undo, redo };
  Object.assign(api, { loadImageFiles: loadFiles, selectImageLayer: select, applyImageLayerPatch: applyPatch, imageUndo: undo, imageRedo: redo });
  render();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
