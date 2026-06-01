# Zoom Loop

Zoom Loop is a browser app for making recursive photo zoom loops. You add a stack of photos, and the app hides each next photo inside a small **recursive portal** in the current photo. When the loop plays, it zooms into that portal and reveals the next image.

Everything runs in your browser. Your photos are not uploaded to a server.

## Quick Start

On this computer:

1. Download or clone this repository.
2. Open the project folder.
3. Double-click `index.html`.
4. Your browser will open the Zoom Loop app.
5. Click `Sample Set` if you want to test it before using your own photos.

No install, build step, or server is required.

## Use On A Phone

For the easiest iPhone or Android experience, use the app from an HTTPS link such as GitHub Pages.

This repo includes a GitHub Pages workflow. In GitHub, open the repository settings, go to `Pages`, set the source to `GitHub Actions`, then run or push the workflow. After it deploys, open the Pages URL on your phone.

Android:

1. Open the app link in Chrome.
2. Tap `Install` if the app shows the button.
3. If no button appears, open the browser menu and choose `Add to Home screen` or `Install app`.

iPhone or iPad:

1. Open the app link in Safari.
2. Tap the iOS Share button.
3. Choose `Add to Home Screen`.
4. Open `Zoom Loop` from the home screen.

The installed app works offline after it has loaded once.

## Add Your Photos

Use at least two images.

1. Click `Add Images`.
2. Select multiple photos from your computer, iPhone Photos, or Android Gallery.
3. The images appear in the `Image Stack` panel on the right.
4. Use `Up`, `Dn`, and `X` to reorder or remove images.

The order matters:

- Image 1 zooms into Image 2.
- Image 2 zooms into Image 3.
- The last image zooms back into Image 1.

You can also drag image files onto the `Add Images` box.

## Make The Loop

Click the large play button in the middle of the preview, or click `Play` in the top bar.

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

`Auto place`
Turns on automatic portal placement. The app scans the current photo and chooses the area whose color, brightness, and contrast best match the next photo. This can choose off-center zoom points.

`Anchor X` and `Anchor Y`
Move the portal left/right and up/down inside the current image when `Auto place` is off.

`Color bind`
Controls how strongly the hidden photo borrows color from the parent image. Higher values make the hidden photo blend more into the pixels around it.

`Sample blend`
Softens how the hidden image is sampled and fades the portal edge into the parent image. Raise this when the hidden image looks pasted on or too harsh.

`Edge blend`
Adds an extended feather around the portal. The feather gets wider as the portal grows on screen, which helps hide the square edge late in the zoom.

`Shape morph`
Starts the portal feather as a more circular frame, then lets it become rectangular as it grows to fit the full image.

`Pixel grain`
Makes the hidden portal more blocky and pixel-like before the zoom reveals it.

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

Video recording depends on your browser. If recording does not work, try Microsoft Edge or Chrome. On iPhone, some browsers may save video to Files instead of directly to Photos.

## Tips

- Start with 3 to 6 photos.
- Square images work best, but the app will crop rectangular photos into a square.
- Put visually similar photos next to each other for smoother transitions.
- Put very different photos next to each other for a more surreal jump.
- If the hidden portal is too obvious, increase `Color bind`, `Sample blend`, `Edge blend`, or `Pixel grain`.
- If the center zoom is boring, turn on `Auto place` to let the app search for a better off-center match.
- If the zoom feels too slow or too fast, adjust `Zoom speed` first.

## Troubleshooting

If nothing happens when you open `index.html`, try a different modern browser such as Edge or Chrome.

If you only see one image, add at least one more photo. The loop needs two or more images.

If the exported video is too large, lower `Canvas`, `Frames`, or `FPS`.

If the app feels slow, use fewer photos or lower the `Canvas` size.

If the app does not show an install option, make sure you opened it from an HTTPS link instead of directly from a local file.
