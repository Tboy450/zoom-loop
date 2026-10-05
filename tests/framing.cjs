const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

module.exports = async function testFraming(browser, url, output) {
  const page = await browser.newPage({ serviceWorkers: "block" });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto(url);
    const data = await page.evaluate(() => [false, true].map(portrait => {
      const source = makeCanvas(portrait ? 1000 : 3000, portrait ? 3000 : 1000);
      const ctx = source.getContext("2d");
      ["#ff0000", "#00ff00", "#0000ff"].forEach((color, index) => {
        ctx.fillStyle = color;
        ctx.fillRect(portrait ? 0 : index * 1000, portrait ? index * 1000 : 0, 1000, 1000);
      });
      return source.toDataURL();
    }));
    await page.locator("#fileInput").setInputFiles(data.map((url, index) => ({
      name: `${index ? "portrait" : "panorama"}.png`, mimeType: "image/png", buffer: Buffer.from(url.split(",")[1], "base64")
    })));
    await page.waitForFunction(() => !state.isLoading && state.images.length === 2);
    const photoPixel = index => page.evaluate(index => Array.from(state.images[index].canvas.getContext("2d").getImageData(512, 512, 1, 1).data), index);
    const previewPixel = () => page.evaluate(() => Array.from(frameCanvas.getContext("2d").getImageData(300, 300, 1, 1).data));
    const open = async index => {
      await page.locator(".frame-button").nth(index).click();
      await page.waitForFunction(() => frameDialog.open && state.isFraming && !state.isPreparing);
    };
    const apply = async () => {
      await page.locator("#frameApplyButton").click();
      await page.waitForFunction(() => !state.isFraming && !frameDialog.open);
    };
    assert.deepEqual(await photoPixel(0), [0, 255, 0, 255]);
    assert.deepEqual(await photoPixel(1), [0, 255, 0, 255]);
    const ids = await page.evaluate(() => state.images.map(image => image.id));
    await page.evaluate(() => state.portalOverrides.set(getPairKey(state.images[0].id, state.images[1].id), { anchorX: 0.35, anchorY: 0.62 }));
    await open(0);
    assert.equal(await page.locator("#frameYInput").isDisabled(), true);
    for (const selector of ["#playButton", "#saveProjectButton", "#openProjectButton", "#fileInput", "#renderModeInput", "#timelineInput", "#clearButton"]) {
      assert.equal(await page.locator(selector).isDisabled(), true, selector);
    }
    await page.evaluate(() => { clearImages(); removeImage(0); moveImage(0, 1); });
    assert.deepEqual(await page.evaluate(() => state.images.map(image => image.id)), ids);
    await page.locator("#frameXInput").fill("0");
    assert.deepEqual(await previewPixel(), [255, 0, 0, 255]);
    // A cancelled draft must leave the working photo untouched.
    await page.locator("#frameCancelButton").click();
    assert.deepEqual(await photoPixel(0), [0, 255, 0, 255]);
    await open(0);
    assert.equal(await page.locator("#frameXInput").inputValue(), "50");
    await page.locator("#frameXInput").fill("0");
    await apply();
    assert.deepEqual(await photoPixel(0), [255, 0, 0, 255]);
    assert.equal(await page.evaluate(() => state.portalOverrides.size), 1);
    assert.deepEqual(await page.evaluate(() => state.images.map(image => image.id)), ids);
    await open(0);
    // Going to the opposite edge must recover pixels discarded by the earlier crop.
    await page.locator("#frameXInput").fill("100");
    await page.locator("#frameZoomInput").fill("200");
    assert.equal(await page.locator("#frameYInput").isDisabled(), false);
    assert.equal(await page.locator("#frameZoomReadout").textContent(), "2×");
    assert.deepEqual(await previewPixel(), [0, 0, 255, 255]);
    await apply();
    assert.deepEqual(await photoPixel(0), [0, 0, 255, 255]);
    await open(1);
    assert.equal(await page.locator("#frameXInput").isDisabled(), true);
    await page.locator("#frameRotateButton").click();
    assert.equal(await page.locator("#frameYInput").isDisabled(), true);
    await page.locator("#frameXInput").fill("0");
    assert.deepEqual(await previewPixel(), [0, 0, 255, 255]);
    await page.locator("#frameRotateButton").click();
    await page.locator("#frameYInput").fill("0");
    assert.deepEqual(await previewPixel(), [0, 0, 255, 255]);
    await page.locator("#frameRotateButton").click();
    await page.locator("#frameXInput").fill("0");
    assert.deepEqual(await previewPixel(), [255, 0, 0, 255]);
    await page.locator("#frameResetButton").click();
    assert.deepEqual(await previewPixel(), [0, 255, 0, 255]);
    await page.locator("#frameYInput").fill("0");
    await apply();
    assert.deepEqual(await photoPixel(1), [255, 0, 0, 255]);

    const seams = await page.evaluate(() => {
      const checks = [];
      sizeInput.value = "720"; setCanvasSize(720);
      for (const mode of ["blend", "stitched"]) {
        renderModeInput.value = mode;
        invalidateTransitions();
        const settings = getSettings();
        for (let i = 0; i < 2; i++) {
          drawTransition(state.images[i], state.images[1 - i], 1, settings);
          const end = previewCtx.getImageData(0, 0, 720, 720).data;
          drawTransition(state.images[1 - i], state.images[i], 0, settings);
          const start = previewCtx.getImageData(0, 0, 720, 720).data;
          let sum = 0, max = 0;
          for (let k = 0; k < end.length; k++) { const delta = Math.abs(end[k] - start[k]); sum += delta; max = Math.max(max, delta); }
          checks.push({ mode, pair: i, mean: sum / end.length, max });
        }
      }
      return checks;
    });
    assert.ok(seams.every(seam => seam.mean < 0.03 && seam.max <= 3), JSON.stringify(seams));

    const before = await page.evaluate(() => state.images.map(image => ({ data: image.canvas.toDataURL(), framing: image.framing })));
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#saveProjectButton").click();
    const projectPath = path.join(output, "framed-project.zoomloop");
    await (await downloadPromise).saveAs(projectPath);
    await page.waitForFunction(() => !state.isPreparing);
    const saved = JSON.parse(fs.readFileSync(projectPath, "utf8"));
    assert.equal(saved.images.every(image => image.source && image.framing), true);
    await page.locator("#clearButton").click();
    await page.context().setOffline(true);
    await page.locator("#projectFileInput").setInputFiles(projectPath);
    await page.waitForFunction(() => !state.isLoading && state.images.length === 2);
    assert.deepEqual(await page.evaluate(() => state.images.map(image => ({ data: image.canvas.toDataURL(), framing: image.framing }))), before);
    await open(0);
    assert.equal(await page.locator("#frameXInput").inputValue(), "100");
    assert.equal(await page.locator("#frameZoomInput").inputValue(), "200");
    await page.locator("#frameResetButton").click();
    await page.locator("#frameXInput").fill("0");
    assert.deepEqual(await previewPixel(), [255, 0, 0, 255], "Saved framing copies must retain the edges of the original");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !state.isFraming);
    assert.deepEqual(await photoPixel(0), [0, 0, 255, 255]);

    // Older projects still open and allow framing their existing square photo.
    saved.images.forEach(image => { delete image.source; delete image.framing; });
    await page.locator("#projectFileInput").setInputFiles({ name: "legacy.zoomloop", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(saved)) });
    await page.waitForFunction(() => !state.isLoading);
    await page.evaluate(() => { window.savedBitmap = window.createImageBitmap; window.createImageBitmap = undefined; });
    await open(0);
    assert.match(await page.locator("#frameHelp").textContent(), /older project/);
    await page.setViewportSize({ width: 390, height: 844 });
    const bounds = await page.locator("#frameDialog").boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390 && bounds.y >= 0 && bounds.y + bounds.height <= 844);
    await page.screenshot({ path: path.join(output, "frame-editor-mobile.png") });
    await page.locator("#frameCancelButton").click();
    await page.evaluate(() => { window.createImageBitmap = savedBitmap; });
    const failure = await page.evaluate(async () => {
      const original = loadPhotoSource;
      loadPhotoSource = async () => { throw new Error("Test original decode failure"); };
      await openPhotoFrame(state.images[0].id);
      loadPhotoSource = original;
      return { busy: isBusy(), message: uploadHelp.textContent };
    });
    assert.equal(failure.busy, false);
    assert.match(failure.message, /Could not frame photo: Test original decode failure/);
    assert.deepEqual(errors, []);
    return { cropEdges: "passed", rotations: 3, cancellation: "passed", savedFramingOffline: "passed", legacyProjects: "passed", imageElementFallback: "passed", mobileDialog: "passed", seams, decodeFailure: "passed" };
  } finally { await page.close(); }
};
