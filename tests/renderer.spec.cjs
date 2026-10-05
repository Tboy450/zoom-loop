const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "test-results");
fs.mkdirSync(output, { recursive: true });
const types = { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  const file = path.join(root, pathname === "/" ? "index.html" : pathname);
  if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
  fs.readFile(file, (error, bytes) => {
    if (error) return res.writeHead(404).end();
    res.setHeader("Content-Type", types[path.extname(file)] || "application/octet-stream");
    res.end(bytes);
  });
});

(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true, ...(process.env.ZOOM_BROWSER ? { executablePath: process.env.ZOOM_BROWSER } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    assert.equal(await page.locator("#statusText").textContent(), "Empty stack");
    const data = await page.evaluate(() => {
      return [0, 1, 2, 3].map(n => {
        const source = document.createElement("canvas");
        source.width = n === 2 ? 400 : 1000;
        source.height = n === 3 ? 350 : 1000;
        const ctx = source.getContext("2d");
        const gradient = ctx.createLinearGradient(0, 0, source.width, source.height);
        gradient.addColorStop(0, ["#bb4d13", "#defaff", "#040508", "#e3dfbc"][n]);
        gradient.addColorStop(1, ["#392617", "#418aa0", "#172940", "#6f8d58"][n]);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, source.width, source.height);
        for (let i = 0; i < 1100; i++) {
          ctx.fillStyle = `rgba(${n === 2 ? "75,110,160" : "30,24,20"},${0.1 + i % 7 / 30})`;
          ctx.fillRect((i * 79) % source.width, (i * 151) % source.height, 2 + i % 31, 2 + i % 19);
        }
        ctx.fillStyle = n === 2 ? "#d5dae5" : "#251815";
        ctx.font = "bold 90px sans-serif";
        ctx.fillText(`PHOTO ${n + 1}`, 25, 150);
        return source.toDataURL("image/png");
      });
    });
    await page.locator("#fileInput").setInputFiles(data.map((url, i) => ({ name: `fixture-${i}.png`, mimeType: "image/png", buffer: Buffer.from(url.split(",")[1], "base64") })));
    await page.waitForFunction(() => !state.isLoading && state.images.length === 4);
    assert.equal(await page.locator("#imageList li").count(), 4);

    const geometryChecks = await page.evaluate(() => {
      const settings = getSettings();
      let maxVelocityError = 0;
      let maxZoomError = 0;
      for (const patch of [0.08, 0.12, 0.2, 0.34]) {
        for (const anchorX of [0.08, 0.5, 0.92]) {
          for (const anchorY of [0.08, 0.5, 0.92]) {
            const s = { ...settings, patch, anchorX, anchorY };
            let previous = null;
            for (let i = 0; i <= 100; i++) {
              const g = PhotoZoom.geometry(i / 100, s, 720, 1);
              if (g.viewX < -1e-9 || g.viewY < -1e-9 || g.viewX + g.viewSize > 1 + 1e-9 || g.viewY + g.viewSize > 1 + 1e-9) throw new Error("Uncovered camera frame");
              if (previous) maxZoomError = Math.max(maxZoomError, Math.abs(g.viewSize / previous.viewSize - patch ** 0.01));
              previous = g;
            }
            const h = 1e-6;
            const end = PhotoZoom.geometry(1, s, 720, 1);
            const before = PhotoZoom.geometry(1 - h, s, 720, 1);
            const start = PhotoZoom.geometry(0, s, 720, 1);
            const after = PhotoZoom.geometry(h, s, 720, 1);
            for (const key of ["viewX", "viewY", "viewSize"]) {
              maxVelocityError = Math.max(maxVelocityError, Math.abs((end[key] - before[key]) / h - patch * (after[key] - start[key]) / h));
            }
          }
        }
      }
      return { maxVelocityError, maxZoomError };
    });
    assert.ok(geometryChecks.maxVelocityError < 0.00002, JSON.stringify(geometryChecks));
    assert.ok(geometryChecks.maxZoomError < 1e-12);

    const concealment = await page.evaluate(() => {
      const parent = makeCanvas(1024, 1024), child = makeCanvas(1024, 1024);
      const a = parent.getContext("2d"), b = child.getContext("2d");
      a.fillStyle = "#252525"; a.fillRect(0, 0, 1024, 1024);
      b.fillStyle = "white"; b.fillRect(0, 0, 1024, 1024);
      b.fillStyle = "black";
      for (let i = 0; i < 1024; i += 80) b.fillRect(i, 0, 8, 1024);
      const images = [{ canvas: parent }, { canvas: child }];
      const settings = getSettings();
      const transitions = [PhotoZoom.createTransition(parent, child, settings), PhotoZoom.createTransition(child, parent, settings)];
      const output = makeCanvas(720, 720), ctx = output.getContext("2d");
      PhotoZoom.render(ctx, images, 0, 0, settings, (from) => transitions[images.indexOf(from)]);
      const bytes = ctx.getImageData(0, 0, 720, 720).data;
      let max = 0;
      for (let i = 0; i < bytes.length; i += 4) max = Math.max(max, Math.abs(bytes[i] - 37));
      return { maxChannelChange: max };
    });
    assert.ok(concealment.maxChannelChange <= 6, JSON.stringify(concealment));

    const seams = await page.evaluate(() => {
      const results = [];
      sizeInput.value = "720";
      setCanvasSize(720);
      for (const cinematic of [false, true]) {
        cinematicModeInput.checked = cinematic;
        for (const patch of [8, 12, 34]) {
          patchInput.value = String(patch);
          invalidateTransitions();
          state.images.forEach((image, i) => setPortalOverride(image.id, state.images[(i + 1) % state.images.length].id, i % 2 ? 0.92 : 0.08, i % 2 ? 0.08 : 0.92));
          const settings = getSettings();
          for (let i = 0; i < state.images.length; i++) {
            const from = state.images[i], to = state.images[(i + 1) % state.images.length];
            drawTransition(from, to, 1, settings);
            const end = previewCtx.getImageData(0, 0, 720, 720).data;
            drawTransition(to, state.images[(i + 2) % state.images.length], 0, settings);
            const start = previewCtx.getImageData(0, 0, 720, 720).data;
            let sum = 0, max = 0;
            for (let j = 0; j < end.length; j++) {
              const diff = Math.abs(end[j] - start[j]);
              sum += diff; max = Math.max(max, diff);
            }
            results.push({ cinematic, patch, pair: i, mean: sum / end.length, max });
          }
        }
      }
      return results;
    });
    assert.ok(seams.every(seam => seam.mean < 0.03 && seam.max <= 3), JSON.stringify(seams));

    await page.evaluate(() => { state.portalOverrides.clear(); cinematicModeInput.checked = false; applySmoothDefaults(); });
    const scrub = await page.evaluate(() => {
      const values = [0.79, 0.03, 0.99, 0.42, 0.03];
      const frames = values.map(progress => { drawLoopFrame(progress); return previewCanvas.toDataURL(); });
      return { deterministic: frames[1] === frames[4], count: state.transitions.size };
    });
    assert.ok(scrub.deterministic, "Scrubbing must not depend on playback history");
    await page.locator("#portalPickButton").click();
    await page.locator("#previewCanvas").click({ position: { x: 210, y: 260 } });
    assert.match(await page.locator("#portalHelp").textContent(), /Portal set/);
    await page.locator("#portalClearButton").click();
    assert.match(await page.locator("#portalHelp").textContent(), /Cleared/);
    await page.locator("#playButton").click();
    await page.waitForFunction(() => state.isPlaying && state.progress > 0.05);
    await page.locator("#playButton").click();
    assert.equal(await page.evaluate(() => state.isPlaying), false);
    const [png] = await Promise.all([page.waitForEvent("download"), page.locator("#pngButton").click()]);
    await png.saveAs(path.join(output, "export-frame.png"));
    assert.ok(fs.statSync(path.join(output, "export-frame.png")).size > 1000);

    await page.locator("#framesInput").fill("24");
    await page.locator("#fpsInput").fill("30");
    await page.locator("#zoomRateInput").fill("250");
    const videoDownload = page.waitForEvent("download");
    await page.locator("#webmButton").click();
    assert.equal(await page.locator("#patchInput").isDisabled(), true);
    const video = await videoDownload;
    const videoPath = path.join(output, video.suggestedFilename());
    await video.saveAs(videoPath);
    await page.waitForFunction(() => !state.isRecording);
    assert.ok(fs.statSync(videoPath).size > 1000);
    assert.equal(await page.locator("#patchInput").isDisabled(), false);

    if (process.env.ZOOM_TEST_PHOTOS) {
      await page.locator("#clearButton").click();
      await page.locator("#fileInput").setInputFiles(JSON.parse(process.env.ZOOM_TEST_PHOTOS));
      await page.waitForFunction(() => !state.isLoading && state.images.length >= 2);
    }
    const montage = await page.evaluate(() => {
      state.isPlaying = false;
      state.portalOverrides.clear();
      cinematicModeInput.checked = false;
      applySmoothDefaults();
      sizeInput.value = "720";
      const sheet = document.createElement("canvas");
      const cell = 320;
      sheet.width = cell * 4;
      sheet.height = (cell + 28) * 2;
      const ctx = sheet.getContext("2d");
      ctx.fillStyle = "#111"; ctx.fillRect(0, 0, sheet.width, sheet.height);
      const positions = [0, 0.25, 0.5, 0.75, 0.88, 0.97, 1, 1.15];
      positions.forEach((position, i) => {
        drawLoopFrame(position / state.images.length);
        const x = i % 4 * cell, y = Math.floor(i / 4) * (cell + 28);
        ctx.drawImage(previewCanvas, x, y, cell, cell);
        ctx.fillStyle = "#ddd"; ctx.font = "14px sans-serif";
        ctx.fillText(`Depth ${position}`, x + 10, y + cell + 20);
      });
      drawLoopFrame(0);
      const settings = getSettings();
      const start = performance.now();
      for (let i = 0; i < 90; i++) {
        drawLoopFrame(i / 90 / state.images.length);
        // Flush queued canvas work so this includes rasterization, not just JS.
        previewCtx.getImageData(0, 0, 1, 1);
      }
      const averageMs = (performance.now() - start) / 90;
      drawLoopFrame(0);
      return { url: sheet.toDataURL("image/png"), averageMs, pairs: state.transitions.size, settings };
    });
    fs.writeFileSync(path.join(output, "transition-contact-sheet.png"), Buffer.from(montage.url.split(",")[1], "base64"));
    await page.screenshot({ path: path.join(output, "app.png"), fullPage: true });
    assert.deepEqual(errors, []);
    const result = { geometryChecks, concealment, seams, scrub, averageFrameMs: montage.averageMs, photos: await page.locator("#imageList li").count(), video: path.basename(videoPath) };
    fs.writeFileSync(path.join(output, "results.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ ...result, seams: `${seams.length} endpoint comparisons passed` }, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
