const assert = require("node:assert/strict");

module.exports = async function testReliability(browser, url, fixtures) {
  const page = await browser.newPage({ serviceWorkers: "block" });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto(url);
    await page.locator("#fileInput").setInputFiles(fixtures.slice(0, 2));
    await page.waitForFunction(() => !state.isLoading && state.images.length === 2);
    await page.locator("#playButton").click();
    await page.waitForFunction(() => state.isPlaying);

    // Hold decoding open to verify the entire upload transaction is locked.
    await page.evaluate(() => {
      window.savedDecoder = decodePhotoFile;
      decodePhotoFile = () => new Promise(resolve => {
        window.finishUpload = () => resolve({ canvas: state.images[0].canvas, width: 1024, height: 1024 });
      });
      window.uploadTask = loadFiles([new File(["fixture"], "slow.png", { type: "image/png" })]);
    });
    assert.equal(await page.evaluate(() => state.isPlaying), false);
    for (const selector of ["#playButton", "#webmButton", "#sampleButton", "#clearButton", "#renderModeInput", "#timelineInput", "#imageList button"]) {
      assert.equal(await page.locator(selector).first().isDisabled(), true, selector);
    }
    await page.evaluate(() => { clearImages(); moveImage(0, 1); removeImage(0); });
    assert.equal(await page.locator("#imageList li").count(), 2);
    await page.evaluate(async () => { finishUpload(); await uploadTask; decodePhotoFile = savedDecoder; });
    assert.equal(await page.locator("#imageList li").count(), 3);
    assert.equal(await page.locator("#playButton").isDisabled(), false);
    assert.equal(await page.locator("#imageList li").last().getByRole("button", { name: "Dn", exact: true }).isDisabled(), true);

    await page.locator("#fileInput").setInputFiles([
      { name: "broken.png", mimeType: "image/png", buffer: Buffer.from("not an image") },
      { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not an image") }
    ]);
    await page.waitForFunction(() => !state.isLoading);
    assert.equal(await page.locator("#imageList li").count(), 3);
    assert.match(await page.locator("#uploadHelp").textContent(), /could not open broken.png/);
    assert.match(await page.locator("#uploadHelp").textContent(), /skipped 1/);
    assert.match(await page.locator("#statusText").textContent(), /3 images/);

    const numeric = await page.evaluate(() => {
      framesInput.value = ""; fpsInput.value = "";
      const blank = getSettings();
      framesInput.value = "999999"; fpsInput.value = "-50";
      const extremes = getSettings();
      framesInput.value = "24"; fpsInput.value = "30"; zoomRateInput.value = "250";
      return [blank.frames, blank.fps, extremes.frames, extremes.fps];
    });
    assert.deepEqual(numeric, [120, 30, 240, 12]);

    let converterRequests = 0;
    await page.route("**/heic2any.min.js", route => {
      converterRequests++;
      return converterRequests === 1 ? route.abort("failed") : route.fulfill({
        contentType: "text/javascript", headers: { "Access-Control-Allow-Origin": "*" },
        body: "window.heic2any = async ({blob}) => blob;"
      });
    });
    assert.equal(await page.evaluate(async () => {
      try { await getHeicConverter(); return false; } catch { return true; }
    }), true);
    assert.equal(await page.evaluate(async () => typeof await getHeicConverter()), "function");
    assert.equal(converterRequests, 2, "Failed converter downloads must be retryable");

    let downloads = 0;
    page.on("download", () => downloads++);
    await page.evaluate(() => { state.progress = 0.37; state.isPlaying = false; drawCurrentFrame(); });
    await page.locator("#webmButton").click();
    await page.waitForFunction(() => statusText.textContent.startsWith("Exporting video"));
    assert.equal(await page.locator("#cancelExportButton").isVisible(), true);
    await page.locator("#cancelExportButton").click();
    await page.waitForFunction(() => !state.isRecording);
    assert.equal(downloads, 0, "Cancelled exports must not download a partial file");
    assert.equal(await page.evaluate(() => state.progress), 0.37);
    assert.equal(await page.locator("#timelineInput").inputValue(), "370");
    assert.equal(await page.locator("#statusText").textContent(), "Export cancelled");
    assert.equal(await page.locator("#cancelExportButton").isVisible(), false);

    // Exercise recorder startup and runtime failures with real captured tracks.
    const failures = await page.evaluate(async () => {
      const originalRecorder = window.MediaRecorder;
      const originalCapture = previewCanvas.captureStream;
      const results = [];
      previewCanvas.captureStream = function (...args) {
        const stream = originalCapture.apply(this, args);
        window.testTracks = stream.getTracks();
        return stream;
      };
      for (const runtime of [false, true]) {
        window.MediaRecorder = class {
          static isTypeSupported() { return true; }
          constructor() {
            if (!runtime) throw new Error("Test startup failure");
            this.state = "inactive";
          }
          start() {
            this.state = "recording";
            setTimeout(() => { this.state = "inactive"; this.onerror?.({ error: new Error("Test runtime failure") }); }, 5);
          }
          stop() { this.state = "inactive"; this.onstop?.(); }
        };
        await recordWebm();
        results.push({ recording: state.isRecording, progress: state.progress, released: testTracks.every(track => track.readyState === "ended"), message: statusText.textContent });
      }
      window.MediaRecorder = originalRecorder;
      previewCanvas.captureStream = originalCapture;
      return results;
    });
    for (const failure of failures) {
      assert.equal(failure.recording, false);
      assert.equal(failure.progress, 0.37);
      assert.equal(failure.released, true);
      assert.match(failure.message, /Recording failed: Test/);
    }

    const renderFailure = await page.evaluate(async () => {
      const originalDraw = drawCurrentFrame;
      drawCurrentFrame = () => { throw new Error("Test rendering failure"); };
      let rejected = false;
      try { await recordWebm(); } catch { rejected = true; }
      drawCurrentFrame = originalDraw;
      return { rejected, recording: state.isRecording, progress: state.progress, message: statusText.textContent };
    });
    assert.equal(renderFailure.rejected, false, "Rendering errors must not escape export recovery");
    assert.equal(renderFailure.recording, false);
    assert.equal(renderFailure.progress, 0.37);
    assert.match(renderFailure.message, /Recording failed: Test rendering failure/);

    const pngFailure = await page.evaluate(async () => {
      const originalBlob = previewCanvas.toBlob;
      const originalData = previewCanvas.toDataURL;
      previewCanvas.toBlob = callback => setTimeout(() => callback(null), 0);
      previewCanvas.toDataURL = () => { throw new Error("Test PNG failure"); };
      await downloadCanvasPng();
      const png = statusText.textContent;
      await shareCurrentFrame();
      const share = statusText.textContent;
      previewCanvas.toBlob = originalBlob;
      previewCanvas.toDataURL = originalData;
      return { png, share };
    });
    assert.match(pngFailure.png, /PNG export failed: Test PNG failure/);
    assert.match(pngFailure.share, /Frame sharing failed: Test PNG failure/);

    const playbackFailure = await page.evaluate(() => {
      const originalDraw = drawCurrentFrame;
      const originalRaf = window.requestAnimationFrame;
      let scheduled = false;
      window.requestAnimationFrame = () => { scheduled = true; };
      drawCurrentFrame = () => { throw new Error("Test playback failure"); };
      state.isPlaying = true;
      try { tick(performance.now()); }
      finally { drawCurrentFrame = originalDraw; window.requestAnimationFrame = originalRaf; }
      return { scheduled, playing: state.isPlaying, message: statusText.textContent };
    });
    assert.equal(playbackFailure.scheduled, true, "Preview failures must not kill the animation scheduler");
    assert.equal(playbackFailure.playing, false);
    assert.match(playbackFailure.message, /Preview failed: Test playback failure/);

    await page.locator("#renderModeInput").selectOption("stitched");
    assert.equal(await page.locator("#cinematicModeInput").isDisabled(), true);
    assert.equal(await page.locator("#grainInput").isDisabled(), true);
    await page.locator("#playButton").click();
    await page.waitForFunction(() => state.isPlaying && !state.isPreparing);
    assert.equal(await page.evaluate(() => state.transitions.size), 3);
    await page.locator("#playButton").click();
    await page.locator("#renderModeInput").selectOption("blend");
    assert.equal(await page.locator("#cinematicModeInput").isDisabled(), false);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.locator("#clearButton").click();
    assert.equal(await page.locator("#playButton").isDisabled(), true);
    assert.equal(await page.locator("#pngButton").isDisabled(), true);
    assert.deepEqual(errors, []);
    return { uploads: "passed", numericInputs: "passed", converterRetry: "passed", cancellation: "passed", recorderFailures: failures.length, renderingFailure: "passed", pngFailure: "passed", playbackRecovery: "passed", mobileLayout: "passed" };
  } finally { await page.close(); }
};
