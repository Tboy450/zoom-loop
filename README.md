# Zoom Loop

Zoom Loop is a browser app for making recursive photo zoom loops. You add a stack of photos, and the app hides each next photo inside a small **recursive portal** in the current photo. When the loop plays, it zooms into that portal and reveals the next image.

Everything runs in your browser. Your photos are not uploaded to a server.

The effect is built from the photos you add. Each pair gets a texture-aware insertion point, a small embedded version that borrows the surrounding photo's material, and a feather outside the image boundary. As the camera moves closer, the next photo's detail and original color emerge in the same place. Nested photos are carried through the handoff, including the last-to-first transition, with continuous zoom speed.

Automatic placement is on by default, with an embedded frame 8% of the photo width (down from 12%), strong color binding, and no added grain. The camera uses the central 80% of each normalized square photo so the blend boundary passes outside the screen before the handoff. Very different subjects can still produce a visible change of scene; the compositor blends existing pixels and does not invent matching objects or scenery. Use `Pick Portal` if an automatic placement lands on an important subject.

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

## Save Your Work

`Save Project` downloads a `.zoomloop` file containing the photo order, render settings, timeline position, and all picked portals. `Open Project` restores that file, including its photos, without uploading anything or requiring internet. A successful open replaces the current stack and leaves playback paused; save the current project first if you want to keep it.

Projects contain the lossless 1024×1024 working square photos, rather than the full original files. Keep your originals separately for future cropping or editing. Projects support up to 200 photos and 200 MB. Invalid or unsupported files leave the current project intact. Refreshing the app still clears the working stack unless you save and reopen a project.

## Make The Loop

Click the large play button in the middle of the preview, or click `Play` in the top bar.

Use the timeline slider along the bottom to scrub through the loop by hand.

## Main Controls

`Mode`
Choose `Photo Blend` for a concealed image whose detail gradually emerges, or `Stitched World` for a fixed nested scene. Stitched World prepares each join locally before playback, blending fine detail across a narrow region and lighting/color across a wider region. Photos and joins stay fixed while the camera zooms; there is no time-dependent reveal. Only the supplied photos are used, and nothing is sent to a generation service.

Stitched World works best when neighboring photos share textures, colors, or composition. Different subjects can still look like a collage; local blending cannot invent connecting scenery. Use `Auto Tune` to arrange photos and choose insertion points, then `Pick Portal` to refine individual joins. Cinematic reveal, grain, symmetry, and alignment are available in Photo Blend only.

`Canvas`
Changes the export and preview resolution. Higher values look sharper but render slower.

`Frames`
Controls how many frames each photo-to-photo transition uses. More frames make smoother exports.

`FPS`
Controls the video frame rate for WebM export.

`Zoom speed`
Controls how fast the preview and WebM export move through each recursive portal.

## Recursive Portal Controls

`Smooth Defaults`
Loads a safer starting setup for smoother transitions. Use this when the sliders start fighting each other or the portal looks distorted.

`Auto Tune`
Applies `Smooth Defaults`, clears old picked portal points, and sorts the image stack when there are three or more photos. This is the quickest way to let the app choose a cleaner automated setup.

`Auto Cinematic`
Builds on `Auto Tune` and also turns on `Cinematic mode`, keeping the embedded texture concealed longer and slowing the zoom.

`Pick Portal`
Lets you click the preview to choose the zoom point for the current photo-to-photo transition. Move the timeline to the transition you want, click `Pick Portal`, then click the spot in the preview where the next photo should hide.

`Clear Pick`
Removes the clicked portal point for the current transition and goes back to `Auto place` or the manual anchor sliders.

`Smooth guard`
Softens extreme slider combinations. Leave this on for cleaner transitions, or turn it off when you want harsher pixel or symmetry effects.

`Cinematic mode`
Keeps the parent texture and color longer before the child photo emerges. Both modes use continuous zoom motion and restore the original photo colors at the handoff.

`Patch size`
Changes how large the hidden portal is inside the current image.

`Auto place`
Compares color, texture, and edge direction at two scales, emphasizing the central crop of the next photo that will actually be visible. It also checks contrast around the insertion boundary and camera travel. Candidates stay inside the visible source crop, with room for the photo's size. The best central candidate wins unless an off-center candidate reduces the visual mismatch by at least 20% and an absolute score margin. On ambiguous or featureless photos, it favors staying centered.

The placement readout explains the decision for the current transition and shows the point's location. It distinguishes a balanced automatic choice, a stronger off-center match, manual sliders, and a picked override. This is pixel-based matching, not face or object recognition; use `Pick Portal` to protect a particular subject.

