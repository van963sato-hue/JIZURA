# FRAME composition bridge

JIZURA's MV director bundles the user's FRAME 4.0.0 composition catalog and
prompt engine in `src/10d_frame.js`: 330 technique choices. This is a local
snapshot, not a live catalog lookup. Source snapshot: the `frame-atelier`
skill's `references/engine.mjs`, retrieved on 2026-09-24. Its source SHA-256 is
`dcf510569a0d0e675c5c922b0bb91c5198b56fff36d7a0b2e86391ff7d26c895`.

The block between `BEGIN FRAME 4.0.0 ENGINE` and `END FRAME 4.0.0 ENGINE`
retains the original source verbatim apart from its final ESM export statement.
A browser IIFE and the JIZURA adapters surround that block. The engine's actual
`compose_frame_prompt` implementation creates both the prompt and review URL;
JIZURA does not recreate or manually encode FRAME review links.

The live adjustment app is
<https://frame-composition-atelier.lycov.chatgpt.site>.
Opening a review link loads a pending composition. Applying that composition
requires the FRAME app's own apply button. Changes made in FRAME do not
silently synchronize back into JIZURA.

## Browser API

- `J.directorFrameCatalog(query = {})` returns the canonical catalog object
  with `catalog_version`, `categories`, `groups`, `options` and related fields.
  The default includes each option's `description` and English `prompt`.
  Optional canonical filters are `category`, `query` and `details`.
- `J.directorFrameSummary(ids)` returns normalized choices as objects with
  `id`, `label`, `description`, `prompt`, `category` and `group`. It resolves
  conflicting choices using FRAME's own normalization rules. Unknown IDs are
  omitted from this display summary; actual panel composition rejects them.
- `J.directorFramePanel(model, segment, panel)` returns FRAME's canonical
  `{ prompt, review_url, selected, warnings, removed_conflicting_options, ... }`.
  Inputs are `model.identity`, `model.style`, `panel.scene`,
  `panel.frameCustom`, and `panel.frameOptions`. `segment` is retained in the
  signature for callers but its source lyrics/summary are not copied into the
  panel recipe. The panel ratio is always `16:9`. The language follows the
  English app edition, or optional `model.language === 'en'`.
- `J.directorPrepareFrames(model)` returns a nonmutating array of segment IDs
  and computed panel results. Incomplete or oversized panels get an `error`
  property; other panels still produce their own result.

FRAME chooses no characters or visual scenes for the director. GPT interprets
supplied lyrics and music, writes each concrete scene, then chooses real
technique IDs. The adapter does not use the embedded keyword suggestion tool.

Each panel supports at most 24 technique IDs. FRAME accepts up to 3,000
characters for the concrete scene and up to 3,000 for the combined identity,
style, panel-specific constraints and no-lettering instruction. Oversized
input produces a visible error rather than silently discarding character
identity. A combined notes length around 2,700 characters leaves room for
instruction labels in either language.

Neither lyrics nor supplied precomputed URLs are copied into the recipe. The
adapter leaves `lettering` empty and always adds a no-lettering instruction.
Character identity and style are preserved as supplied. All links/prompts are
derived from the saved scene and choices, so their generated fields do not
need to be persisted in the project JSON.

The director's storyboard prompt arranges nine such 16:9 panels in a 3×3 sheet
whose overall aspect ratio is also 16:9. One sheet plans one ten-second video.
The grid is a planning reference, not a start-frame image for a whole video.

## Verification

Run `node dev/frame_bridge_test.js`. It checks the vendored engine source hash,
compares the complete composition result (including review URL) against a
fixture produced by the official `scripts/frame.mjs compose` command, and
checks catalog size, conflict resolution, missing/oversized input, lyric
omission, empty lettering, English rendering and nonmutating preparation.
