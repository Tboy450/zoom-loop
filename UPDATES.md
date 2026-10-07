# Update checklist

Work in progress, in order. Each finished item is tested and pushed live before it is checked off.

## 1. Sharper zoom at small start sizes

At 1-3% start sizes the old photo is magnified up to 100x, and the app keeps only a 1024 x 1024 working copy, so the last stretch of every transition turns soft. Uploaded photos still have their full-resolution originals.

- [ ] 1.1 Sharp crops from the original photo
  - [ ] Cut two crops around the spot the next photo zooms into (a wider one and a close one), aligned exactly with the working copy, including framing and rotation
  - [ ] Decode the original once per crop set and release it straight away
  - [ ] Fall back to the working copy when there is no original (Sample Set) or it is no larger
  - [ ] Test: the crops line up with the working copy to within a fraction of a pixel
- [ ] 1.2 Draw the crops while zooming
  - [ ] Show a crop only once the photo is magnified enough to look soft, fading it in gradually
  - [ ] Feather its edges, so sharpness changes smoothly rather than as a box
  - [ ] Same drawing for a photo on its own and nested inside another, so handoffs stay pixel-identical
  - [ ] Test: handoffs unchanged; no visible jump when a crop fades in
- [ ] 1.3 Prepare crops with the joins
  - [ ] Find each spot, build its crops, then prepare the join, all during "Preparing"
  - [ ] When scrubbing without preparing, build crops in the background and redraw
  - [ ] Free crops when a spot moves or photos change
- [ ] 1.4 Sharper camouflage and surround: build the blend textures from the crops at small start sizes
- [ ] 1.5 Measure
  - [ ] Add a zoom-sharpness score (fine detail late in each transition) to the seam harness
  - [ ] Compare before and after on the store and mixed photo sets at 1%, 3% and 8%
  - [ ] Before/after video with your store photos
- [ ] 1.6 Push and confirm live

## 2. Placement that tests the actual blend

Auto place scores spots with a fast estimate. Rendering a few of the best spots and keeping the one that measurably blends best is the most direct version of "placed where it blends in best".

- [ ] 2.1 Pick the best few distinct candidate spots for each join
- [ ] 2.2 Score each by rendering small test frames: color and sharpness jumps across the border, double exposure
- [ ] 2.3 Keep the winner as the join's automatic spot (saved in projects; a manual pick still wins)
- [ ] 2.4 Run it from Auto Tune with progress, so ordinary preparing stays fast
- [ ] 2.5 Show "Auto (tested)" in the placement editor
- [ ] 2.6 Measure against today's placement, test, push

## 3. Check on a real phone

- [ ] 3.1 Export a video on the S25 and confirm it lands in the Gallery and plays smoothly start to finish
- [ ] 3.2 Note how long "Preparing" takes with 6 and 12 photos
- [ ] 3.3 Note any stutter during playback at 1080
- [ ] 3.4 Fix what turns up

## 4. Bring the improvements to Stitched World

- [ ] 4.1 Measure Stitched World border scores on all three photo sets
- [ ] 4.2 Grade the border band's light toward the surroundings (fixed, so photos stay unchanged)
- [ ] 4.3 Use the sharp crops in Stitched World too
- [ ] 4.4 Measure, test, push

## 5. Faster preparing on phones

- [ ] 5.1 Move the heavy pixel work (blurs, reveal order, lighting maps, surround) into a background worker
- [ ] 5.2 Keep the app responsive and show progress while joins prepare
- [ ] 5.3 Start playback as soon as the first joins are ready
- [ ] 5.4 Test, push

## 6. Housekeeping

- [ ] 6.1 Quick mode for the photo test suite (a few photos and profiles) for fast checks between steps
- [ ] 6.2 Split the renderer into smaller files (placement, reveal, lighting, drawing)
- [ ] 6.3 Keep README and this checklist current
