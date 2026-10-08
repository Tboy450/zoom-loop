# Update checklist

Work in progress, in order. Each finished item is tested and pushed live before it is checked off.

## 1. Sharper zoom at small start sizes

At 1-3% start sizes the old photo is magnified up to 100x, and the app keeps only a 1024 x 1024 working copy, so the last stretch of every transition turns soft. Uploaded photos still have their full-resolution originals.

- [x] 1.1 Sharp crops from the original photo
  - [x] Cut two crops around the spot the next photo zooms into (a wider one and a close one), aligned exactly with the working copy, including framing and rotation
  - [x] Decode the original once per crop set and release it straight away
  - [x] Fall back to the working copy when there is no original (Sample Set) or it is no larger
  - [x] Test: the crops line up with the working copy to within a fraction of a pixel
- [x] 1.2 Draw the crops while zooming
  - [x] Show a crop only once the photo is magnified enough to look soft, fading it in gradually
  - [x] Feather its edges, so sharpness changes smoothly rather than as a box
  - [x] Same drawing for a photo on its own and nested inside another, so handoffs stay pixel-identical
  - [x] Test: handoffs unchanged; no visible jump when a crop fades in
    (handoffs within 1 level at 1080 and 2160; no frame changes more than its neighbours)
- [x] 1.3 Prepare crops with the joins
  - [x] Find each spot, build its crops, then prepare the join, all during "Preparing"
  - [x] When scrubbing without preparing, build crops in the background and redraw
  - [x] Free crops when a spot moves or photos change
- [x] 1.4 Sharper camouflage and surround: build the blend textures from the crops at small start sizes
  - [x] Each crop fades in only once it is no longer much reduced on screen (no shimmer), and stays out of the photo's softened border band
  - [x] Rebuild a join when its crops arrive
- [x] 1.5 Measure
  - [x] Add a zoom-sharpness score (fine detail late in each transition) to the seam harness
  - [x] Compare before and after on the store and mixed photo sets at 1%, 3% and 8%
    - Full-resolution store photos, crops on vs off: fine detail in the magnified scene +2% at 1%, +6% at 3%, +8% at 8% (up to +21% on single joins); blurred-ring score 7-11% better; border scores within ±5%
    - Mixed set: up to +3% (most of those photos are under 2000 pixels, so there is little extra detail to add)
    - A 12 MP original holds about 3x the working copy's detail, so at 1% the last stretch still softens
  - [x] Before/after video with your store photos (`zoom-loop-sharp-crops-v17-vs-v19.mp4`, 3% start, 3 s per photo; price labels and floor texture stay legible deeper into the zoom)
- [x] 1.6 Push and confirm live (v19)

## 2. Placement that tests the actual blend

Auto place scores spots with a fast estimate. Rendering a few of the best spots and keeping the one that measurably blends best is the most direct version of "placed where it blends in best".

- [x] 2.1 Pick the best few distinct candidate spots for each join (the automatic spot plus the three strongest alternatives at least 12% of the photo apart)
- [x] 2.2 Score each by rendering small test frames (240 px, four stages of the zoom): color and sharpness jumps across the border, color steps around it
  - [x] Replace the automatic spot only when another scores at least 5% better
- [x] 2.3 Keep the winner as the join's automatic spot
  - [x] Saved in projects; used only with the mode, start size and matching it was tested for
  - [x] A manual pick still wins and is never tested over
  - [x] Forgotten when either photo is reframed or removed
- [x] 2.4 Run it from Auto Tune and from its own `Find Best Spots` button, with progress, so ordinary preparing stays fast
- [x] 2.5 Show "auto spot (tested)" in the placement editor and the placement readout
- [x] 2.6 Measure against today's placement, test, push
  - [x] Store photos (full resolution), Photo Blend: square edge -4/-15/-15%, color step -4/-11/-13%, sharpness jump -3/-11/-8% at 1/3/8%
  - [x] Store photos, Stitched World: square edge -2/-10/-12%, color step -2/-8/-10%
  - [x] Detailed set: -1 to -6% at 1-3%; at 8% within ±4% (no clear gain)
  - [x] Tried 320 px test frames: better for Photo Blend at 8%, but lost the Stitched World gains; kept 240 px
  - [x] Timing: 6 full-resolution store photos take about 7 s on a desktop (4 of 6 joins moved); expect a few times longer on a phone
  - [x] Push and confirm live (v20)

## 3. Check on a real phone

Checked by you on the S25 (2026-10-07).

- [x] 3.1 Export a video on the S25 and confirm it lands in the Gallery and plays smoothly start to finish
- [x] 3.2 Note how long "Preparing" takes with 6 and 12 photos
- [x] 3.3 Note any stutter during playback at 1080
- [x] 3.4 Fix what turns up (nothing reported)

## 4. Bring the improvements to Stitched World

- [x] 4.1 Measure Stitched World border scores on all three photo sets (square edge 0.06-0.13, color step 0.07-0.16, sharpness jump 0.19-0.31 from 1% to 16%; close to Photo Blend)
- [x] 4.1b Look into one store pair at the 34% start size whose handoff differs by up to 5 levels in a few pixels
  - Rendered on its own the handoff matches exactly; the difference appears only after other drawings, as the browser changes how it filters canvases (also in v17). Not something the app controls; the photo test allows it and nothing more
