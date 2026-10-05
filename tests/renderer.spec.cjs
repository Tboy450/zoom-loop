const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("playwright");
const testReliability = require("./reliability.cjs");
const testProjects = require("./projects.cjs");

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
    assert.equal(await page.locator("#patchInput").inputValue(), "8");
    assert.match(await page.locator("#placementStatus").textContent(), /Add two photos/);
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
    const fixtures = data.map((url, i) => ({ name: `fixture-${i}.png`, mimeType: "image/png", buffer: Buffer.from(url.split(",")[1], "base64") }));
    await page.locator("#fileInput").setInputFiles(fixtures);
    await page.waitForFunction(() => !state.isLoading && state.images.length === 4);
    assert.equal(await page.locator("#imageList li").count(), 4);
    assert.match(await page.locator("#placementStatus").textContent(), /Auto:/);

    const placementChecks = await page.evaluate(() => {
      const settings = getSettings();
      const solid = (color) => {
        const source = makeCanvas(1024, 1024);
        const ctx = source.getContext("2d");
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 1024, 1024);
        return source;
      };
      const results = [];
      const choose = (name, parent, child, patch = settings.patch, override) => {
        const transition = PhotoZoom.createTransition(parent, child, { ...settings, patch }, override);
        const { anchorX, anchorY } = transition.settings;
        results.push({ name, patch, anchorX, anchorY, ...transition.placement });
        return transition;
      };
      for (const patch of [0.08, 0.12, 0.2, 0.34]) {
        choose(`flat-${patch}`, solid("#555555"), solid("#dddddd"), patch);
      }
      const nearTie = solid("#686868");
      const nearCtx = nearTie.getContext("2d");
      nearCtx.fillStyle = "#606060";
      nearCtx.fillRect(0.71 * 1024, 0.4 * 1024, 0.2 * 1024, 0.2 * 1024);
      choose("near-tie", nearTie, solid("#606060"));

      const edgeOnly = solid("#a04020");
      const edgeCtx = edgeOnly.getContext("2d");
      edgeCtx.fillStyle = "#2060c0";
      edgeCtx.fillRect(0, 0, 0.09 * 1024, 1024);
      choose("outside-visible-crop", edgeOnly, solid("#2060c0"));

      for (const [name, cx, cy] of [["left", 0.23, 0.5], ["right", 0.77, 0.5],
        ["top", 0.5, 0.23], ["bottom", 0.5, 0.77]]) {
        const parent = solid("#a04020");
        const ctx = parent.getContext("2d");
        ctx.fillStyle = "#2060c0";
        ctx.fillRect((cx - 0.06) * 1024, (cy - 0.06) * 1024, 0.12 * 1024, 0.12 * 1024);
        choose(`strong-${name}`, parent, solid("#2060c0"));
      }

      const patternedChild = solid("#606060");
      const patternCtx = patternedChild.getContext("2d");
      patternCtx.fillStyle = "#eeeeee";
      patternCtx.fillRect(0, 0, 1024, 512);
      patternCtx.fillStyle = "#222222";
      patternCtx.fillRect(0, 512, 1024, 512);
      const patternedParent = solid("#888888");
      const parentCtx = patternedParent.getContext("2d");
      parentCtx.drawImage(patternedChild, 0.73 * 1024, 0.46 * 1024, 0.08 * 1024, 0.08 * 1024);
      choose("structure-match", patternedParent, patternedChild);

      const picked = choose("picked", edgeOnly, patternedChild, 0.08, { anchorX: 0.89, anchorY: 0.11 });
      const manual = PhotoZoom.createTransition(edgeOnly, patternedChild,
        { ...settings, autoAnchor: false, anchorX: 0.72, anchorY: 0.28 });
      results.push({ name: "manual", anchorX: manual.settings.anchorX, anchorY: manual.settings.anchorY, ...manual.placement });
      const geometry = PhotoZoom.geometry(0.45, picked.settings, 720, 1);
      if (!Number.isFinite(geometry.viewX)) throw new Error("Invalid picked camera geometry");
      return results;
    });
    for (const result of placementChecks) {
      if (result.mode === "auto") {
        const margin = 0.1 + result.patch / 2 + 0.05;
        assert.ok(Math.min(result.anchorX, result.anchorY, 1 - result.anchorX, 1 - result.anchorY) >= margin - 1e-12,
          JSON.stringify(result));
      }
      if (result.name.startsWith("flat-") || ["near-tie", "outside-visible-crop"].includes(result.name)) {
        assert.equal(result.reason, "balanced", JSON.stringify(result));
        assert.ok(Math.abs(result.anchorX - 0.5) < 0.03 && Math.abs(result.anchorY - 0.5) < 0.03, JSON.stringify(result));
      }
      if (result.name.startsWith("strong-") || result.name === "structure-match") {
        assert.equal(result.reason, "stronger-match", JSON.stringify(result));
        assert.ok(result.matchImprovement >= 0.025, JSON.stringify(result));
      }
    }
    assert.ok(placementChecks.find(result => result.name === "strong-left").anchorX < 0.3);
    assert.ok(placementChecks.find(result => result.name === "strong-right").anchorX > 0.7);
    assert.ok(placementChecks.find(result => result.name === "strong-top").anchorY < 0.3);
    assert.ok(placementChecks.find(result => result.name === "strong-bottom").anchorY > 0.7);
    for (const [name, x, y] of [["picked", 0.89, 0.11], ["manual", 0.72, 0.28]]) {
      const result = placementChecks.find(result => result.name === name);
      assert.equal(result.mode, name);
      assert.ok(Math.abs(result.anchorX - x) < 1e-12 && Math.abs(result.anchorY - y) < 1e-12);
    }

    const geometryChecks = await page.evaluate(() => {
      const settings = getSettings();
      let maxVelocityError = 0;
      let maxZoomError = 0;
      let minimumTargetClearance = 1;
      let maxCropOverflow = 0;
      let pathSamples = 0;
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
      for (const patch of [0.08, 0.12, 0.2, 0.34]) {
        const margin = 0.1 + patch / 2 + 0.05;
        for (let x = 0; x <= 8; x++) {
          for (let y = 0; y <= 8; y++) {
            const s = { ...settings, patch, anchorX: margin + (1 - 2 * margin) * x / 8,
              anchorY: margin + (1 - 2 * margin) * y / 8 };
            for (let i = 0; i <= 200; i++) {
              const g = PhotoZoom.geometry(i / 200, s, 720, 1);
              const cx = (g.patchCenterX - g.viewX) / g.viewSize;
              const cy = (g.patchCenterY - g.viewY) / g.viewSize;
              minimumTargetClearance = Math.min(minimumTargetClearance, cx, cy, 1 - cx, 1 - cy);
              // The central 80% of the child must stay inside the camera, all the way to handoff.
              maxCropOverflow = Math.max(maxCropOverflow,
                g.viewX - (g.patchX + patch * 0.1), g.viewY - (g.patchY + patch * 0.1),
                g.patchX + patch * 0.9 - g.viewX - g.viewSize,
                g.patchY + patch * 0.9 - g.viewY - g.viewSize);
              pathSamples++;
            }
          }
        }
      }
      return { maxVelocityError, maxZoomError, minimumTargetClearance, maxCropOverflow, pathSamples };
    });
    assert.ok(geometryChecks.maxVelocityError < 0.00002, JSON.stringify(geometryChecks));
    assert.ok(geometryChecks.maxZoomError < 1e-12);
    assert.ok(geometryChecks.minimumTargetClearance >= 0.07, JSON.stringify(geometryChecks));
    assert.ok(geometryChecks.maxCropOverflow < 1e-12, JSON.stringify(geometryChecks));

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
      for (const mode of ["blend", "stitched"]) {
        renderModeInput.value = mode;
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
              results.push({ mode, cinematic, patch, pair: i, mean: sum / end.length, max });
            }
          }
        }
      }
      renderModeInput.value = "blend";
      return results;
    });
    assert.ok(seams.every(seam => seam.mean < 0.03 && seam.max <= 3), JSON.stringify(seams));

    const resolutions = await page.evaluate(() => {
      const results = [];
      for (const mode of ["blend", "stitched"]) {
        renderModeInput.value = mode;
        patchInput.value = "8";
        invalidateTransitions();
        for (const size of [720, 1080, 1440, 2160]) {
          sizeInput.value = String(size); setCanvasSize(size);
          const settings = getSettings();
          drawTransition(state.images[0], state.images[1], 1, settings);
          const end = previewCtx.getImageData(0, 0, size, size).data;
          drawTransition(state.images[1], state.images[2], 0, settings);
          const start = previewCtx.getImageData(0, 0, size, size).data;
          let sum = 0, max = 0;
          for (let i = 0; i < end.length; i++) {
            const diff = Math.abs(end[i] - start[i]); sum += diff; max = Math.max(max, diff);
          }
          const began = performance.now();
          drawTransition(state.images[0], state.images[1], 0.6, settings);
          previewCtx.getImageData(size / 2, size / 2, 1, 1);
          results.push({ mode, size, mean: sum / end.length, max, frameMs: performance.now() - began });
        }
      }
      renderModeInput.value = "blend"; sizeInput.value = "720"; setCanvasSize(720);
      return results;
    });
    assert.ok(resolutions.every(check => check.mean < 0.03 && check.max <= 3), JSON.stringify(resolutions));

    const fixedScene = await page.evaluate(() => {
      const settings = { ...getSettings(), mode: "stitched", autoAnchor: false, anchorX: 0.5, anchorY: 0.5, patch: 0.12 };
      const images = ["#402040", "#dca040"].map(color => {
        const photo = makeCanvas(1024, 1024);
        const ctx = photo.getContext("2d"); ctx.fillStyle = color; ctx.fillRect(0, 0, 1024, 1024);
        return { canvas: photo };
      });
      const prepared = images.map((image, i) => PhotoZoom.createTransition(image.canvas, images[1 - i].canvas, settings));
      const output = makeCanvas(720, 720), ctx = output.getContext("2d");
      const samples = [0.05, 0.45, 0.75].map(t => {
        PhotoZoom.render(ctx, images, 0, t, settings, from => prepared[images.indexOf(from)]);
        const geometry = PhotoZoom.geometry(t, settings, 720);
        const x = Math.round((geometry.patchX + geometry.patchSize * 0.3 - geometry.viewX) * geometry.scale);
        const y = Math.round((geometry.patchY + geometry.patchSize * 0.35 - geometry.viewY) * geometry.scale);
        return [...ctx.getImageData(x, y, 1, 1).data];
      });
      return { samples, preparedPairs: prepared.length };
    });
    assert.ok(fixedScene.samples.every(sample => sample.every((value, c) => Math.abs(value - fixedScene.samples[0][c]) <= 2)), JSON.stringify(fixedScene));

    await page.evaluate(() => { state.portalOverrides.clear(); cinematicModeInput.checked = false; applySmoothDefaults(); });
    const scrub = await page.evaluate(() => {
      const values = [0.79, 0.03, 0.99, 0.42, 0.03];
      const frames = values.map(progress => { drawLoopFrame(progress); return previewCanvas.toDataURL(); });
      return { deterministic: frames[1] === frames[4], count: state.transitions.size };
    });
    assert.ok(scrub.deterministic, "Scrubbing must not depend on playback history");
    for (const button of ["#autoSortButton", "#autoTuneButton", "#autoCinematicButton", "#smoothDefaultsButton"]) {
      const ids = await page.evaluate(() => state.images.map(image => image.id).sort());
      await page.locator(button).click();
      assert.deepEqual(await page.evaluate(() => state.images.map(image => image.id).sort()), ids);
      assert.equal(await page.locator("#patchInput").inputValue(), "8");
      assert.match(await page.locator("#placementStatus").textContent(), /Auto:/);
    }
    await page.locator("#autoAnchorInput").uncheck();
    assert.match(await page.locator("#placementStatus").textContent(), /Manual anchor/);
    await page.locator("#autoAnchorInput").check();
    await page.locator("#portalPickButton").click();
    await page.locator("#previewCanvas").click({ position: { x: 210, y: 260 } });
    assert.match(await page.locator("#portalHelp").textContent(), /Portal set/);
    assert.match(await page.locator("#placementStatus").textContent(), /Your picked point/);
    await page.locator("#portalClearButton").click();
    assert.match(await page.locator("#portalHelp").textContent(), /Cleared/);
    assert.match(await page.locator("#placementStatus").textContent(), /Auto:/);
    await page.locator("#playButton").click();
    await page.waitForFunction(() => state.isPlaying && state.progress > 0.05);
    await page.locator("#playButton").click();
    assert.equal(await page.evaluate(() => state.isPlaying), false);
    const [png] = await Promise.all([page.waitForEvent("download"), page.locator("#pngButton").click()]);
    await png.saveAs(path.join(output, "export-frame.png"));
    assert.ok(fs.statSync(path.join(output, "export-frame.png")).size > 1000);

    await page.locator("#renderModeInput").selectOption("stitched");
    const exportProgress = await page.evaluate(() => state.progress);
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
    assert.equal(await page.evaluate(() => state.progress), exportProgress);
    assert.ok(fs.statSync(videoPath).size > 1000);
    assert.equal(await page.locator("#patchInput").isDisabled(), false);
    const reliability = await testReliability(browser, `http://127.0.0.1:${server.address().port}/`, fixtures);
    const projects = await testProjects(browser, `http://127.0.0.1:${server.address().port}/`, fixtures, output);

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
      renderModeInput.value = "stitched";
      invalidateTransitions(); updateStatus();
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
    assert.equal(await page.evaluate(() => document.querySelector(".app-shell").getBoundingClientRect().height <= innerHeight), true);
    assert.equal(await page.evaluate(() => {
      const canvas = previewCanvas.getBoundingClientRect();
      const wrap = canvasWrap.getBoundingClientRect();
      return Math.abs(canvas.width - canvas.height) < 1 && canvas.height <= wrap.height + 1 && canvas.width <= wrap.width + 1;
    }), true, "Desktop preview must fit without clipping or stretching");

    const offlinePage = await browser.newPage();
    await offlinePage.goto(`http://127.0.0.1:${server.address().port}/?sample=1&mode=stitched`);
    await offlinePage.evaluate(() => navigator.serviceWorker.ready);
    await offlinePage.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await offlinePage.context().setOffline(true);
    await offlinePage.reload();
    await offlinePage.waitForFunction(() => state.images.length === 3 && getSettings().mode === "stitched");
    await offlinePage.close();
    assert.deepEqual(errors, []);
    const photoCount = await page.locator("#imageList li").count();
    await page.setViewportSize({ width: 390, height: 844 });
    const mobilePlacement = await page.locator("#placementStatus").boundingBox();
    assert.ok(mobilePlacement.x >= 0 && mobilePlacement.x + mobilePlacement.width <= 390);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    const cacheReady = await page.evaluate(async () => {
      const cache = await caches.open("zoom-loop-v10");
      return Boolean(await cache.match("./zoom-renderer.js?v10"));
    });
    assert.equal(cacheReady, true);
    await page.context().setOffline(true);
    await page.reload({ waitUntil: "load" });
    assert.equal(await page.locator("#patchInput").inputValue(), "8");
    await page.locator("#sampleButton").click();
    await page.waitForFunction(() => state.images.length === 3);
    assert.match(await page.locator("#placementStatus").textContent(), /Auto:/);
    assert.deepEqual(errors, []);
    const result = { placementChecks, geometryChecks, concealment, seams, resolutions, fixedScene, scrub, reliability, projects, offline: "passed", averageFrameMs: montage.averageMs, photos: photoCount, video: path.basename(videoPath) };
    fs.writeFileSync(path.join(output, "results.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ ...result, seams: `${seams.length} endpoint comparisons passed` }, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
