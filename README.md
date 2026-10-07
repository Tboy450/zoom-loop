# Zoom Loop

Zoom Loop is a browser app for making recursive photo zoom loops. You add a stack of photos, and the app hides each next photo inside a small **recursive portal** in the current photo. When the loop plays, it zooms into that portal and reveals the next image.

Everything runs in your browser. Your photos are not uploaded to a server.

The effect is built from the photos you add. Each pair gets a texture-aware insertion point, a small embedded version that borrows the surrounding photo's material, and a feather outside the image boundary. As the camera moves closer, the next photo's detail and original color emerge in the same place. Nested photos are carried through the handoff, including the last-to-first transition, with continuous zoom speed.

Automatic placement is on by default, with an embedded frame 8% of the photo width (down from 12%), strong color binding, and no added grain. The camera uses the central 80% of each normalized square photo so the blend boundary passes outside the screen before the handoff. Very different subjects can still produce a visible change of scene; the compositor blends existing pixels and does not invent matching objects or scenery. Use `Place Manually` if an automatic placement lands on an important subject.

Automatic zoom points now favor the central part of the visible frame. An off-center point must offer a substantially better match, not just a small color advantage. Steering follows the zoom so the destination stays in view instead of sliding offscreen halfway through. Manually picked points still take priority.

## Phone Install Link

Open the app on your phone:

