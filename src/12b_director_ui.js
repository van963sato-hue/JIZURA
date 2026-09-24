/* ============================================================
   JIZURA — MV director UI: local production ledger and GPT exchange
   ============================================================ */
(() => {
'use strict';
if (!document.getElementById('directorPanel')) return;
const $ = id => document.getElementById(id);
const copy = value => JSON.parse(JSON.stringify(value));
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sec = value => Number(Number(value).toFixed(3));
const stamp = value => J.fmtTime ? J.fmtTime(value) : sec(value) + 's';
let S, api, busy = false, task = null, generation = 0, formModel = null, cardKey = '', timingKey = '', timingInvalid = false;
let previewContext = null, previewSource = null;
const storyboards = new Map(), unassigned = new Map();
const model = () => S?.project?.director || null;
const blocked = () => !!(busy || S?.exporting || S?.videoLoading || S?.audioLoading || S?.imageLoading);
function notice(message, error = false) {
  $('directorNotice').textContent = message || '';
  $('directorNotice').hidden = !message;
  $('directorNotice').classList.toggle('error', error);
}
function save() { api.flushSave(); }
function download(name, content, type = 'text/plain;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1500);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch (error) {
    const area = document.createElement('textarea'); area.value = text; area.style.cssText = 'position:fixed;left:-9999px;top:0'; document.body.appendChild(area); area.select();
    const copied = document.execCommand('copy'); area.remove();
    if (!copied) throw new Error('コピーできませんでした。「制作パックを保存」を使ってください。');
  }
  notice('コピーしました。GPTまたは動画生成画面に貼り付けてください。');
}
function songMatches() {
  const m = model(), a = S.audio;
  return !!(m && a?.buffer && a.name === m.song.name && Math.abs(a.duration - m.song.duration) <= 0.05 && (!m.song.size || !a.size || m.song.size === a.size));
}
function state() {
  const m = model();
  if (!m) return { errors: [] };
  const errors = [], missing = m.segments.filter(s => !s.sourceId || !S.media.has(s.sourceId));
  const short = m.segments.filter(s => s.sourceId && S.media.has(s.sourceId) && S.media.get(s.sourceId).duration + 1e-6 < s.end - s.start);
  const estimated = m.lyrics.filter(row => row.timing === 'estimated').length;
  if (!songMatches()) errors.push('制作台帳と同じ元の曲を読み込んでください');
  if (estimated) errors.push('歌詞の仮時刻：' + estimated + '行');
  if (timingInvalid) errors.push('歌詞時刻の入力に未反映の修正があります');
  if (missing.length) errors.push('動画の未読み込み：' + missing.length + '本');
  if (short.length) errors.push('長さが足りない動画：' + short.map(s => s.id).join('、'));
  return { errors, missing, short, estimated };
}
function renderStatus() {
  const m = model();
  $('directorSong').textContent = S.audio ? S.audio.name + ' · ' + stamp(S.audio.duration) : '左の「歌詞」と、読み込んだ曲を使います';
  $('directorDraft').disabled = blocked() || !S.audio;
  for (const input of [$('directorAudio'), $('directorVideos'), $('directorImport')]) input.disabled = blocked();
  for (const id of ['directorImportText', 'directorCopyPack', 'directorDownloadPack', 'directorSaveJSON', 'directorConfirmAll']) $(id).disabled = blocked() || !m;
  if (!m) return;
  const status = state();
  $('directorTimingSummary').textContent = status.estimated ? '仮時刻 ' + status.estimated + '行' : '時刻の確認済み';
  $('directorAssemble').disabled = blocked() || status.errors.length > 0;
  $('directorReadiness').textContent = status.errors.length ? status.errors.join(' ／ ') : '素材と歌詞時刻がそろいました。元の曲に合わせて ' + m.segments.length + '本をつなげます。';
  $('directorRestore').hidden = !S.directorAssemblyBackup;
  $('directorRestore').disabled = blocked();
  $('directorConfirmAll').checked = !status.estimated && !timingInvalid;
  for (const input of $('directorSegments').querySelectorAll('input,button,select')) input.disabled = blocked();
}
function renderTiming(force = false) {
  const m = model(), key = JSON.stringify(m.lyrics);
  if (!force && key === timingKey) return;
  timingKey = key; timingInvalid = false;
  $('directorTiming').innerHTML = m.lyrics.map(row => '<tr data-lyric-id="' + esc(row.id) + '"><td><button type="button" class="ghost director-listen" data-listen="' + esc(row.id) + '" title="この行の開始から曲を聴く" aria-label="' + esc(row.text + 'を試聴') + '">▶</button>' + esc(row.text) + '</td><td><input type="number" data-time="start" step="0.001" min="0" max="' + m.song.duration + '" value="' + row.start + '" aria-label="' + esc(row.id) + ' 開始秒"></td><td><input type="number" data-time="end" step="0.001" min="0" max="' + m.song.duration + '" value="' + row.end + '" aria-label="' + esc(row.id) + ' 終了秒"></td><td><input type="checkbox" data-confirm="true" ' + (row.timing !== 'estimated' ? 'checked' : '') + ' aria-label="' + esc(row.id) + ' 時刻を確認済みにする"></td></tr>').join('');
}
function collectTimingRows(confirmAll = false) {
  const next = copy(model());
  for (const [i, tr] of Array.from($('directorTiming').children).entries()) {
    const start = tr.querySelector('[data-time=start]'), end = tr.querySelector('[data-time=end]');
    next.lyrics[i].start = start.value.trim() === '' ? NaN : Number(start.value);
    next.lyrics[i].end = end.value.trim() === '' ? NaN : Number(end.value);
    next.lyrics[i].timing = confirmAll || tr.querySelector('[data-confirm]').checked ? 'confirmed' : 'estimated';
  }
  if (!J.directorNormalize(next)) throw new Error('歌詞時刻を確認してください。開始より終了を後にし、曲の範囲内で前後の行と重ならないようにしてください。');
  return confirmAll ? J.directorConfirmTimings(next) : next;
}
function applyTimings(confirmAll = false) {
  if (blocked() || !model()) return false;
  try {
    S.project.director = collectTimingRows(confirmAll); timingInvalid = false;
    timingKey = JSON.stringify(model().lyrics); formModel = model();
    if (confirmAll) renderTiming(true);
    save(); renderStatus(); notice(confirmAll ? '全行の歌詞時刻を確認済みにしました。' : '歌詞時刻を反映しました。'); return true;
  } catch (error) { timingInvalid = true; renderStatus(); notice(error.message, true); return false; }
}
function framePanelMarkup(m, segment, panel) {
  let link = '', warning = '';
  if (panel.scene && J.directorFramePanel) {
    try {
      const frame = J.directorFramePanel(m, segment, panel);
      const url = new URL(frame.review_url);
      if (url.protocol === 'https:') link = '<a class="director-frame" href="' + esc(url.href) + '" target="_blank" rel="noopener noreferrer">FRAMEで構図を調整 ↗</a>';
      if (frame.warnings?.length) warning = '<p class="muted">' + esc(frame.warnings.join(' / ')) + '</p>';
    } catch (error) { warning = '<p class="muted">' + esc(error.message) + '</p>'; }
  }
  return '<div class="director-shot"><b>' + panel.index + ' · ' + sec(panel.start - segment.start) + '–' + sec(panel.end - segment.start) + 's</b><p>' + esc(panel.scene || 'GPTからの演出案を待っています') + '</p>' + link + warning + '</div>';
}
function renderSegments(force = false) {
  const m = model(), key = JSON.stringify(m.segments) + '|' + Array.from(S.media.keys()).join(',') + '|' + Array.from(storyboards.keys()).join(',');
  if (!force && key === cardKey) return;
  const opened = new Set(Array.from($('directorSegments').querySelectorAll('details[open]')).map(el => el.dataset.detail));
  cardKey = key;
  $('directorSegments').innerHTML = m.segments.map(segment => {
    const media = segment.sourceId && S.media.get(segment.sourceId), image = storyboards.get(segment.id), short = media && media.duration + 1e-6 < segment.end - segment.start;
    const fileText = media ? media.name + ' · ' + stamp(media.duration) + (short ? '（必要な長さが足りません）' : '') : segment.videoSource ? segment.videoSource.name + '（再読み込みが必要）' : '生成した10秒動画を割り当ててください';
    const populated = segment.panels.every(panel => panel.scene.trim());
    let previewPrompt = '';
    if (populated) { try { previewPrompt = videoPrompt(segment, m); } catch (error) { previewPrompt = error.message; } }
    const prompts = populated ? '<div class="row"><button type="button" data-action="copy-storyboard">文字なし絵コンテの指示をコピー</button><button type="button" data-action="copy-video">H3動画プロンプトをコピー</button></div><details data-detail="' + segment.id + '-prompt" ' + (opened.has(segment.id + '-prompt') ? 'open' : '') + '><summary>動画プロンプトを見る</summary><pre class="director-prompt">' + esc(previewPrompt) + '</pre></details>' : '<p class="hint">GPTの制作データを読み込むと、9コマの指示と動画プロンプトを確認できます。</p>';
    return '<article class="director-segment" data-segment-id="' + segment.id + '"><div class="director-segment-head"><h3>' + segment.id + ' <span class="muted">' + stamp(segment.start) + ' → ' + stamp(segment.end) + '</span></h3><span class="director-status">' + (media && !short ? '動画あり' : '動画待ち') + '</span></div><div class="director-segment-body"><p class="director-summary">' + esc(segment.summary || '音楽と歌詞から、この10秒の物語をGPTに設計してもらいます。') + '</p>' + (segment.continuity ? '<p class="director-continuity">' + esc(segment.continuity) + '</p>' : '') + '<details data-detail="' + segment.id + '-panels" ' + (opened.has(segment.id + '-panels') ? 'open' : '') + '><summary>3×3の9カット · FRAMEの構図</summary><div class="director-panels">' + segment.panels.map(panel => framePanelMarkup(m, segment, panel)).join('') + '</div></details>' + prompts + (image ? '<img class="director-preview" src="' + esc(image.url) + '" alt="' + segment.id + ' 3×3絵コンテ">' : '') + '<div class="row"><label class="file">絵コンテ画像を選ぶ<input type="file" data-action="storyboard" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"></label>' + (image ? '<button type="button" data-action="first-frame">先頭コマを開始画像として保存</button>' : '') + '</div>' + (segment.storyboardSource ? '<p class="director-file-name ' + (image ? 'ready' : 'missing') + '">' + esc(segment.storyboardSource.name) + (image ? '' : '（画像は選び直してください）') + '</p>' : '') + '<div class="row"><label class="file">' + segment.id + ' の動画を選ぶ<input type="file" data-action="video" accept="video/*,.mp4,.webm,.mov,.m4v"></label>' + (segment.sourceId ? '<button type="button" class="ghost" data-action="unmap">割り当てを外す</button>' : '') + '</div><p class="director-file-name ' + (media && !short ? 'ready' : 'missing') + '">' + esc(fileText) + '</p></div></article>';
  }).join('');
}
function videoPrompt(segment, m) {
  // Always keep the full-frame/no-text/ten-second constraints, including when GPT supplies prose.
  const base = J.directorVideoPrompt(segment.videoPrompt ? { ...segment, panels: [] } : segment, m);
  const output = segment.videoPrompt ? base + '\n\nDirector\'s scene instructions:\n' + segment.videoPrompt : base;
  if (output.length > 7000) throw new Error('H3動画プロンプトが7000文字を超えています。キャラクター設定を保ちながら、演出指示を短くして読み込み直してください。');
  return output;
}
function storyboardPrompt(segment, m) {
  const base = J.directorStoryboardPrompt(segment, m);
  return segment.storyboardPrompt ? base + '\n\nDirector\'s visual detail (retain the format and no-text rules above):\n' + segment.storyboardPrompt : base;
}
function renderUnassigned() {
  $('directorUnmapped').hidden = !unassigned.size || !model();
  if (!model()) return;
  $('directorUnmapped').innerHTML = '<p class="hint">番号に一致しない動画は、使うシーンを選んで割り当てます。</p>' + Array.from(unassigned, ([id, media]) => '<div class="director-unmapped-row" data-pending-id="' + esc(id) + '"><span>' + esc(media.name) + ' · ' + stamp(media.duration) + '</span><select aria-label="動画を割り当てるシーン">' + model().segments.map(s => '<option value="' + s.id + '">' + s.id + (s.sourceId && S.media.has(s.sourceId) ? ' · 割り当て済み' : '') + '</option>').join('') + '</select><button type="button" data-assign="true">割り当てる</button><button type="button" class="ghost" data-discard="true">外す</button></div>').join('');
}
function render() {
  if (!S?.project) return;
  const m = model(); $('directorWorkspace').hidden = !m;
  if (m) {
    if (formModel !== m) {
      for (const [id, key] of [['directorConcept', 'concept'], ['directorIdentity', 'identity'], ['directorStyle', 'style']]) if (document.activeElement !== $(id)) $(id).value = m[key] || '';
      formModel = m;
    }
    $('directorAnalysis').textContent = stamp(m.song.duration) + ' · ' + m.segments.length + '本の動画 / ' + m.segments.length + '枚の絵コンテ · ' + (m.song.analysis.tempo === 'manual' ? '指定テンポ ' : '推定テンポ 約') + sec(m.song.bpm) + ' BPM';
    renderTiming(); renderSegments(); renderUnassigned();
  }
  renderStatus();
}
function stopPreview() {
  if (previewSource) { try { previewSource.stop(); } catch (error) {} previewSource.disconnect(); previewSource = null; }
}
async function previewLyric(id) {
  if (!songMatches()) throw new Error('制作台帳と同じ元の曲を読み込んでください。');
  const row = model().lyrics.find(row => row.id === id), tr = Array.from($('directorTiming').children).find(tr => tr.dataset.lyricId === id);
  const begin = tr ? Number(tr.querySelector('[data-time=start]').value) : row.start;
  if (!(begin >= 0 && begin < S.audio.duration)) throw new Error('試聴の開始時刻を確認してください。');
  api.pause(); stopPreview(); previewContext ||= new (window.AudioContext || window.webkitAudioContext)(); await previewContext.resume();
  const source = previewContext.createBufferSource(); source.buffer = S.audio.buffer; source.connect(previewContext.destination); source.start(0, Math.max(0, begin - 0.3), Math.min(12, S.audio.duration - Math.max(0, begin - 0.3))); previewSource = source;
  source.onended = () => { if (previewSource === source) previewSource = null; source.disconnect(); };
}
function draft() {
  if (blocked()) return null;
  const m = J.directorDraft({ audio: S.audio, lyrics: $('lyrics').value, timing: S.project.timing, concept: $('directorConcept').value, identity: $('directorIdentity').value, style: $('directorStyle').value });
  reset(); S.project.director = m; api.pruneMedia?.(); $('directorPanel').open = true; save(); render(); notice('制作台帳を作りました。制作パックをGPTへ渡して、絵コンテと動画の演出を設計してください。'); return m;
}
function importModel(data) {
  if (blocked()) return null;
  if (!model()) throw new Error('先に曲から制作台帳を作ってください。');
  const m = J.directorImport(data, model());
  S.project.director = m; timingKey = ''; timingInvalid = false; save(); render(); notice('GPTの演出案を読み込みました。歌詞時刻と9コマの構図を確認してください。'); return m;
}
function metadata(id, media) { return { id, name: media.file.name, size: media.file.size, lastModified: media.file.lastModified, duration: media.duration, width: media.width, height: media.height }; }
function assignVideo(id, media, segmentId) {
  const segment = model().segments.find(segment => segment.id === segmentId);
  if (!segment) throw new Error('動画を割り当てるシーンが見つかりません。');
  S.media.set(id, media); segment.sourceId = id; segment.videoSource = metadata(id, media); unassigned.delete(id); api.pruneMedia?.(); save();
}
function matchSegment(file) {
  const refs = model().segments.filter(s => s.videoSource && (!s.sourceId || !S.media.has(s.sourceId)) && s.videoSource.name === file.name && s.videoSource.size === file.size);
  const exact = refs.filter(s => s.videoSource.lastModified === file.lastModified);
  if (exact.length === 1) return exact[0];
  if (refs.length === 1) return refs[0];
  const name = file.name.replace(/\.[^.]+$/, '').toUpperCase();
  return model().segments.find(s => s.id === name) || null;
}
async function loadVideos(files, segmentId) {
  if (blocked() || !model()) return 0;
  busy = true; task = new AbortController(); const currentTask = task, epoch = generation; renderStatus(); let loaded = 0;
  const errors = [];
  try {
    for (const file of Array.from(files || [])) {
      if (currentTask.signal.aborted) break;
      let media;
      try {
        media = await J.loadVideo(file, { signal: currentTask.signal });
        if (generation !== epoch || currentTask.signal.aborted) { J.releaseVideo(media); break; }
        const target = segmentId ? model().segments.find(s => s.id === segmentId) : matchSegment(file);
        const relink = target?.sourceId && !S.media.has(target.sourceId) && target.videoSource?.name === file.name && target.videoSource.size === file.size;
        const id = relink ? target.sourceId : J.newVideoId('director-source');
        if (target) assignVideo(id, media, target.id); else unassigned.set(id, media);
        loaded++;
      } catch (error) { if (error.name !== 'AbortError') errors.push(file.name + '：' + error.message); }
    }
  } finally {
    if (task === currentTask) {
      task = null; busy = false;
      if (loaded) { api.syncUI(); api.replan(); }
      render();
    }
  }
  if (generation === epoch) notice(errors.length ? errors.join('\n') : loaded + '本の動画を読み込みました。' + (unassigned.size ? '番号に一致しない動画はシーンを選んでください。' : ''), errors.length > 0);
  return loaded;
}
async function loadStoryboard(file, segmentId) {
  if (blocked() || !model()) return;
  busy = true; task = new AbortController(); const currentTask = task, epoch = generation; renderStatus();
  try {
    const image = await J.loadOverlayImage(file, { signal: currentTask.signal });
    if (generation !== epoch || currentTask.signal.aborted) { J.releaseOverlayImage(image); return; }
    const previous = storyboards.get(segmentId); if (previous) { URL.revokeObjectURL(previous.url); J.releaseOverlayImage(previous); }
    image.url = URL.createObjectURL(file); storyboards.set(segmentId, image);
    const segment = model().segments.find(s => s.id === segmentId);
    segment.storyboardSource = { name: file.name, size: file.size, lastModified: file.lastModified, width: image.width, height: image.height };
    save(); cardKey = ''; notice(Math.abs(image.width / image.height - 16 / 9) > 0.06 ? '画像を読み込みました。絵コンテ全体が16:9になるよう確認してください。' : '絵コンテ画像を読み込みました。');
  } finally { if (task === currentTask) { task = null; busy = false; render(); } }
}
async function firstFrame(id) {
  const image = storyboards.get(id); if (!image) return;
  const width = Math.floor(image.width / 3), height = Math.floor(image.height / 3), canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  canvas.getContext('2d').drawImage(image.element, 0, 0, width, height, 0, 0, width, height);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('開始画像を保存できませんでした。');
  download(id + '-first-frame.png', blob); notice('左上の1コマを保存しました。H3の開始画像に使う前に、コマの境界や余白を確認してください。');
}
function assemble() {
  if (blocked() || !model()) return false;
  const errors = state().errors;
  if (errors.length) throw new Error(errors.join(' ／ '));
  stopPreview();
  const m = copy(model()), result = J.directorAssemble(m, S.media);
  if (!api.applyDirectorAssembly) throw new Error('組み立て機能の準備ができていません。ページを再読み込みしてください。');
  api.applyDirectorAssembly(result, m); render(); notice('動画を番号順につなぎ、元の曲と歌詞を配置しました。プレビューで確認して、MP4を書き出してください。'); return true;
}
function reset() {
  generation++; task?.abort(); task = null; busy = false; stopPreview();
  for (const image of storyboards.values()) { URL.revokeObjectURL(image.url); J.releaseOverlayImage(image); }
  storyboards.clear(); for (const media of unassigned.values()) J.releaseVideo(media); unassigned.clear();
  formModel = null; timingKey = ''; cardKey = ''; timingInvalid = false;
  notice(''); $('directorJSON').value = '';
}
function run(action) { return Promise.resolve().then(action).catch(error => notice(error.message || String(error), true)); }
function boot() {
  S = J.ui; api = J.uiApi; if (!S || !api || !J.directorDraft) return;
  S.project.director = J.directorNormalize(S.project.director);
  $('directorDraft').addEventListener('click', () => run(draft));
  $('directorAudio').addEventListener('change', event => {
    const file = event.target.files[0]; event.target.value = ''; if (!file || blocked()) return;
    stopPreview(); run(async () => { const pending = api.loadAudioFile(file); renderStatus(); await pending; render(); });
  });
  for (const [id, key] of [['directorConcept', 'concept'], ['directorIdentity', 'identity'], ['directorStyle', 'style']]) $(id).addEventListener('change', () => {
    if (blocked() || !model()) return; model()[key] = $(id).value; cardKey = ''; save(); render();
  });
  $('directorCopyPack').addEventListener('click', () => run(() => copyText(J.directorPromptPack(model()))));
  $('directorDownloadPack').addEventListener('click', () => run(() => download('JIZURA-GPT-production-pack.txt', J.directorPromptPack(model()))));
  $('directorSaveJSON').addEventListener('click', () => run(() => download('JIZURA-MV-director.json', JSON.stringify(model(), null, 2), 'application/json')));
  $('directorImportText').addEventListener('click', () => run(() => importModel($('directorJSON').value)));
  $('directorImport').addEventListener('change', event => { const file = event.target.files[0]; event.target.value = ''; if (file) run(async () => { if (file.size > 8 * 1024 * 1024) throw new Error('制作データは8MB以下のJSONを選んでください。'); importModel(await file.text()); }); });
  $('directorConfirmAll').addEventListener('change', event => { if (event.target.checked) applyTimings(true); else { for (const checkbox of $('directorTiming').querySelectorAll('[data-confirm]')) checkbox.checked = false; applyTimings(); } });
  $('directorTiming').addEventListener('change', event => {
    if (event.target.matches('[data-time]')) event.target.closest('tr').querySelector('[data-confirm]').checked = false;
    if (event.target.matches('input')) applyTimings();
  });
  $('directorTiming').addEventListener('input', event => { if (event.target.matches('[data-time]')) { timingInvalid = true; $('directorConfirmAll').checked = false; renderStatus(); } });
  $('directorTiming').addEventListener('click', event => { const button = event.target.closest('[data-listen]'); if (button) run(() => previewLyric(button.dataset.listen)); });
  $('directorPreviewStop').addEventListener('click', stopPreview);
  $('btnPlay').addEventListener('click', stopPreview);
  $('directorVideos').addEventListener('change', event => { const files = Array.from(event.target.files); event.target.value = ''; run(() => loadVideos(files)); });
  $('directorSegments').addEventListener('change', event => {
    const input = event.target.closest('input[data-action]'); if (!input) return;
    const file = input.files[0], id = input.closest('[data-segment-id]').dataset.segmentId; input.value = ''; if (!file) return;
    run(() => input.dataset.action === 'video' ? loadVideos([file], id) : loadStoryboard(file, id));
  });
  $('directorSegments').addEventListener('click', event => {
    const button = event.target.closest('button[data-action]'); if (!button || blocked()) return;
    const id = button.closest('[data-segment-id]').dataset.segmentId, segment = model().segments.find(s => s.id === id);
    run(() => {
      if (button.dataset.action === 'copy-storyboard') return copyText(storyboardPrompt(segment, model()));
      if (button.dataset.action === 'copy-video') return copyText(videoPrompt(segment, model()));
      if (button.dataset.action === 'first-frame') return firstFrame(id);
      if (button.dataset.action === 'unmap') { segment.sourceId = null; segment.videoSource = null; api.pruneMedia?.(); save(); render(); }
    });
  });
  $('directorUnmapped').addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button || blocked()) return;
    const row = button.closest('[data-pending-id]'), id = row.dataset.pendingId, media = unassigned.get(id); if (!media) return;
    if (button.dataset.assign) assignVideo(id, media, row.querySelector('select').value);
    else { J.releaseVideo(media); unassigned.delete(id); }
    api.syncUI(); api.replan(); render();
  });
  $('directorAssemble').addEventListener('click', () => run(assemble));
  $('directorRestore').addEventListener('click', () => run(() => { if (!blocked()) { stopPreview(); api.restoreDirectorAssembly?.(); render(); notice('組み立て前の動画・曲の設定・歌詞に戻しました。'); } }));
  window.addEventListener('pagehide', stopPreview);
  J.directorUI = { render, reset, draft, importModel, loadVideos, loadStoryboard, assemble, applyTimings, state, stopPreview, loading: () => busy };
  render();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
