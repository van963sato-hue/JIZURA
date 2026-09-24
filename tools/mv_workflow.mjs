#!/usr/bin/env node
/* Local GPT host for the same JIZURA director, media decoder and MP4 exporter
 * used by index.html. No API keys, cloud upload, lyric auto-confirmation or
 * synthetic media are involved. See --help for the explicit file contract. */
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const HELP = `JIZURA local MV workflow

  node tools/mv_workflow.mjs analyze --audio /song.wav --lyrics /lyrics.lrc --out /director.json
  node tools/mv_workflow.mjs render --project /director.json --audio /song.wav --clips /clips.json --out /mv.mp4

analyze writes a validated director JSON and a sibling .gpt.txt production pack.
Plain lyrics receive provisional timings; they must be reviewed in JIZURA.
LRC timestamps remain marked lrc. Analysis estimates beats, not musical notation.
Optional analyze flags: --concept TEXT --identity TEXT --style TEXT

render accepts a director JSON or a saved JIZURA project containing director.
clips.json must map every exact segment ID to an absolute local path, e.g.
{"S001":"/videos/S001.mp4","S002":"/videos/S002.mp4"}.
The original song must match the draft. Provisional lyric timing, missing clips,
short clips and unlinked overlay images stop export. No timings are confirmed
by this tool. The final short segment is trimmed; clip sound is discarded.
A sibling .jizura.json is saved with the assembled edit for later adjustment.
Optional render flags: --res 720 --fps 24 (defaults to project export settings)
                       --font /fonts/JapaneseFont.ttf
The local font overrides all rendered text faces, including fixed layout/HUD
fonts. Supply a font that covers the lyric characters (.ttf/.otf/.woff/.woff2).
Only the font choice and file metadata are saved; font bytes are not embedded.
Re-supply the same font for another CLI render or upload it in the browser app.

Each 16:9 storyboard is 3 x 3 panels for one 10-second generated video.
This tool prepares prompts and renders supplied clips; GPT image generation and
MiniMax H3 generation run separately. It never calls a paid generation service.

Requirements: built index.html (python3 build.py), Node.js, Playwright, Chromium
with WebCodecs. Install Playwright locally or set CODEX_PRIMARY_RUNTIME_NODE_MODULES.
Set CHROMIUM_PATH to select Chromium; its normal Playwright installation is also
supported. All browser network requests outside the local app are blocked.
`;

