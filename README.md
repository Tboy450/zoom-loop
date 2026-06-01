# Zoom Loop

Zoom Loop is a browser-based prototype for making recursive zoom art from uploaded photos.
Add two or more images, tune the microcosm placement and color binding, preview the loop, then export a still PNG or record a WebM clip.

## Run

Open `index.html` in a modern browser.

No build step or server is required.

## How It Works

Each transition treats the current photo as a world. The next photo is embedded inside a small patch of that world and recolored from the local parent pixels. The renderer then animates a camera crop into that patch, revealing the embedded photo as the next full-frame world.

Core controls:

- `Patch size`: how much of the parent image contains the next image.
- `Anchor X/Y`: where the hidden microcosm sits in the parent image.
- `Color bind`: how strongly the next image borrows the parent patch color.
- `Pixel grain`: how blocky and pixel-like the hidden image feels before zooming in.
- `Frames`: still frames per image-to-image transition.

## Export

- `PNG` downloads the current preview frame.
- `WebM` records one full loop from the canvas.

Video export uses the browser `MediaRecorder` API, so output format support depends on the browser.
