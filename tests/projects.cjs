const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

module.exports = async function testProjects(browser, url, fixtures, output) {
  const page = await browser.newPage({ serviceWorkers: "block" });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto(url);
    assert.equal(await page.locator("#saveProjectButton").isDisabled(), true);
    await page.locator("#fileInput").setInputFiles(fixtures.slice(0, 3));
    await page.waitForFunction(() => !state.isLoading && state.images.length === 3);
    await page.evaluate(() => {
      renderModeInput.value = "stitched";
      patchInput.value = "14"; edgeBlendInput.value = "71";
      autoAnchorInput.checked = false;
      durationInput.value = "7.5"; fpsInput.value = "60";
      moveImage(0, 1);
      state.progress = 0.43;
      state.portalOverrides.set(getPairKey(state.images[0].id, state.images[1].id), { anchorX: 0.32, anchorY: 0.61 });
      // A pick on a currently nonadjacent pair must survive saving, too.
      state.portalOverrides.set(getPairKey(state.images[1].id, state.images[0].id), { anchorX: 0.8, anchorY: 0.4 });
      drawCurrentFrame();
      window.snapshot = async () => ({
        photos: await Promise.all(state.images.map(async image => ({ name: image.name, width: image.width, height: image.height,
          hash: Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", image.canvas.getContext("2d").getImageData(0, 0, 1024, 1024).data))).join(",") }))),
        settings: getSettings(), progress: state.progress,
        portals: [...state.portalOverrides].map(([key, point]) => ({
          pair: key.split("->").map(id => state.images.findIndex(image => image.id === id)), ...point
        }))
      });
    });
    const before = await page.evaluate(() => snapshot());
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#saveProjectButton").click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), "zoom-loop.zoomloop");
    const projectPath = path.join(output, "test-project.zoomloop");
    await download.saveAs(projectPath);
    await page.waitForFunction(() => !state.isPreparing);
    const saved = JSON.parse(fs.readFileSync(projectPath, "utf8"));
    assert.equal(saved.format, "zoom-loop");
    assert.equal(saved.settings.durationInput, "7.5");
    assert.equal(saved.settings.fpsInput, "60");
    await page.locator("#clearButton").click();
    await page.context().setOffline(true);
    await page.locator("#projectFileInput").setInputFiles(projectPath);
    await page.waitForFunction(() => !state.isLoading && state.images.length === 3);
    assert.deepEqual(await page.evaluate(() => snapshot()), before, "Project round trips must preserve exact photo pixels, settings, order, progress, and picks offline");
    assert.match(await page.locator("#projectHelp").textContent(), /Opened 3 photos/);
    const ids = await page.evaluate(() => state.images.map(image => image.id));
    const invalidProjects = [
      "not json",
      JSON.stringify({ ...saved, version: 999 }),
      JSON.stringify({ ...saved, settings: { ...saved.settings, patchInput: "NaN" } }),
      JSON.stringify({ ...saved, portals: [{ from: 99, to: 0, anchorX: 0.5, anchorY: 0.5 }] }),
      // Valid PNG header but broken compressed pixels: fail after staging another photo.
      JSON.stringify({ ...saved, images: [saved.images[0], { ...saved.images[1], data: saved.images[1].data.slice(0, 70) + "AAAA" }] }),
      JSON.stringify({ ...saved, images: [saved.images[0], { ...saved.images[1], data: "data:image/png;base64,YmFk" }] }),
      JSON.stringify({ ...saved, images: [{ ...saved.images[0], framing: { x: 2, y: 0.5, zoom: 1, rotation: 0 } }] }),
      JSON.stringify({ ...saved, images: [{ ...saved.images[0], source: "data:image/png;base64,YmFk" }] })
    ];
    for (const content of invalidProjects) {
      await page.locator("#projectFileInput").setInputFiles({ name: "broken.zoomloop", mimeType: "application/json", buffer: Buffer.from(content) });
      await page.waitForFunction(() => !state.isLoading);
      assert.match(await page.locator("#projectHelp").textContent(), /Could not open project/);
      assert.deepEqual(await page.evaluate(() => state.images.map(image => image.id)), ids);
      assert.deepEqual(await page.evaluate(() => snapshot()), before);
      assert.equal(await page.locator("#saveProjectButton").isDisabled(), false);
    }
    // Projects saved before seconds-per-photo stored frames and a zoom speed.
    const legacySettings = { ...saved.settings, framesInput: "120", zoomRateInput: "100", fpsInput: "25" };
    delete legacySettings.durationInput;
    await page.locator("#projectFileInput").setInputFiles({ name: "legacy.zoomloop", mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ ...saved, settings: legacySettings })) });
    await page.waitForFunction(() => !state.isLoading && /Opened/.test(projectHelp.textContent));
    assert.deepEqual(await page.evaluate(() => [durationInput.value, fpsInput.value]), ["5", "24"]);
    await page.locator("#projectFileInput").setInputFiles(projectPath);
    await page.waitForFunction(() => !state.isLoading && /Opened/.test(projectHelp.textContent) && durationInput.value === "7.5");
    // A held decode keeps edits locked throughout opening the project.
    await page.evaluate(content => {
      const original = decodeNatively;
      decodeNatively = blob => new Promise(resolve => {
        window.finishProjectOpen = () => { decodeNatively = original; resolve(original(blob)); };
      });
      window.openTask = openProject(new File([content], "held.zoomloop"));
    }, JSON.stringify(saved));
    await page.waitForFunction(() => Boolean(window.finishProjectOpen));
    for (const selector of ["#saveProjectButton", "#openProjectButton", "#fileInput", "#clearButton", "#renderModeInput"]) {
      assert.equal(await page.locator(selector).isDisabled(), true, selector);
    }
    await page.evaluate(() => { clearImages(); removeImage(0); });
    assert.equal(await page.locator("#imageList li").count(), 3);
    await page.evaluate(async () => { finishProjectOpen(); await openTask; });
    assert.deepEqual(await page.evaluate(() => snapshot()), before);

    const saveFailure = await page.evaluate(async () => {
      const canvas = state.images[0].canvas;
      const original = canvas.toDataURL;
      canvas.toDataURL = () => { throw new Error("Test project encoding failure"); };
      await saveProject();
      canvas.toDataURL = original;
      return { message: projectHelp.textContent, busy: isBusy(), count: state.images.length };
    });
    assert.match(saveFailure.message, /Could not save project: Test project encoding failure/);
    assert.equal(saveFailure.busy, false);
    assert.equal(saveFailure.count, 3);
    // Saving pauses playback while encoding, then resumes it.
    await page.locator("#playButton").click();
    await page.waitForFunction(() => state.isPlaying);
    await page.evaluate(async () => { await saveProject(); });
    assert.equal(await page.evaluate(() => state.isPlaying), true);
    await page.locator("#playButton").click();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    return { roundTrip: "exact pixels, order, settings, and picks", offline: "passed", malformedFiles: invalidProjects.length, loadLock: "passed", encodingFailure: "passed", playbackResume: "passed" };
  } finally { await page.close(); }
};