function argumentsFor(argv) {
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) return null;
  const command = argv.shift();
  if (!['analyze', 'render'].includes(command)) throw new Error('Choose analyze or render; use --help for usage.');
  const allowed = new Set(command === 'analyze' ? ['audio', 'lyrics', 'out', 'concept', 'identity', 'style'] : ['project', 'audio', 'clips', 'out', 'res', 'fps', 'font']);
  const args = { command };
  while (argv.length) {
    const key = argv.shift();
    if (!key.startsWith('--') || !allowed.has(key.slice(2))) throw new Error('Unknown option: ' + key);
    if (Object.hasOwn(args, key.slice(2))) throw new Error('Repeated option: ' + key);
    const value = argv.shift();
    if (value === undefined || value.startsWith('--')) throw new Error('Missing value for ' + key);
    args[key.slice(2)] = value;
  }
  for (const key of command === 'analyze' ? ['audio', 'lyrics', 'out'] : ['project', 'audio', 'clips', 'out']) if (!args[key]) throw new Error('Missing --' + key);
  for (const [key, min, max] of [['res', 144, 2160], ['fps', 1, 60]]) if (args[key] !== undefined) {
    const value = Number(args[key]);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error('--' + key + ' must be an integer from ' + min + ' to ' + max + '.');
    args[key] = value;
  }
  return args;
}
async function inputFile(value, label) {
  const filename = path.resolve(value);
  let stat;
  try { stat = await fs.stat(filename); } catch { throw new Error(label + ' does not exist: ' + filename); }
  if (!stat.isFile()) throw new Error(label + ' is not a regular file: ' + filename);
  return { path: filename, name: path.basename(filename), size: stat.size, lastModified: Math.floor(stat.mtimeMs) };
}
async function jsonFile(file, label) {
  if (file.size > 8 * 1024 * 1024) throw new Error(label + ' must be smaller than 8 MB.');
  try { return JSON.parse(await fs.readFile(file.path, 'utf8')); } catch { throw new Error(label + ' is not valid JSON: ' + file.path); }
}
function sidecar(filename, extension) { return filename.replace(/\.[^/.]+$/, '') + extension; }
async function atomicWrite(filename, value) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temporary = filename + '.' + randomUUID() + '.tmp';
  try { await fs.writeFile(temporary, value); await fs.rename(temporary, filename); }
  finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
}
function playwrightModule() {
  const candidates = ['playwright'];
  if (process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES) candidates.push(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright'));
  for (const candidate of candidates) { try { return require(candidate); } catch {} }
  throw new Error('Playwright is missing. Install it in the project, or set CODEX_PRIMARY_RUNTIME_NODE_MODULES to its node_modules directory.');
}
async function appBrowser() {
  const playwright = playwrightModule();
  let html;
  try { html = await fs.readFile(path.join(ROOT, 'index.html')); }
  catch { throw new Error('index.html is missing. Run python3 build.py from the JIZURA repository.'); }
  // Exact routes only. The HTTP endpoint exposes no filesystem paths, directory
  // listing, symlinks or user files. Explicit files enter through a native input.
  const server = http.createServer((req, res) => {
    if (!['GET', 'HEAD'].includes(req.method) || !['/', '/index.html'].includes(req.url)) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': html.length, 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : html);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  let browser;
  const close = async () => { if (browser) await browser.close().catch(() => {}); await new Promise(resolve => server.close(resolve)); };
  try {
    try { browser = await playwright.chromium.launch({ headless: true,
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
      args: ['--autoplay-policy=no-user-gesture-required'] }); }
    catch (error) { throw new Error('Chromium could not start. Set CHROMIUM_PATH to an installed Chromium, or run npx playwright install chromium. ' + error.message); }
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(30000);
    const origin = 'http://127.0.0.1:' + server.address().port;
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.origin === origin || ['blob:', 'data:'].includes(url.protocol) ? route.continue() : route.abort();
    });
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    try { await page.waitForFunction(() => window.J?.ui?.plan && J.directorDraft && J.directorUI?.loadVideos && J.uiApi?.applyDirectorAssembly); }
    catch { throw new Error('The built app lacks the MV director. Run python3 build.py. ' + pageErrors.join(' / ')); }
    await page.evaluate(() => {
      J.uiApi.pause();
      const input = document.createElement('input'); input.type = 'file'; input.id = 'cliLocalFile'; input.hidden = true; document.body.appendChild(input);
    });
    return { page, close };
  } catch (error) { await close(); throw error; }
}
async function transferFile(page, file) {
  await page.setInputFiles('#cliLocalFile', file.path);
  await page.evaluate(meta => {
    const input = document.getElementById('cliLocalFile'), native = input.files[0];
    if (!native || native.size !== meta.size) throw new Error('Input file changed while it was being loaded: ' + meta.name);
    window.__jizuraCliFile = new File([native], meta.name, { type: native.type, lastModified: meta.lastModified });
    input.value = '';
  }, file);
}
async function loadAudio(page, audio) {
  process.stderr.write('Analyzing original audio…\n');
  await transferFile(page, audio);
  await page.evaluate(async () => {
    const loaded = await J.uiApi.loadAudioFile(window.__jizuraCliFile);
    delete window.__jizuraCliFile;
    if (!loaded || !J.ui.audio) throw new Error('Audio could not be decoded: ' + document.getElementById('audioName').textContent);
  });
}
async function loadRenderFont(page, font) {
  process.stderr.write('Loading local font: ' + font.name + '…\n');
  await transferFile(page, font);
  return page.evaluate(async metadata => {
    let key;
    try { key = await J.loadFontFile(window.__jizuraCliFile); }
    catch (error) { throw new Error('Local font could not be decoded: ' + metadata.name + '. Supply a valid TTF, OTF, WOFF or WOFF2 file. ' + error.message); }
    finally { delete window.__jizuraCliFile; }
    const face = J.FONTS[key];
    const saved = { key, label: face.label, family: face.family.replace(/"/g, ''), weight: face.weight,
      source: { name: metadata.name, size: metadata.size, lastModified: metadata.lastModified } };
    J.ui.project.userFonts = (J.ui.project.userFonts || []).filter(value => value.key !== key).concat(saved);
    J.ui.project.fonts = Object.fromEntries(['display', 'serif', 'body', 'mono'].map(role => [role, key]));
    // Several layouts select their own catalogue keys. Resolve those, HUD faces
    // and per-cut parameters through the uploaded face as well; this override
    // lasts only for this isolated browser session. No font data enters JSON.
    J.faceOf = () => face;
    J.glyphs.clear(); J.metrics.clear();
    J.uiApi.syncUI(); J.uiApi.replan();
    if (!document.fonts.check('400 32px ' + face.family)) throw new Error('The local font did not finish loading.');
    return { key, family: saved.family, source: saved.source };
  }, font);
}
async function analyze(page, args, audio, lyricsFile, out) {
  const lyrics = await fs.readFile(lyricsFile.path, 'utf8');
  if (lyrics.length > 200000) throw new Error('Lyrics must be at most 200,000 characters.');
  await loadAudio(page, audio);
  const result = await page.evaluate(({ audio, lyrics, concept, identity, style }) => {
    const model = J.directorDraft({ audio: J.ui.audio, audioFile: audio, lyrics, timing: {}, concept, identity, style });
    return { model, pack: J.directorPromptPack(model) };
  }, { audio, lyrics, concept: args.concept || '', identity: args.identity || '', style: args.style || '' });
  await atomicWrite(out, JSON.stringify(result.model, null, 2) + '\n');
  const pack = sidecar(out, '.gpt.txt');
  await atomicWrite(pack, result.pack + '\n');
  return { command: 'analyze', director: out, gptPack: pack, duration: result.model.song.duration,
    segments: result.model.segments.length, pendingLyrics: result.model.lyrics.filter(row => row.timing === 'estimated').length };
}
async function render(page, args, audio, rawProject, manifest, out, font) {
  const model = await page.evaluate(raw => {
    const model = J.directorNormalize(raw?.director || raw);
    if (!model) throw new Error('Invalid director data: version, song duration, 10-second segments and all nine panel timings must be intact.');
    if (model.lyrics.some(row => row.timing === 'estimated')) throw new Error('Provisional lyric timing remains. Review the timing with the original song in JIZURA and save the confirmed project; this tool does not confirm it.');
    return model;
  }, rawProject);
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('clips.json must be an object mapping segment IDs to absolute file paths.');
  const expected = new Set(model.segments.map(segment => segment.id));
  for (const key of Object.keys(manifest)) if (!expected.has(key)) throw new Error('Unknown segment in clips.json: ' + key);
  const clips = [];
  for (const segment of model.segments) {
    const filename = manifest[segment.id];
    if (typeof filename !== 'string' || !path.isAbsolute(filename)) throw new Error('clips.json needs an absolute file path for ' + segment.id + '.');
    clips.push({ segmentId: segment.id, file: await inputFile(filename, segment.id + ' video') });
  }
  if (clips.some(clip => clip.file.path === out || clip.file.path === sidecar(out, '.jizura.json'))) throw new Error('Output paths must not overwrite input videos.');
  await page.evaluate(async ({ raw, model, res, fps }) => {
    if (raw.director) {
      const old = J.ui.project, file = new File([JSON.stringify(raw)], 'cli-project.jizura.json', { type: 'application/json' });
      const transfer = new DataTransfer(); transfer.items.add(file);
      const input = document.getElementById('fileProject'); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
      const deadline = performance.now() + 10000;
      while (J.ui.project === old && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
      if (J.ui.project === old || !J.ui.project.director) throw new Error('JIZURA project could not be opened.');
    } else {
      J.ui.project.director = model;
      J.ui.project.lyrics = model.lyrics.map(row => row.text).join('\n');
    }
    if (res !== undefined) J.ui.project.res = res;
    if (fps !== undefined) J.ui.project.fps = fps;
    J.uiApi.syncUI(); J.uiApi.replan(); J.directorUI.render();
  }, { raw: rawProject, model, res: args.res, fps: args.fps });
  let fontChoice;
  if (font) fontChoice = await loadRenderFont(page, font);
  else if (/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/u.test(model.lyrics.map(row => row.text).join(''))) {
    process.stderr.write('Japanese lyrics: this offline render uses installed fonts. If no Japanese font is installed, glyphs will be missing. Supply --font /absolute/path/to/a/Japanese-capable-font.ttf.\n');
  }
  await loadAudio(page, audio);
  for (const clip of clips) {
    process.stderr.write('Linking ' + clip.segmentId + '…\n');
    await transferFile(page, clip.file);
    await page.evaluate(async id => {
      const count = await J.directorUI.loadVideos([window.__jizuraCliFile], id); delete window.__jizuraCliFile;
      if (count !== 1 || !J.ui.project.director.segments.find(segment => segment.id === id)?.sourceId) throw new Error(id + ' could not be loaded.');
    }, clip.segmentId);
  }
  const assembled = await page.evaluate(() => {
    const model = J.ui.project.director, result = J.directorAssemble(model, J.ui.media);
    if (!J.uiApi.applyDirectorAssembly(result, model)) throw new Error('MV assembly did not complete.');
    return { duration: result.duration, segments: model.segments.length };
  });
  process.stderr.write('Rendering ' + assembled.duration + ' seconds…\n');
  const size = await page.evaluate(async () => {
    const original = J.saveFile;
    J.saveFile = async (name, value) => { if (!(value instanceof Blob)) throw new Error('MP4 exporter did not return a Blob.'); window.__jizuraCliExport = value; return 'saved'; };
    try { await J.uiApi.runExport('mp4'); } finally { J.saveFile = original; }
    if (!window.__jizuraCliExport?.size) throw new Error('MP4 export failed: ' + (document.querySelector('.exp-text')?.textContent || document.querySelector('.toast')?.textContent || 'No file was saved.'));
    return window.__jizuraCliExport.size;
  });
  await fs.mkdir(path.dirname(out), { recursive: true });
  const temporary = out + '.' + randomUUID() + '.tmp';
  let handle;
  try {
    handle = await fs.open(temporary, 'wx');
    for (let offset = 0; offset < size; offset += 1024 * 1024) {
      const encoded = await page.evaluate(async offset => {
        const bytes = new Uint8Array(await window.__jizuraCliExport.slice(offset, offset + 1024 * 1024).arrayBuffer());
        let binary = ''; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
        return btoa(binary);
      }, offset);
      await handle.writeFile(Buffer.from(encoded, 'base64'));
    }
    await handle.close(); handle = null;
    await fs.rename(temporary, out);
  } finally { if (handle) await handle.close(); await fs.rm(temporary, { force: true }).catch(() => {}); }
  const savedProject = sidecar(out, '.jizura.json');
  await atomicWrite(savedProject, await page.evaluate(() => JSON.stringify(J.ui.project, null, 2) + '\n'));
  return { command: 'render', video: out, project: savedProject, bytes: size, ...assembled, ...(fontChoice ? { font: fontChoice } : {}) };
}

async function main() {
  const args = argumentsFor(process.argv.slice(2));
  if (!args) { process.stdout.write(HELP); return; }
  const audio = await inputFile(args.audio, 'Audio'), out = path.resolve(args.out);
  const auxiliary = await inputFile(args.command === 'analyze' ? args.lyrics : args.project, args.command === 'analyze' ? 'Lyrics' : 'Project');
  const manifestFile = args.command === 'render' ? await inputFile(args.clips, 'Clips manifest') : null;
  const font = args.font ? await inputFile(args.font, 'Font') : null;
  if (font && !/\.(?:ttf|otf|woff2?)$/i.test(font.name)) throw new Error('--font needs a .ttf, .otf, .woff or .woff2 file.');
  const outputs = [out, sidecar(out, args.command === 'analyze' ? '.gpt.txt' : '.jizura.json')];
  if ([audio, auxiliary, manifestFile, font].filter(Boolean).some(file => outputs.includes(file.path))) throw new Error('Output paths must not overwrite input files.');
  if (new Set(outputs).size !== outputs.length) throw new Error('Choose a distinct .json or .mp4 output filename.');
  const raw = args.command === 'render' ? await jsonFile(auxiliary, 'Project') : null;
  const manifest = manifestFile ? await jsonFile(manifestFile, 'Clips manifest') : null;
  const app = await appBrowser();
  try {
    const result = args.command === 'analyze' ? await analyze(app.page, args, audio, auxiliary, out) : await render(app.page, args, audio, raw, manifest, out, font);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } finally { await app.close(); }
}
main().catch(error => { process.stderr.write('JIZURA: ' + (error?.message || error) + '\n'); process.exitCode = 1; });