`Anchor X` and `Anchor Y`
Move the portal left/right and up/down inside the current image when `Auto place` is off.

`Color bind`
Controls how strongly the small embedded photo borrows the parent region's color and texture. The default of 100 hides most of the new photo's structure at a distance; its detail and original colors return as you zoom in.
In Stitched World, this controls color matching around the fixed join; the central photo remains unchanged.

`Sample blend`
Changes the scale used to separate photo detail from lighting and color during texture blending.

`Edge blend`
Controls the feather outside the embedded photo. The extension softens into the surrounding pixels and moves out of view during the zoom, without turning into an opaque square.

`Organic edge`
Varies the feather along the surrounding texture to reduce a regular geometric outline. It does not distort the photo itself.

`Pixel grain`
Adds fine noise to the embedded texture. Leave this at zero for clean photographic blending.

`Symmetry`
Folds the hidden image into mirrored sectors, creating a more fractal or kaleidoscopic portal.

`Alignment`
Rotates the symmetry fold so you can line it up with lines, faces, windows, texture, or other details in the parent photo.

## Export

`PNG`
Downloads the current canvas frame as `zoom-loop-frame.png`.

`Share`
Opens the phone or computer share sheet with the current PNG frame when supported. On phones, use this to save or send the image through Photos, Gallery, Files, Messages, or other apps.

`Video`
Records one full loop. The app uses MP4 when the browser supports it, otherwise WebM. If sharing files is supported, it opens the native share sheet; otherwise it downloads the video.

Export shows preparation and recording progress. `Cancel export` discards the partial recording. Completing, cancelling, or failing an export restores the original playhead and playback state, and releases canvas recording resources. If the preview itself cannot render, playback pauses and reports the failure. PNG and frame sharing errors also report a message instead of silently hanging. Image uploads pause playback and lock conflicting controls until decoding finishes. Invalid frame and FPS values fall back to safe limits; a failed HEIC converter download can be retried.

Video recording depends on your browser. If recording does not work, try Microsoft Edge or Chrome. On iPhone, some browsers may save video to Files instead of directly to Photos.

## Tips

- Start with 3 to 6 photos.
- Square images work best, but the app will crop rectangular photos into a square.
- Put visually similar photos next to each other for smoother transitions.
- Use `Auto Sort` first if you are not sure which order is best.
- Use `Auto Tune` when you want the app to handle the order and smoother dial setup for you.
- Use `Auto Cinematic` when you want the smoothest and most film-like default look.
- Use `Smooth Defaults` when the transition starts looking warped.
- Use `Pick Portal` on only the transitions that still need a better zoom point.
- Put very different photos next to each other for a more surreal jump.
- If the hidden portal is too obvious, reduce `Patch size`, increase `Color bind` or `Edge blend`, and keep `Pixel grain` at zero.
- Leave `Auto place` on for frame-aware choices. Use `Pick Portal` when you intentionally want a more adventurous off-center move.
- If the zoom feels too slow or too fast, adjust `Zoom speed` first.

## Troubleshooting

If nothing happens when you open `index.html`, try a different modern browser such as Edge or Chrome.

If you only see one image, add at least one more photo. The loop needs two or more images.

If the exported video is too large, lower `Canvas`, `Frames`, or `FPS`.

If the app feels slow, use fewer photos or lower the `Canvas` size.

If the app does not show an install option, make sure you opened it from an HTTPS link instead of directly from a local file.

If phone photos do not upload, refresh the app first so the newest offline cache loads. iPhone HEIC/HEIF photos can be converted by the app when online, but JPEG or PNG is the most reliable fallback on any phone.

## Renderer checks

With Node.js and Playwright available, run `node tests/renderer.spec.cjs`. Set `ZOOM_BROWSER` to a Chromium browser executable if Playwright's browser is not installed. Optional `ZOOM_TEST_PHOTOS` accepts a JSON array of local photo paths for visual checks. The suite covers both modes, 48 segment endpoint comparisons plus all four output resolutions, fixed scene appearance, uploads, extreme color/texture fixtures, portrait and panorama crops, camera continuity, framing-aware placement, destination visibility, automatic controls, scrubbing, portal picking, playback, PNG/video export, cancellation, rendering and recorder failure cleanup, converter retries, numeric input limits, mobile layout, and offline loading. Project checks verify exact photo pixels, settings, order and picks after saving and reopening offline, plus rejection of malformed files without changing the current stack. Results and a Stitched World contact sheet are written to the ignored `test-results/` directory.
