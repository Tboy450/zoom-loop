const assert = require("node:assert/strict");

// Find Best Spots renders a few candidate spots per join and keeps the one
// whose join is least visible. Tested spots must be used by the joins,
// shown in the placement editor, kept in projects, never replace a pick,
// apply only to the settings they were tested for, and keep handoffs
// pixel-identical.
module.exports = async function testPlacement(browser, url) {
  const page = await browser.newPage({ serviceWorkers: "block", viewport: { width: 1440, height: 1100 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto(url);
    assert.equal(await page.locator("#bestSpotsButton").isDisabled(), true, "Needs two photos");
    await page.locator("#sampleButton").click();
    await page.waitForFunction(() => !state.isLoading && state.images.length >= 3);
    const began = Date.now();
    await page.locator("#bestSpotsButton").click();
    await page.waitForFunction(() => !state.isPreparing && state.testedSpots.size > 0);
    const seconds = (Date.now() - began) / 1000;
    const result = await page.evaluate(async () => {
      const settings = getSettings();
      const pairs = state.images.map((image, index) => [image, state.images[(index + 1) % state.images.length]]);
      const modes = pairs.map(([from, to]) => getTransition(from, to, settings).placement.mode);
      // Every tested spot is one of that join's candidates.
      const fromCandidates = pairs.every(([from, to]) => {
        const spot = getTestedSpot(from.id, to.id, settings);
        return PhotoZoom.placementCandidates(from.canvas, to.canvas, settings)
          .some(candidate => Math.hypot(candidate.anchorX - spot.anchorX, candidate.anchorY - spot.anchorY) < 1e-9);
      });
      const help = portalHelp.textContent;
      // Handoffs stay pixel-identical with tested spots.
      const size = 480;
      setCanvasSize(size);
      const snapshot = makeCanvas(size, size), snapshotCtx = snapshot.getContext("2d", { willReadFrequently: true });
      const render = (pair, t) => {
        drawTransition(state.images[pair], state.images[(pair + 1) % state.images.length], t, { ...settings, size });
        snapshotCtx.drawImage(previewCanvas, 0, 0);
        return snapshotCtx.getImageData(0, 0, size, size).data;
      };
      let seamMax = 0;
      for (let pair = 0; pair < state.images.length; pair++) {
        const a = render(pair, 1), b = render((pair + 1) % state.images.length, 0);
        for (let i = 0; i < a.length; i++) seamMax = Math.max(seamMax, Math.abs(a[i] - b[i]));
      }
      // The placement editor names the tested spot.
      state.isPickingPortal = true; state.pickIndex = 0;
      const current = { segment: 0, from: state.images[0], to: state.images[1] };
      const editorSpot = getPickSpot(current, settings).mode;
      const editorText = describePickMatch(current, settings).text;
      state.isPickingPortal = false;
      // Another start size has not been tested: back to the estimate.
      const otherSize = getTransition(state.images[0], state.images[1], { ...settings, patch: 0.16 }).placement.mode;
      // A pick wins over a tested spot, and testing again keeps it.
      setPortalOverride(state.images[0].id, state.images[1].id, 0.3, 0.7);
      state.testedSpots.clear();
      invalidateTransitions();
      await findBestSpots();
      const picked = getTransition(state.images[0], state.images[1], settings).placement.mode;
      const pickedTested = state.testedSpots.has(getPairKey(state.images[0].id, state.images[1].id));
      clearPortalOverride(state.images[0].id, state.images[1].id);
      // Projects keep tested spots.
      await findBestSpots();
      const before = JSON.stringify([...state.testedSpots.values()].map(spot => [spot.anchorX, spot.anchorY, spot.key]).sort());
      let saved;
      const originalDownload = downloadBlob;
      downloadBlob = blob => { saved = blob; };
      await saveProject();
      downloadBlob = originalDownload;
      clearImages();
      await openProject(new File([saved], "tested.zoomloop"));
      const after = JSON.stringify([...state.testedSpots.values()].map(spot => [spot.anchorX, spot.anchorY, spot.key]).sort());
      const reopened = getTransition(state.images[0], state.images[1], getSettings()).placement.mode;
      return { count: state.images.length, modes, fromCandidates, help, seamMax, editorSpot, editorText, otherSize,
        picked, pickedTested, before, after, reopened };
    });
    assert.ok(result.modes.every(mode => mode === "tested"), JSON.stringify(result.modes));
    assert.ok(result.fromCandidates, "Tested spots come from the candidates");
    assert.match(result.help, /^Tested every join/);
    assert.ok(result.seamMax <= 3, `Handoffs must stay identical with tested spots: ${result.seamMax}`);
    assert.equal(result.editorSpot, "tested");
    assert.match(result.editorText, /tested/);
    assert.equal(result.otherSize, "auto");
    assert.equal(result.picked, "picked");
    assert.equal(result.pickedTested, false, "A picked join is not tested");
    assert.equal(result.after, result.before, "Projects keep tested spots");
    assert.equal(result.reopened, "tested");
    const shimmer = await testShimmer(page);
    const edges = await testEdgeStyles(page);
    const bars = await testBars(page);
    assert.deepEqual(errors, []);
    return { joins: result.count, seconds: +seconds.toFixed(1), seamMax: result.seamMax, shimmer, edges, bars };
  } finally {
    await page.close();
  }
};

// Shimmer placement rates shifting light (ripples, glints) highly and plain
// areas low, and favors the rippling spot over a plain one of the same color
// much more than Best match does; the setting is kept in projects.
async function testShimmer(page) {
  const result = await page.evaluate(async () => {
    clearImages();
    const make = draw => { const c = makeCanvas(1024, 1024), ctx = c.getContext("2d"); draw(ctx, ctx.createImageData(1024, 1024)); return c; };
    // Left half plain, right half rippling highlights, both averaging the
    // same grey-green; the next photo is a gentle texture of that color.
    const parent = make((ctx, img) => {
      for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) {
        const i = (y * 1024 + x) * 4, ripple = x > 512 ? 45 * Math.sin(x / 9 + 3 * Math.sin(y / 23)) * Math.sin(y / 13 + 2 * Math.cos(x / 31)) : 0;
        img.data[i] = 110 + ripple; img.data[i + 1] = 130 + ripple; img.data[i + 2] = 115 + ripple; img.data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    });
    const child = make((ctx, img) => {
      for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) {
        const i = (y * 1024 + x) * 4, v = 12 * Math.sin(x / 40) * Math.cos(y / 50);
        img.data[i] = 110 + v; img.data[i + 1] = 130 + v; img.data[i + 2] = 115 + v; img.data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    });
    const ratio = style => {
      const settings = { ...getSettings(), placementStyle: style };
      const field = PhotoZoom.matchField(parent, child, settings);
      const near = x => field.reduce((b, p) => Math.hypot(p.anchorX - x, p.anchorY - 0.5) < Math.hypot(b.anchorX - x, b.anchorY - 0.5) ? p : b).match;
      return near(0.62) / near(0.4);
    };
    const settings = getSettings();
    const shimmerRipple = PhotoZoom.spotShimmer(parent, settings, 0.62, 0.5), shimmerPlain = PhotoZoom.spotShimmer(parent, settings, 0.4, 0.5);
    const files = [];
    for (const [n, c] of [[0, parent], [1, child], [2, child]]) files.push(new File([await new Promise(r => c.toBlob(r))], `shimmer-${n}.png`, { type: "image/png" }));
    await loadFiles(files);
    placementStyleInput.value = "shimmer";
    let saved;
    const originalDownload = downloadBlob;
    downloadBlob = blob => { saved = blob; };
    await saveProject();
    downloadBlob = originalDownload;
    placementStyleInput.value = "match";
    await openProject(new File([saved], "shimmer.zoomloop"));
    return { shimmerRipple, shimmerPlain, best: ratio("match"), shimmer: ratio("shimmer"), reopened: placementStyleInput.value };
  });
  assert.ok(result.shimmerRipple > 0.8 && result.shimmerPlain < 0.2, `Ripples shimmer, plain areas do not: ${JSON.stringify(result)}`);
  assert.ok(result.shimmer < result.best * 0.6, `Shimmer placement must favor the rippling spot: ${JSON.stringify(result)}`);
  assert.equal(result.reopened, "shimmer");
  return { rippleVsPlain: { best: +result.best.toFixed(2), shimmer: +result.shimmer.toFixed(2) } };
}

// Each Blend Style edge renders differently around a forming photo, keeps
// handoffs pixel-identical, and is kept in projects; projects saved before
// edge styles open with the plain mirror they were made with.
async function testEdgeStyles(page) {
  const result = await page.evaluate(async () => {
    await createSampleSet();
    const size = 360, frames = {}, seams = {};
    setCanvasSize(size);
    const snapshot = makeCanvas(size, size), snapshotCtx = snapshot.getContext("2d", { willReadFrequently: true });
    const render = (pair, t, settings) => {
      drawTransition(state.images[pair], state.images[(pair + 1) % state.images.length], t, settings);
      snapshotCtx.drawImage(previewCanvas, 0, 0);
      return snapshotCtx.getImageData(0, 0, size, size).data;
    };
    for (const style of ["fractal", "band", "mirror"]) {
      edgeStyleInput.value = style;
      invalidateTransitions();
      const settings = { ...getSettings(), mode: "blend", patch: 0.03, size };
      frames[style] = render(0, 1 - Math.log(0.8 * 0.12) / Math.log(settings.patch), settings);
      let max = 0;
      for (let pair = 0; pair < state.images.length; pair++) {
        const a = render(pair, 1, settings), b = render((pair + 1) % state.images.length, 0, settings);
        for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i] - b[i]));
      }
      seams[style] = max;
    }
    const differ = (a, b) => { let sum = 0; for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]); return sum / a.length; };
    edgeStyleInput.value = "band";
    let saved;
    const originalDownload = downloadBlob;
    downloadBlob = blob => { saved = blob; };
    await saveProject();
    downloadBlob = originalDownload;
    edgeStyleInput.value = "fractal";
    await openProject(new File([saved], "edge.zoomloop"));
    const reopened = edgeStyleInput.value;
    const older = JSON.parse(await saved.text());
    delete older.settings.edgeStyleInput;
    await openProject(new File([JSON.stringify(older)], "older.zoomloop"));
    return { seams, fractalVsMirror: differ(frames.fractal, frames.mirror), bandVsMirror: differ(frames.band, frames.mirror),
      fractalVsBand: differ(frames.fractal, frames.band), reopened, older: edgeStyleInput.value };
  });
  for (const [style, max] of Object.entries(result.seams)) assert.ok(max <= 3, `${style} edge must keep handoffs identical: ${max}`);
  assert.ok(result.fractalVsMirror > 0.01 && result.bandVsMirror > 0.01 && result.fractalVsBand > 0.001, JSON.stringify(result));
  assert.equal(result.reopened, "band");
  assert.equal(result.older, "mirror");
  return { seams: result.seams, fractalVsMirror: +result.fractalVsMirror.toFixed(2) };
}

