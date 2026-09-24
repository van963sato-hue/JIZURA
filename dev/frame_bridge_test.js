#!/usr/bin/env node
'use strict';
// The expected digest below was produced by the official frame.mjs compose
// CLI, not by this browser adapter. Tests require no browser or network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, '../src/10d_frame.js'), 'utf8');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const engine = source.split('/* BEGIN FRAME 4.0.0 ENGINE */\n')[1].split('/* END FRAME 4.0.0 ENGINE */')[0] + 'export {invokeTool};\n';
assert.equal(sha(engine), 'dcf510569a0d0e675c5c922b0bb91c5198b56fff36d7a0b2e86391ff7d26c895', 'Canonical engine is byte-for-byte preserved');
const context = { J: {}, TextEncoder, TextDecoder, btoa, atob };
vm.runInNewContext(source, context, { filename: '10d_frame.js' });
const J = context.J;
const catalog = J.directorFrameCatalog();
assert.equal(catalog.catalog_version, '4.0.0');
assert.equal(catalog.options.length, 330);
assert.equal(new Set(catalog.options.map(v => v.id)).size, 330);
assert.ok(catalog.options.every(v => v.description && v.prompt));
const panel = { index: 1, scene: '雨上がりの駅。青いコートの人物を画面右の三分割点に置き、左奥へ伸びる線路を見つめる。',
  frameOptions: ['center', 'thirds', 'wide', 'cel', 'soft', 'blue', 'layers'], frameCustom: '遠景へ続く線路。' };
const segment = { id: 'S001', panels: [panel] };
const model = { identity: '青いコート、人物は1人。', style: '背景は水彩、人物はセル塗り。',
  lyrics: [{ text: 'NEVER_DRAW_THESE_LYRICS_歌詞です' }], segments: [segment] };
const before = JSON.stringify(model), result = J.directorFramePanel(model, segment, panel);
assert.equal(sha(JSON.stringify(result)), '5c78fe5501270137ebe08a3c133d9693a13a20cdc94fcbf68edc712ec6068b4a', 'Browser prompt and review link match official CLI fixture');
assert.equal(result.image_generated, false);
assert.deepEqual(Array.from(result.removed_conflicting_options), ['center']);
assert.ok(result.prompt.includes(model.identity) && result.prompt.includes(model.style));
assert.ok(result.prompt.includes('歌詞・字幕・文字'));
const url = new URL(result.review_url);
assert.equal(url.origin, 'https://frame-composition-atelier.lycov.chatgpt.site');
const recipe = JSON.parse(Buffer.from(url.hash.replace('#recipe=', ''), 'base64url').toString());
assert.equal(recipe.version, 1);
assert.equal(recipe.state.ratio, '16:9');
assert.equal(recipe.state.lettering, '');
assert.equal(recipe.state.sourceText, '');
assert.ok(!JSON.stringify(recipe).includes('NEVER_DRAW_THESE_LYRICS'));
assert.ok(!result.prompt.includes('NEVER_DRAW_THESE_LYRICS'));
assert.deepEqual(Array.from(J.directorFrameSummary(['center', 'thirds', 'not-real']), v => v.id), ['thirds']);
assert.equal(J.directorFrameSummary(['thirds'])[0].description, '交点に視線の中心を。');
assert.throws(() => J.directorFramePanel(model, segment, { ...panel, scene: '' }), /情景/);
assert.throws(() => J.directorFramePanel(model, segment, { ...panel, scene: 'あ'.repeat(3001) }), /3000/);
assert.throws(() => J.directorFramePanel({ ...model, identity: 'あ'.repeat(3001) }, segment, panel), /長すぎ/);
assert.throws(() => J.directorFramePanel(model, segment, { ...panel, frameOptions: ['invented-id'] }), /invented-id/);
assert.throws(() => J.directorFramePanel(model, segment, { ...panel, frameOptions: catalog.options.slice(0, 25).map(v => v.id) }), /24/);
const prepared = J.directorPrepareFrames({ ...model, segments: [{ ...segment, panels: [panel, { index: 2, scene: '' }] }] });
assert.equal(prepared[0].panels[0].review_url, result.review_url);
assert.ok(prepared[0].panels[1].error);
assert.equal(JSON.stringify(model), before, 'Frame preparation never changes project data');
context.document = { documentElement: { lang: 'en' } };
const english = J.directorFramePanel(model, segment, panel);
assert.ok(english.prompt.includes('Aspect ratio 16:9.'));
assert.ok(english.prompt.includes('No lyrics, captions, lettering'));
assert.ok(english.prompt.includes(model.identity));
console.log('FRAME bridge: canonical CLI equivalence, 330 options, no lettering/lyric leakage, input bounds and nonmutating preparation passed.');