- [x] 4.2 Grade the border band's light toward the surroundings
  - Tried grading it further toward the surroundings: square edge only 1-3% better, blurred-ring score 3-11% worse. Reverted; the existing light blend stays
- [x] 4.3 Use the sharp crops in Stitched World too (done with v18/v19: drawn with each photo and used for the stitch)
- [x] 4.4 Measure, test, push (Find Best Spots also improves Stitched World on the store photos: square edge -2/-10/-12% at 1/3/8%)

## 5. Faster preparing on phones (not needed: preparing is not slow on the S25)

Preparing takes about 0.3 s per join on a desktop (blurs, the texture loop and reading canvases back each take a share; the blur is already a fast running sum). On a phone that is likely 1-1.5 s per join. Speeding it up means moving the work into a background worker, a large change, so it waits for the phone timings in 3.2.

- [ ] 5.1 Move the heavy pixel work (blurs, reveal order, lighting maps, surround) into a background worker
- [ ] 5.2 Keep the app responsive and show progress while joins prepare
- [ ] 5.3 Start playback as soon as the first joins are ready
- [ ] 5.4 Test, push

## 6. Housekeeping

- [x] 6.1 Quick mode for the photo test suite (`ZOOM_QUICK=1`: four photos, three profiles) for fast checks between steps
- [ ] 6.2 Split the renderer into smaller files (placement, reveal, lighting, drawing) (deferred: the parts share caches and constants, so splitting is a risky change with nothing to see for it; best done together with the worker in 5.1)
- [x] 6.3 Keep README and this checklist current (updated with every push)

## 7. Next round

- [x] 7.1 Fix the thin square line at twice the photo's size (half-covered pixels along the edge of each photo's drawing layer)
  - [x] Clear those edge pixels after the layer is cut out
  - [x] Test: handoffs unchanged; the line is gone at 1% and 8% (pushed in v21)
- [x] 7.2 Sort by tested blend (tried; today's sort kept)
  - [x] Rendered the likely joins and chose the order by how visible they were: border scores 30-56% better, but sharpness jumps 1.5-3x worse and far more double exposure; on the contact sheets it picked collage-like joins (a shelf photo inside a busy endcap, an aisle inside a cardboard box)
  - [x] Added a double-exposure check to the rendered score and counted today's estimate equally: the same outcome
  - [x] Today's sort, which judges how well the photos' content fits together, gives the more natural joins, so it stays
  - [x] The double-exposure check also made Find Best Spots slightly worse on the detailed set, so v20's scoring stays
- [ ] 7.3 Fractal morphology that blends into the scene (keep the effect, add the missing logic)
  - Origin: the June 1 Symmetry slider folded the hidden photo into mirrored sectors, with only a manual Alignment slider to fit the scene; the October 4 edge reflection around every photo inherited the same straight mirror. The logic below was never there
  - [x] Fold along irregular, self-similar lines instead of the photo's straight edges, so the pattern no longer traces the square or forms mirror ornaments
  - [x] Dissolve with distance: the photo's shapes near its edge, softer farther out, only its color and light at the outer reach (the shapeless bleed)
  - [x] Grade what it carries toward the scene's light and color
  - [x] Reach farther where the photo's colors match the scene, pull back where they clash
  - [x] New "echo" score (how strongly the area around a photo copies it mirrored): 0.38 → 0.03 at 1% on the store photos, 0.20 → 0.02 at 3%, 0.09 → 0.01 at 8%; square-edge scores unchanged (+0-5%)
  - [x] Side-by-side images and video (`zoom-loop-fractal-blend-before-after.mp4`); all tests pass
  - [ ] Your call, then push
- [x] 7.8 Shimmer placement: a second automatic placement style
  - [x] Map where each photo's light shifts (reflections, glare, ripples, glints, streaks, foliage); plain areas low, long straight lines somewhat lower
  - [x] "Auto place looks for: Best match / Shimmer"; Shimmer prefers shimmering spots where the photo's light and color fit, saved in projects
  - [x] New fair score: how much a join adds beyond the scene's own variation (raw border scores count a shimmering scene's own movement against it)
  - [x] On your car scenes and the store photos: the added border drops 14-61% and the added color step 4-58%
  - [x] Test, push (v22)
- [ ] 7.9 Forming that adapts to its spot: on plain surfaces the photo arrives as the surface (muted, later, faint halo); in shimmering areas as now; much darker early on dark surfaces
- [ ] 7.10 Shimmer effect (later): a gentle moving ripple around a forming photo, gone before it fills the screen
- [ ] 7.4 Color harmony slider: gently grade each whole photo toward its neighbours (applied once per photo, so handoffs stay identical)
- [ ] 7.5 Vertical 9:16 export
- [ ] 7.6 Hold on each photo, with a gentle ease in and out
- [ ] 7.7 Zoom-out (reverse) mode

Dropped after discussion: motion blur in exports, soundtrack (CapCut does it), undo, and update 5 (preparing is not slow on the S25).
