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
7. Export **MP4** or a **PNG sequence** to composite the edited footage and animated lyrics. Output length is the total duration of the edited clips. **Transparent PNG** exports only the lyric animation for compositing elsewhere. MP4 requires WebCodecs and a supported encoder; Chrome or Edge is recommended.

The footage uses one consecutive track without gaps. Simultaneous video layers and overlapping cross-dissolves are not supported. Combining a clip's fade out with the next clip's fade in produces a transition through black. Long or high-resolution sources can use substantial device memory; try a short section before exporting a long sequence.

MV mode retains the text animation and palette while omitting opaque style backgrounds, HUD, global post-processing and lyric-cut transitions. Automatic title cards and interlude cuts are also disabled. Some existing layouts contain graphic bands or panels; choose a layout that leaves the important parts of your footage visible. Without imported video, the original lyric-video workflow remains available.

**Save and reopen:** Project JSON stores lyrics, timing, MV settings, clip order and edits, and source-file metadata. It does not embed video or audio files. Re-select the same video files when reopening; matching source metadata reconnects them to the existing clips, including split and duplicated clips. Re-select any separate audio file as well. Video editing and compositing are browser-edition features; footage edits are not transferred to the After Effects panels.

## Build and publish

Run `python3 build.py` at the repository root. It creates `index.html` and `en/index.html`, both standalone pages for GitHub Pages. Run `python3 build_ae.py --lang en` to rebuild `JIZURA_AE_en.jsx`, and `python3 build_cep.py --lang en --out dist` to build `dist/JIZURA_CEP_en.zip` (copy the ZIP to the repository root for Pages downloads). Commit the built pages, panels and translation sources together. Publish from the repository root on GitHub Pages; the English edition is then served at `/JIZURA/en/`. Open either HTML file locally for offline use, with installed fonts as a fallback.

Install `JIZURA_AE_en.jsx` in After Effects' `Scripts/ScriptUI Panels` folder, restart AE, then open it from the Window menu. The English CEP package has a distinct extension ID, so it can coexist with the Japanese CEP panel. Extract the ZIP and use its Windows or macOS installer. These panels require After Effects to verify motion and export behavior; automated checks use a mock AE environment.