**[Open Zoom Loop](https://tboy450.github.io/zoom-loop/)**

No App Store or Play Store download is required. Zoom Loop installs from the browser as a web app.

Android:

1. Tap the **[Open Zoom Loop](https://tboy450.github.io/zoom-loop/)** link on your Android phone.
2. Open the link in Chrome if it opens inside GitHub or another app.
3. Tap `Install` if Chrome shows the install button.
4. If no button appears, open the Chrome menu and choose `Add to Home screen` or `Install app`.
5. Open `Zoom Loop` from your home screen.

iPhone or iPad:

1. Tap the **[Open Zoom Loop](https://tboy450.github.io/zoom-loop/)** link on your iPhone or iPad.
2. Open the link in Safari if it opens inside GitHub or another app.
3. Tap the Safari Share button.
4. Choose `Add to Home Screen`.
5. Tap `Add`, then open `Zoom Loop` from your home screen.

The installed app works offline after it has loaded once.

This repository publishes GitHub Pages from the `gh-pages` branch. If the app link shows a 404 page, check `Settings` → `Pages` and choose that branch with `/ (root)` as the folder.

## Quick Start

On this computer:

1. Download or clone this repository.
2. Open the project folder.
3. Double-click `index.html`.
4. Your browser will open the Zoom Loop app.
5. Click `Sample Set` if you want to test it before using your own photos.

No install, build step, or server is required for desktop use.

## Add Your Photos

Use at least two images.

1. Click `Add Images`.
2. Select multiple photos from your computer, iPhone Photos, or Android Gallery.
3. The images appear in the `Image Stack` panel on the right.
4. Use `Up`, `Dn`, and `X` to reorder or remove images.

Click `Auto Sort` to let the app reorder three or more photos by similar color, brightness, contrast, and saturation. This usually makes the zoom loop easier to blend because each photo transitions into a more visually related next photo.

The order matters:

- Image 1 zooms into Image 2.
- Image 2 zooms into Image 3.
- The last image zooms back into Image 1.

You can also drag image files onto the `Add Images` box.

Supported formats include JPG/JPEG, PNG, WebP, GIF, BMP, AVIF, HEIC, and HEIF. The app converts each loaded photo into an internal square canvas before rendering the loop. If a HEIC or HEIF photo does not open, load the app while online once so the converter can load, or save/export the photo as JPEG or PNG and add it again.

Use `Frame` beside a photo to move its square crop, zoom in, or rotate it in 90° steps. The preview outline marks the central area visible at a loop handoff. `Apply frame` updates that photo and rebuilds its joins; `Cancel` or Escape discards the draft. You can recover the other edges of the uploaded photo by reopening Frame, rather than cropping an already cropped result. Picked portal positions stay in place.

## Save Your Work

`Save Project` downloads a `.zoomloop` file containing the photo order, render settings, timeline position, and all picked portals. `Open Project` restores that file, including its photos, without uploading anything or requiring internet. A successful open replaces the current stack and leaves playback paused; save the current project first if you want to keep it.

Projects contain the lossless 1024×1024 working square photos. New uploads also include a framing copy with the original aspect ratio, capped at 2048 pixels on its longest side, so you can adjust the crop after reopening offline. These copies preserve the full composition but do not replace your full-resolution original files; keep your originals separately. Older project files still open, but can only reframe their saved square photos. Projects support up to 200 photos and 200 MB. Invalid or unsupported files leave the current project intact. Refreshing the app still clears the working stack unless you save and reopen a project.

## Make The Loop

Click the large play button in the middle of the preview, or click `Play` in the top bar.

Use the timeline slider along the bottom to scrub through the loop by hand. The readout beside it shows the current time and the full video length.

## Main Controls

`Mode`
Choose `Photo Blend` for a concealed image whose detail gradually emerges, or `Stitched World` for a fixed nested scene.

Photo Blend grows each photo out of its surroundings. When it first appears it is only its color and light inside the surrounding texture. Its own form then grows as soft blobs out of the areas that already match the surroundings in color and light, spreading until they join; its border stays softly camouflaged until the photo nearly fills the screen, so it becomes a square only at the very end. Each part shows one photo or the other, never both at half strength. Meanwhile the photo is lit like the area around it (a soft per-region color and brightness match) and returns to its true lighting before it fills the screen. Around every embedded photo, fine texture switches to the surrounding photo's own material right at the edge while light and color blend over a wider area, so there is no blurred ring, streaks, or mirrored copy. Stitched World prepares each join locally before playback, blending fine detail across a narrow region and lighting/color across a wider region. Photos and joins stay fixed while the camera zooms; there is no time-dependent reveal. Only the supplied photos are used, and nothing is sent to a generation service.

Stitched World works best when neighboring photos share textures, colors, or composition. Its organic seam follows a closed path through regions with lower detail and color mismatch. Fine detail returns to the parent's material outside the inserted photo, while lighting blends across a wider area, reducing long streaks from stretched edges. Different subjects can still look like a collage; local blending cannot invent connecting scenery. Use `Auto Tune` to arrange photos and choose insertion points, then `Place Manually` to refine individual joins. Cinematic reveal, grain, symmetry, and alignment are available in Photo Blend only.

Nested photos are drawn in the preview's pixel grid and copied at their actual projected size. Growing a render buffer no longer changes the photo's sampling scale. Consistent bilinear filtering avoids a separate sharpening jump when an image crosses its original resolution. These changes improve playback and exports without moving the prepared joins.

`Video size`
Changes the export and preview resolution. Higher values look sharper but render and export slower.

Every slider shows its current value next to its name, with a one-line explanation underneath.

## Speed & Length

`Time per photo`
How many seconds the zoom takes to travel from one photo into the next, from 1 to 15 seconds. The preview and the exported video use the same timing.

`Frame rate`
24, 30, or 60 frames per second. Higher is smoother, but makes exports take longer and the file larger.

The summary under these controls shows the resulting video length, for example `Video length 0:30.0 · 6 photos × 5.0 s · 900 frames at 30 fps`. Projects saved before this control existed open with the equivalent time per photo.

## Photo Placement

`Reset to Defaults`
Loads a safer starting setup for smoother transitions. Use this when the sliders start fighting each other or the portal looks distorted.

`Auto Tune`
Applies `Reset to Defaults`, clears old picked portal points, and sorts the image stack when there are three or more photos. This is the quickest way to let the app choose a cleaner automated setup.

`Auto Cinematic`
Builds on `Auto Tune` and also turns on `Cinematic mode`, keeping the embedded texture concealed longer and slowing the zoom.

`Place Manually`
Opens the placement editor for the join at the timeline position. The preview freezes on the start of that join and draws the next photo where it will appear:

- A dashed box is the automatic spot; a solid box is your own.
- Green dots mark spots where the next photo's colors and texture blend well. Bigger, brighter dots blend better.
- Drag anywhere on the preview (with a finger or mouse) to move the box. When you let go, the strip under the preview shows four moments of the zoom with their times, so you can judge the result without playing the loop.
- The rating beside the title compares your spot with the automatic one, from `Blends as well as the auto spot` to `Poor blend: edges will show`.
- `Play this zoom` plays only this join, then returns to the editor. `‹ Prev` and `Next ›` move between joins. `Use auto spot` removes your pick. `Done` closes the editor.

`Use Auto Spot`
Removes the picked point for the current join and goes back to `Auto place` or the fixed spot sliders.

`Smooth guard`
Softens extreme slider combinations. Leave this on for cleaner transitions, or turn it off when you want harsher pixel or symmetry effects.

`Cinematic reveal` (under `Effects`)
Keeps the parent texture and color longer before the child photo emerges, with a slower growth and softer, dreamier edges. Both modes use continuous zoom motion and restore the original photo colors at the handoff.

`Start size`
How large the next photo is inside the current one when its zoom begins, from 1% to 34%. Smaller hides it better and zooms deeper. In the placement editor, a box too small to see is drawn larger and labelled `shown larger`.

`Auto place`
Compares color, texture, and edge direction at two scales, emphasizing the central crop of the next photo that will actually be visible. It also checks contrast around the insertion boundary and camera travel. Candidates stay inside the visible source crop, with room for the photo's size. The best central candidate wins unless an off-center candidate reduces the visual mismatch by at least 20% and an absolute score margin. On ambiguous or featureless photos, it favors staying centered.

The placement readout explains the decision for the current transition and shows the point's location. It distinguishes a balanced automatic choice, a stronger off-center match, manual sliders, and a picked override. This is pixel-based matching, not face or object recognition; use `Place Manually` to protect a particular subject.

`Spot across` and `Spot down`
Move the portal left/right and up/down inside the current image when `Auto place` is off.

## Blending

`Color match`
Controls how strongly the small embedded photo borrows the parent region's color and texture. The default of 100 hides most of the new photo's structure at a distance; its detail and original colors return as you zoom in.
In Stitched World, this controls color matching around the fixed join; the central photo remains unchanged.

`Color area`
Changes the scale used to separate photo detail from lighting and color during texture blending.

`Edge softness`
Controls the feather outside the embedded photo. The extension softens into the surrounding pixels and moves out of view during the zoom, without turning into an opaque square.

`Organic edge`
In Photo Blend, sets how much the next photo grows out of areas that already match its surroundings (high) rather than spreading evenly from its middle (low). It also varies the feather along the surrounding texture to reduce a regular geometric outline. It does not distort the photo itself.

## Effects

These Photo Blend effects are in the collapsible `Effects` section.

`Film grain`
Adds fine noise to the embedded texture. Leave this at zero for clean photographic blending.

`Kaleidoscope`
Folds the hidden image into mirrored sectors, creating a more fractal or kaleidoscopic portal.

`Fold angle`
Rotates the kaleidoscope fold so you can line it up with lines, faces, windows, texture, or other details in the parent photo.

## Export

`PNG`
Saves the current frame as `zoom-loop-frame.png`. On iPhone and iPad it opens the share sheet; choose `Save Image` to add it to Photos. On Android and computers it downloads (on Android, to the Gallery's Download album).

`Share`
Opens the phone or computer share sheet with the current PNG frame when supported, to save or send it through Photos, Gallery, Files, Messages, or other apps.

`Video`
Exports one full loop. On current browsers (Chrome and Edge on computers and Android, and Safari on iPhone with iOS 16.4 or later) the app renders and encodes every frame one at a time as an H.264 MP4, so the video is complete and smooth even when a phone renders slower than real time. On a phone, export can take longer than the video itself; the status shows progress, and the screen is kept awake. Keep Zoom Loop open until it finishes, because phones pause pages that leave the screen. If a phone cannot encode the chosen size, the app exports the largest size it can and says so. Older browsers fall back to real-time recording (MP4 when supported, otherwise WebM).

Where the video goes:

- Computer: an ordinary download.
- Android: an ordinary download to Downloads, which appears in your Gallery's Download album (and in Google Photos under Photos on device). A `Share video` button then lets you send it to an app.
- iPhone and iPad: Safari downloads go to the Files app, not Photos, so a `Save video` button appears when the export finishes. Tap it, then choose `Save Video` to add it to Photos. (Browsers only open the share sheet straight from a tap, and the export takes longer than that allows.) If you cancel the sheet, the button stays so you can try again. Without file sharing, the video goes to Files › Downloads; open it there and use Share › Save Video.

Export shows preparation and recording progress. `Cancel export` discards the partial recording. Completing, cancelling, or failing an export restores the original playhead and playback state, and releases canvas recording resources. If the preview itself cannot render, playback pauses and reports the failure. PNG and frame sharing errors also report a message instead of silently hanging. Image uploads pause playback and lock conflicting controls until decoding finishes. An unknown frame rate falls back to 30 fps; a failed HEIC converter download can be retried.

Video recording depends on your browser. If recording does not work, try Microsoft Edge or Chrome. On iPhone, some browsers may save video to Files instead of directly to Photos.

## Tips

- Start with 3 to 6 photos.
- Square images work best. Use `Frame` to choose which part of a rectangular photo appears, especially when the subject is near an edge.
- Put visually similar photos next to each other for smoother transitions.
- Use `Auto Sort` first if you are not sure which order is best.
- Use `Auto Tune` when you want the app to handle the order and smoother dial setup for you.
- Use `Auto Cinematic` when you want the smoothest and most film-like default look.
- Use `Reset to Defaults` when the transition starts looking warped.
- Use `Place Manually` on only the transitions that still need a better zoom point.
- Put very different photos next to each other for a more surreal jump.
- If the hidden portal is too obvious, reduce `Start size`, increase `Color match` or `Edge softness`, and keep `Film grain` at zero.
- Leave `Auto place` on for frame-aware choices. Use `Place Manually` when you intentionally want a more adventurous off-center move.
- If the zoom feels too slow or too fast, change `Time per photo`.

## Troubleshooting

If nothing happens when you open `index.html`, try a different modern browser such as Edge or Chrome.

If you only see one image, add at least one more photo. The loop needs two or more images.

If the exported video is too large, lower `Video size`, `Time per photo`, or `Frame rate`.

If the app feels slow, use fewer photos or lower the `Video size`.

If the app does not show an install option, make sure you opened it from an HTTPS link instead of directly from a local file.

If phone photos do not upload, refresh the app first so the newest offline cache loads. iPhone HEIC/HEIF photos can be converted by the app when online, but JPEG or PNG is the most reliable fallback on any phone.

## Renderer checks

With Node.js and Playwright available, run `node tests/renderer.spec.cjs`. Set `ZOOM_BROWSER` to a Chromium browser executable if Playwright's browser is not installed. Optional `ZOOM_TEST_PHOTOS` accepts a JSON array of local photo paths for visual checks. The suite covers both modes, 48 segment endpoint comparisons plus all four output resolutions and four comparisons after framing edits, fixed scene appearance, uploads, extreme color/texture fixtures, portrait and panorama crops, camera continuity, framing-aware placement, destination visibility, automatic controls, scrubbing, the placement editor (dragging, filmstrip, join navigation), playback, PNG/video export (frame-by-frame H.264 and the real-time fallback), saving to Photos on phones through the share sheet, cancellation, rendering and recorder failure cleanup, converter retries, numeric input limits, mobile layout, and offline loading. Project checks verify exact photo pixels, settings, order and picks after saving and reopening offline, plus rejection of malformed files without changing the current stack. Framing checks cover recovering original edges, quarter-turn rotations, zoom, cancellation, offline framing copies, legacy projects, decoder fallback, and mobile editor layout. Results and a Stitched World contact sheet are written to the ignored `test-results/` directory. `node tests/export-engines.cjs` exports a short loop in Chromium, Firefox, and WebKit when Playwright has them installed, and checks each file decodes at the right size and length. `node tests/seam-quality.cjs` scores how visible each join is on the photos in `test-results/photos` (color step, blurred ring, streaks, and double exposure), times preparing each join and drawing a frame, and writes contact sheets. The photo checks were run on twelve varied, freely licensed photos: macro flowers, a parrot, a cathedral interior, a waterfall, city streets by day and night, snowy mountains, desert dunes, a reef fish, an autumn forest, and an owl.

For a varied real-photo run, set `ZOOM_TEST_PHOTOS` to a JSON array of at least four local photo paths and run `node tests/photo-scenes.spec.cjs`. It checks nine profiles in both modes, every segment handoff and its approach, render-buffer boundaries, fractional raster steps, and the feather leaving the viewport. `ZOOM_CHECK_BUCKETS=1` enforces the buffer-boundary checks; `ZOOM_SCENE_VIDEO=1` also records and decodes a full loop. The suite reads separate pixel snapshots so measurement does not change preview filtering. Results and contact sheets stay in `test-results/`; the test does not fetch or publish photos.
