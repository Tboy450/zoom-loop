# Zoom Loop

Zoom Loop is a browser app for making recursive photo zoom loops. You add a stack of photos, and the app hides each next photo inside a small **recursive portal** in the current photo. When the loop plays, it zooms into that portal and reveals the next image.

Everything runs in your browser. Your photos are not uploaded to a server.

## Quick Start

1. Download or clone this repository.
2. Open the project folder.
3. Double-click `index.html`.
4. Your browser will open the Zoom Loop app.
5. Click `Sample Set` if you want to test it before using your own photos.

No install, build step, or server is required.

## Add Your Photos

Use at least two images.

1. Click `Add Images`.
2. Select multiple photos from your computer.
3. The images appear in the `Image Stack` panel on the right.
4. Use `Up`, `Dn`, and `X` to reorder or remove images.

The order matters:

- Image 1 zooms into Image 2.
- Image 2 zooms into Image 3.
- The last image zooms back into Image 1.

You can also drag image files onto the `Add Images` box.

## Make The Loop

Click `Play` to preview the animation.

Use the timeline slider along the bottom to scrub through the loop by hand.

## Main Controls

`Canvas`
Changes the export and preview resolution. Higher values look sharper but render slower.

`Frames`
Controls how many frames each photo-to-photo transition uses. More frames make smoother exports.

`FPS`
Controls the video frame rate for WebM export.

`Zoom speed`
Controls how fast the preview and WebM export move through each recursive portal.

## Recursive Portal Controls

`Patch size`
Changes how large the hidden portal is inside the current image.

`Anchor X` and `Anchor Y`
Move the portal left/right and up/down inside the current image.

`Color bind`
Controls how strongly the hidden photo borrows color from the parent image. Higher values make the hidden photo blend more into the pixels around it.

`Pixel grain`
Makes the hidden portal more blocky and pixel-like before the zoom reveals it.

`Symmetry`
Folds the hidden image into mirrored sectors, creating a more fractal or kaleidoscopic portal.

`Alignment`
Rotates the symmetry fold so you can line it up with lines, faces, windows, texture, or other details in the parent photo.

## Export

`PNG`
Downloads the current canvas frame as `zoom-loop-frame.png`.

`WebM`
Records one full loop and downloads it as `zoom-loop.webm`.

WebM recording depends on your browser. If recording does not work, try Microsoft Edge or Chrome.

## Tips

- Start with 3 to 6 photos.
- Square images work best, but the app will crop rectangular photos into a square.
- Put visually similar photos next to each other for smoother transitions.
- Put very different photos next to each other for a more surreal jump.
- If the hidden portal is too obvious, increase `Color bind` or `Pixel grain`.
- If the zoom feels too slow or too fast, adjust `Zoom speed` first.

## Troubleshooting

If nothing happens when you open `index.html`, try a different modern browser such as Edge or Chrome.

If you only see one image, add at least one more photo. The loop needs two or more images.

If the exported video is too large, lower `Canvas`, `Frames`, or `FPS`.

If the app feels slow, use fewer photos or lower the `Canvas` size.