// Solid bars around the real picture (a vertical video in a landscape
// screenshot, a film still in a vertical one) are framed out on upload;
// photos without paired, perfectly uniform bars keep the plain square crop.
async function testBars(page) {
  const result = await page.evaluate(async () => {
    clearImages();
    // A busy picture: colorful waves with noise, so no row or column is uniform.
    const picture = (ctx, x, y, w, h) => {
      const img = ctx.createImageData(w, h);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const k = (j * w + i) * 4, n = (i * 7919 + j * 104729) % 23;
        img.data[k] = 120 + 80 * Math.sin(i / 17) + n; img.data[k + 1] = 110 + 70 * Math.sin(j / 23) + n; img.data[k + 2] = 130 + 60 * Math.cos((i + j) / 29) + n; img.data[k + 3] = 255;
      }
      ctx.putImageData(img, x, y);
    };
    const photo = (name, width, height, draw) => {
      const c = makeCanvas(width, height), ctx = c.getContext("2d");
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, width, height);
      draw(ctx);
      return new Promise(resolve => c.toBlob(blob => resolve(new File([blob], name, { type: "image/png" }))));
    };
    const files = [
      // Vertical video in a landscape screenshot: bars left and right.
      await photo("pillarbox.png", 1600, 900, ctx => picture(ctx, 547, 0, 506, 900)),
      // Film still in a vertical screenshot: bars above and below.
      await photo("letterbox.png", 900, 1600, ctx => picture(ctx, 0, 547, 900, 506)),
      // An ordinary photo.
      await photo("plain.png", 1200, 800, ctx => picture(ctx, 0, 0, 1200, 800)),
      // A dark sky along the top only: not a pair of bars.
      await photo("dark-top.png", 1200, 800, ctx => picture(ctx, 0, 240, 1200, 560))
    ];
    await loadFiles(files);
    // Darkest column and row of each working square: bars left in would be black.
    return state.images.map(image => {
      const data = image.canvas.getContext("2d").getImageData(0, 0, 1024, 1024).data;
      const columnMean = x => { let s = 0; for (let y = 0; y < 1024; y += 4) { const i = (y * 1024 + x) * 4; s += data[i] + data[i + 1] + data[i + 2]; } return s / 768; };
      const rowMean = y => { let s = 0; for (let x = 0; x < 1024; x += 4) { const i = (y * 1024 + x) * 4; s += data[i] + data[i + 1] + data[i + 2]; } return s / 768; };
      return { name: image.name, framing: image.framing || null, edges: [columnMean(2), columnMean(1021), rowMean(2), rowMean(1021)].map(v => Math.round(v)) };
    });
  });
  const byName = Object.fromEntries(result.map(r => [r.name.replace(/\.png$/, ""), r]));
  for (const name of ["pillarbox", "letterbox"]) {
    assert.ok(byName[name].framing, `${name}: bars are framed out`);
    assert.ok(byName[name].edges.every(v => v > 40), `${name}: no black bar left in the square ${JSON.stringify(byName[name])}`);
  }
  assert.equal(byName.plain.framing, null, "An ordinary photo keeps the plain crop");
  assert.equal(byName["dark-top"].framing, null, "A dark area on one side is not a bar");
  return result.map(r => ({ name: r.name, zoom: r.framing ? +r.framing.zoom.toFixed(2) : null }));
}
