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
    assert.deepEqual(errors, []);
    return { joins: result.count, seconds: +seconds.toFixed(1), seamMax: result.seamMax };
  } finally {
    await page.close();
  }
};
