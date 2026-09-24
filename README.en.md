# JIZURA — Lyric Motion Video Maker

Turn lyrics into animated lyric videos in your browser. JIZURA combines layouts, entrances, holds, exits, decorations, text treatments, backgrounds, camera moves, effects and transitions. Change the seed or press **Create a variation** to explore another arrangement.

**[Open the English app](https://852wa.github.io/JIZURA/en/)** · [日本語版](https://852wa.github.io/JIZURA/) · [Japanese guide](README.md)

The English and Japanese browser editions share the same project format and saved browser data. Use the language links at the top of the editor to switch editions without changing your lyrics or settings. English After Effects panels are available as [ScriptUI](https://852wa.github.io/JIZURA/JIZURA_AE_en.jsx) and [CEP](https://852wa.github.io/JIZURA/JIZURA_CEP_en.zip) downloads. The AE JSON format is the same in both languages.

## Quick start

1. Paste lyrics into the left panel, one phrase per line. The built-in English sample is shown on a fresh install.
2. Optionally import audio. JIZURA detects beats and can snap cut boundaries to them. Use **Tap to sync** to mark the start of each line by pressing Space during playback.
3. Press **Create a variation** (or `R`) to randomize the style, mood, motion, palette and arrangement. **Previous** and **Next** navigate variations; **Change one thing** rerolls just one part.
4. Set aspect ratio, resolution and frame rate, then export MP4. Advanced mode adds a PNG sequence, transparent PNGs, color key backgrounds and individual technique controls.

**Lyrics language.** The styles are designed around Japanese fonts. For Chinese (Traditional / Simplified) and Korean lyrics, set **Lyrics language** below the lyrics box (Auto-detect is the default: kana → Japanese, Hangul → Korean, Chinese only → Traditional or Simplified by characters such as 們/们 and 說/说). Each font is then replaced with a face in that language with a similar feel — e.g. Noto Sans JP → Noto Sans TC / SC / KR, Noto Serif JP → Noto Serif TC / SC / KR, Dela Gothic One → WDXL Lubrifont TC / ZCOOL QingKe HuangYou / Black Han Sans — so a line never mixes fonts. The AE panels have the same setting, the AE JSON carries the language, and AE falls back to the OS fonts (PingFang, Microsoft JhengHei / YaHei, Apple SD Gothic Neo, Malgun Gothic) when those faces are not installed.

Lyric syntax: `I remember/the dawn` makes a manual cut; `*word*` emphasizes a word; a final `!` adds a flash and shake; `lyric|note` adds small annotation text; `[01:23.45]lyric` imports an LRC timestamp; `# comment` is ignored.

Use **Save** and **Open** for `.jizura.json` projects. **Export for AE** creates arrangement data to import into the After Effects panel. Generated videos and images belong to their creators; rights to music and lyrics remain with their respective rights holders. Project files, lyrics and audio are handled in the browser. Google Fonts are loaded as needed. The tool is MIT licensed; see [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Edit videos and add animated lyrics

1. Import one or more local videos. They become consecutive clips on a single editing timeline. MP4, WebM and other formats work when the browser supports their codecs. The files stay in your browser.
2. Select a clip and set its **Start / End** range using seconds within the source video. Move the preview to a point inside a clip and use **Split** to cut it in two. You can duplicate, move and delete clips, and undo or redo video edits.
3. Adjust each clip's **Speed (0.25–4×), volume, fade in / out and horizontal flip**, then click **Apply to clip** to commit these settings and the source range. Set volume to 0% to mute a clip. Trimming or changing speed changes its length in the final timeline. Source audio changes pitch with speed. Fades affect the footage and its source audio; lyrics and separately imported music do not fade with the clip.
4. Enter lyrics and edit each line's **Start / End (s)** on the final timeline. LRC timestamps and **Tap to sync** also work; manual timing overrides LRC. An earlier end leaves a gap for an instrumental passage. **Adding, removing, reordering, trimming or changing the speed of footage does not move lyric times automatically.** Arrange the footage before aligning the lyrics. Leave the lyrics empty to edit and export video without text.
5. Choose the output aspect ratio, then **Fit whole video** or **Fill frame**. Adjust center / lower / upper text placement, scale, horizontal and vertical position, shadow and video dimming.
6. Select **Video audio**, **Imported audio** or **Mute**. Video audio follows each clip's range, speed, volume, mute and fades. Imported audio replaces it with a soundtrack beginning at the start of the final timeline. If the browser cannot extract video audio, import a separate audio file or select Mute.
7. Export **MP4** or a **PNG sequence** to composite the edited footage and animated lyrics. Output length is the total duration of the edited clips. **Transparent PNG** exports animated lyrics and added images without footage or background for compositing elsewhere. MP4 requires WebCodecs and a supported encoder; Chrome or Edge is recommended.

The footage uses one consecutive track without gaps. Simultaneous video layers and overlapping cross-dissolves are not supported. Combining a clip's fade out with the next clip's fade in produces a transition through black. Long or high-resolution sources can use substantial device memory; try a short section before exporting a long sequence.

MV mode retains the text animation and palette while omitting opaque style backgrounds, HUD, global post-processing and lyric-cut transitions. Automatic title cards and interlude cuts are also disabled. Some existing layouts contain graphic bands or panels; choose a layout that leaves the important parts of your footage visible. Without imported video, the original lyric-video workflow remains available.

**Save and reopen:** Project JSON stores lyrics, timing, MV settings, clip order and edits, and source-file metadata. It does not embed video, audio or added image files. Re-select the same video files when reopening; matching source metadata reconnects them to the existing clips, including split and duplicated clips. Re-select any separate audio file as well. Video editing and compositing are browser-edition features; footage edits are not transferred to the After Effects panels.

## Add animated image overlays

Import still PNG, JPEG or WebP images and give each image its own timing, placement and motion. Image colors and transparent PNG pixels are preserved. Animated PNG and WebP files are not supported. Image overlays work with footage and with the original lyric-video workflow. Without video, the style background remains, with images and text composited separately.

1. Use **Add / reimport images**. Each imported image becomes a separate layer, and multiple layers can be visible at the same time.
2. Select a layer and set its **Show from / Show until (s)** on the final edited timeline. Footage edits do not automatically move image timing.
3. Adjust **transparency, position, scale, rotation and horizontal flip**. Transparency is **0% for fully opaque and 100% for invisible**. Position 50% is the center; scale 100% fits the whole image in the frame. Place an image below or above lyrics and reorder images within that plane.
4. Choose **Entrance, hold and exit** motions independently. These reuse image-compatible JIZURA text motions, applied to the whole image or to a 4×4 grid of tiles that animate in sequence. Text-specific layouts and effects that depend on glyph shapes are not image effects; this is not support for all of JIZURA's text techniques on images. Click **Apply to image** to commit your settings.
5. Duplicate layers to reuse an image with different timing, placement or motion, or delete unwanted layers. Image editing has undo and redo.
6. **MP4 and PNG sequences** composite footage, images and lyrics. When video is present, export ends with the edited footage, even if an image is scheduled to last longer. Without video, duration follows the latest end of the lyrics, audio or images. **Transparent PNG** includes both images and animated lyrics without footage or a background.

**Save and reopen:** Project JSON stores image-layer settings and source metadata, without embedding the image files. Reimport the same images to reconnect the layers. Image compositing and animation are browser-edition features and are not transferred to the After Effects panels.

## Plan storyboards from a song and assemble generated footage

The MV production planner divides a song into 10-second footage slots, connects GPT and FRAME storyboard planning, and assembles clips you generate manually with MiniMax H3. Local audio analysis **estimates BPM, beats and energy**. It does not accurately transcribe melody pitches or staff notation, or automatically recognize the sung timing of lyrics.

1. Open the MV production panel, import the original soundtrack, enter lyrics or timed LRC, and describe the concept, character settings and visual direction before creating a production plan. Times drafted from plain lyrics are estimates. Check every lyric start and end against the song before confirming them, including imported LRC or manually entered times.
2. Each footage slot has **one 16:9 storyboard sheet containing a 3×3 grid of nine 16:9 panels**. Read left to right, top to bottom: the panels show reference moments within one 10-second clip, not nine separate 10-second clips. Generate the final slot as 10 seconds too; assembly trims it to the song's remaining duration.
3. Export the GPT production pack and provide it in a conversation with the song, lyrics and character references. Refine the narrative, continuity, nine-panel staging, image-generation prompts and MiniMax H3 video prompts, then import GPT's structured JSON response into JIZURA. Generate successive storyboard sheets **without rendered lyrics, captions, panel numbers or other text**. Creating a plan does not generate images by itself.
4. Composition choices use the bundled **FRAME technique catalog**. GPT can refine those choices in context, and FRAME review links let you inspect the composition settings. This catalog is a bundled snapshot, not a live sync with the FRAME site. Review and confirm the returned plan and lyric timing.
5. Use each slot's prompt to generate a **full-frame, 16:9, 10-second video** manually in MiniMax H3. The 3×3 sheet is a narrative and motion reference; it does not request a nine-panel final video or force the sheet itself to become the first frame. Request no captions, lyrics, logos, music or dialogue. JIZURA restores the original soundtrack later.
6. Import the generated videos in any order and assign each to its slot; names such as `S001.mp4` and `S002.mp4` are matched to the corresponding slot numbers. Assembly requires all footage slots, the matching original song and confirmed lyric timings. Automatic assembly checks for missing assignments and footage that is too short, orders and trims the clips, and mutes their source audio. It starts the original song at time zero and overlays animated lyrics using the reviewed timings. Existing image overlays are preserved. Review the preview, then export MP4.

**Scope and saving:** GPT conversations, storyboard image generation and MiniMax video generation happen in the respective chat or service. The browser planner does not automatically send your song, require API keys or call paid generation APIs. Project JSON saves planning data, assignments and source metadata, without embedding media. Reimport the song, videos and images when reopening a project.

## Run planning and MV export from a GPT execution environment

The CLI runs the browser's analysis, assembly and export from a local terminal or a GPT environment with file execution. It requires Node.js, Playwright, Chromium and a built `index.html`. First create a plan from the soundtrack and lyrics:

Install Playwright in this project or provide it through the execution environment's `CODEX_PRIMARY_RUNTIME_NODE_MODULES`. Install Chromium with `npx playwright install chromium`, or set `CHROMIUM_PATH` to an existing executable. The CLI itself does not require FFmpeg.

```sh
node tools/mv_workflow.mjs analyze --audio song.wav --lyrics lyrics.lrc --out director.json
```

This writes `director.json` and the GPT handoff text `director.gpt.txt`. Optional `--concept`, `--identity` and `--style` arguments supply the concept, character settings and visual direction. Refine the direction with GPT and listen to and correct the lyric timings. The CLI never marks provisional timings as reviewed on its own; rendering refuses timings that remain estimated.

Create `clips.json` with an explicit mapping from every slot to an absolute video path, independent of file order:

```json
{
  "S001": "/absolute/S001.mp4",
  "S002": "/absolute/S002.mp4"
}
```

```sh
node tools/mv_workflow.mjs render --project director.json --audio song.wav --clips clips.json --out mv.mp4
```

`--project` accepts a standalone director JSON or a saved JIZURA project containing the director. Optional export settings include `--res 720 --fps 24`. Output includes `mv.mp4` and an editable `mv.jizura.json` sidecar.

This command does not generate footage. It orders and trims supplied clips, mutes their source audio, and composites the original song with animated lyrics. A mismatched song, missing or short videos, or unlinked image layers stop export. For projects with image overlays, open the project in the browser, reimport the images and export from the browser.

The CLI blocks external network requests. If no Japanese font is installed, use the optional `--font /absolute/NotoSansJP.ttf` to provide a Japanese-capable font (TTF / OTF / WOFF / WOFF2). This overrides all rendered text faces, including layout and HUD fonts. Only the font choice and file metadata are saved, not the font bytes. On reopening, provide the same file to the CLI or reupload it in the browser.

## Build and publish

Run `python3 build.py` at the repository root. It creates `index.html` and `en/index.html`, both standalone pages for GitHub Pages. Run `python3 build_ae.py --lang en` to rebuild `JIZURA_AE_en.jsx`, and `python3 build_cep.py --lang en --out dist` to build `dist/JIZURA_CEP_en.zip` (copy the ZIP to the repository root for Pages downloads). Commit the built pages, panels and translation sources together. Publish from the repository root on GitHub Pages; the English edition is then served at `/JIZURA/en/`. Open either HTML file locally for offline use, with installed fonts as a fallback.

After building, run `node dev/director_browser_test.js` for the MV production round-trip regression test with real media. It requires Playwright, Chromium, FFmpeg and ffprobe. Set `CHROMIUM_PATH` to use an installed browser and `DIRECTOR_TEST_PAGE=/en/index.html` to exercise the English edition.

Install `JIZURA_AE_en.jsx` in After Effects' `Scripts/ScriptUI Panels` folder, restart AE, then open it from the Window menu. The English CEP package has a distinct extension ID, so it can coexist with the Japanese CEP panel. Extract the ZIP and use its Windows or macOS installer. These panels require After Effects to verify motion and export behavior; automated checks use a mock AE environment.
