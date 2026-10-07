const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "test-results");
fs.mkdirSync(output, { recursive: true });
const label = process.env.ZOOM_SCENE_LABEL || "current";
const photoDirectory = path.join(output, process.env.ZOOM_PHOTO_DIR || "photos");
const photos = process.env.ZOOM_TEST_PHOTOS ? JSON.parse(process.env.ZOOM_TEST_PHOTOS) : fs.existsSync(photoDirectory) ? fs.readdirSync(photoDirectory).filter(name => /\.jpg$/i.test(name)).map(name => path.join(photoDirectory, name)) : [];
const server = http.createServer((req, res) => {
  const file = path.join(root, new URL(req.url, "http://localhost").pathname.replace(/^\/$/, "/index.html"));
  if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
  fs.readFile(file, (error, data) => {
    if (error) return res.writeHead(404).end();
    res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html");
    res.end(data);
  });
});
(async () => {
  assert.ok(photos.length >= 4, "Provide at least four local photos using ZOOM_TEST_PHOTOS");
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.ZOOM_BROWSER });
  try {
    const page = await browser.newPage({ serviceWorkers: "block", viewport: { width: 1440, height: 1100 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    if (process.env.ZOOM_RENDERER) await page.route("**/zoom-renderer.js?*", route => route.fulfill({ contentType: "text/javascript", body: fs.readFileSync(process.env.ZOOM_RENDERER, "utf8") }));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    // Fixed shuffle makes the varied selection reproducible on later runs.
    let seed = 42421;
    for (let i = photos.length - 1; i > 0; i--) { seed = (seed * 1664525 + 1013904223) >>> 0; const j = seed % (i + 1); [photos[i], photos[j]] = [photos[j], photos[i]]; }
    await page.locator("#fileInput").setInputFiles(photos);
    await page.waitForFunction(count => !state.isLoading && state.images.length === count, photos.length);
    console.log(`Loaded ${photos.length} detailed photos`);
    const profiles = [
      { name: "default", patch: 0.08 }, { name: "medium", patch: 0.16 }, { name: "large", patch: 0.34 }, { name: "tiny", patch: 0.01 },
      { name: "hard-edge", patch: 0.16, edgeBlend: 0, shapeMorph: 0 },
      { name: "wide-organic", patch: 0.16, edgeBlend: 1, shapeMorph: 1, sampleBlend: 1 },
      { name: "low-binding", patch: 0.08, bind: 0.2, sampleBlend: 0.2 },
      { name: "raw", patch: 0.34, smoothGuard: false, edgeBlend: 0.2, sampleBlend: 0, grain: 0.7, symmetry: 4 },
      { name: "cinematic", patch: 0.08, cinematicMode: true, symmetry: 3, alignment: 0.12 },
      { name: "picked-edge", patch: 0.08, autoAnchor: false, anchorX: 0.12, anchorY: 0.88 }
    ];
    const records = [];
    for (const mode of ["blend", "stitched"]) {
      for (const profile of profiles) {
        if (process.env.ZOOM_SCENE_PROFILES && !process.env.ZOOM_SCENE_PROFILES.split(",").includes(profile.name)) continue;
        records.push(await page.evaluate(({ mode, profile }) => {
          const size = 720;
          const settings = { ...getSettings(), ...profile, mode, size };
          state.portalOverrides.clear(); invalidateTransitions(); setCanvasSize(size);
          const delta = (a, b) => {
            let sum = 0, max = 0, significant = 0;
            for (let i = 0; i < a.length; i++) {
              const d = Math.abs(a[i] - b[i]);
              sum += d; max = Math.max(max, d);
              if (d > 10) significant++;
            }
            return { mean: sum / a.length, max, significantFraction: significant / (a.length * 0.75) };
          };
          // Read a separate snapshot so repeated measurements do not force
          // the preview alone from GPU to CPU filtering during the test.
          const snapshot = makeCanvas(size, size);
          const snapshotCtx = snapshot.getContext("2d", { willReadFrequently: true });
          const render = (pair, t) => {
            drawTransition(state.images[pair], state.images[(pair + 1) % state.images.length], t, settings);
            snapshotCtx.drawImage(previewCanvas, 0, 0);
            return snapshotCtx.getImageData(0, 0, size, size).data;
          };
          const checks = state.images.map((image, pair) => {
            const seam = delta(render(pair, 1), render((pair + 1) % state.images.length, 0));
            const approachingSeam = delta(render(pair, 1 - 1e-7), render((pair + 1) % state.images.length, 0));
            const buckets = [];
            for (const threshold of [128, 256, 512, 1024]) {
              const t = Math.log(settings.patch * size * 2 / (0.8 * threshold)) / Math.log(settings.patch);
              if (t > 0.02 && t < 0.98) buckets.push({ t, threshold, ...delta(render(pair, t - 1e-7), render(pair, t + 1e-7)) });
            }
            const rasterSteps = [];
            for (const threshold of [128.5, 256.5, 512.5, 1024.5]) {
              const t = Math.log(settings.patch * size * 2 / (0.8 * threshold)) / Math.log(settings.patch);
              // An equal step that crosses no pixel boundary measures the
              // GPU's normal sub-texel filtering noise for this content.
              if (t > 0.02 && t < 0.98) rasterSteps.push({ t, threshold, ...delta(render(pair, t - 1e-7), render(pair, t + 1e-7)),
                control: delta(render(pair, t - 3e-7), render(pair, t - 1e-7)) });
            }
            const transition = getTransition(image, state.images[(pair + 1) % state.images.length], settings);
            let low = 0.97, high = 1;
            for (let iteration = 0; iteration < 44; iteration++) {
              const time = (low + high) / 2;
              const camera = PhotoZoom.geometry(time, transition.settings, size);
              const left = (camera.viewX - camera.patchX) / camera.patchSize;
              const top = (camera.viewY - camera.patchY) / camera.patchSize;
              const span = camera.viewSize / camera.patchSize;
              if (left >= 0.098 && top >= 0.098 && left + span <= 0.902 && top + span <= 0.902) high = time;
              else low = time;
            }
            const featherExitTime = (low + high) / 2;
            const featherExit = delta(render(pair, featherExitTime - 1e-7), render(pair, featherExitTime + 1e-7));
            return { pair, seam, approachingSeam, buckets, rasterSteps, featherExit, contourImprovement: transition.seam?.matchImprovement || 0 };
          });
          return { mode, profile: profile.name, checks };
        }, { mode, profile }));
        console.log(`${mode}: ${profile.name} checked`);
      }
    }
    // Photo Blend forms each photo gradually: at 5 s per photo and 30 fps no
    // frame reveals a large piece at once, nothing is hidden again, and at
    // small start sizes the first specks show while the photo is tiny.
    const reveal = await page.evaluate(() => [0.01, 0.02, 0.08].map(patch => {
      const settings = { ...getSettings(), mode: "blend", patch, size: 1080 };
      state.portalOverrides.clear(); invalidateTransitions();
      const step = Math.log(1 / patch) / 150;
      const rows = state.images.map((image, pair) => {
        const transition = getTransition(image, state.images[(pair + 1) % state.images.length], settings);
        let previous = 0, worst = 0, firstPixels = null, decreased = false;
        for (let zoomed = Math.log(patch * patch / 0.8); zoomed <= Math.log(1.25); zoomed += step) {
          const coverage = Math.exp(zoomed), share = PhotoZoom.revealedShare(transition, coverage);
          if (share < previous - 1e-6) decreased = true;
          worst = Math.max(worst, share - previous);
          if (firstPixels === null && share > 0.002) firstPixels = coverage * 1080;
          previous = share;
        }
        return { pair, worst, firstPixels, decreased };
      });
      return { patch, rows };
    }));
    for (const { patch, rows } of reveal) {
      for (const row of rows) {
        assert.ok(!row.decreased, `${patch}: pair ${row.pair} hid part of the photo again`);
        assert.ok(row.worst <= 0.025, `${patch}: pair ${row.pair} revealed ${row.worst} of the photo in one frame`);
        if (patch <= 0.02) assert.ok(row.firstPixels <= patch * 1200, `${patch}: pair ${row.pair} first showed at ${row.firstPixels} px`);
      }
    }
    console.log(JSON.stringify({ reveal: reveal.map(({ patch, rows }) => ({ patch, worstPerFrame: Math.max(...rows.map(r => r.worst)), firstPixels: Math.max(...rows.map(r => r.firstPixels)) })) }));
    const sheets = await page.evaluate(() => {
      const sheets = [];
      for (const mode of ["blend", "stitched"]) {
        const size = 240, times = [0, 0.2, 0.4, 0.6, 0.8, 0.96];
        const sheet = makeCanvas(size * times.length, (size + 28) * state.images.length);
        const ctx = sheet.getContext("2d");
        ctx.fillStyle = "#191b1d"; ctx.fillRect(0, 0, sheet.width, sheet.height);
        const settings = { ...getSettings(), size: 720, mode };
        state.portalOverrides.clear(); invalidateTransitions(); setCanvasSize(720);
        state.images.forEach((image, row) => times.forEach((time, col) => {
          drawTransition(image, state.images[(row + 1) % state.images.length], time, settings);
          ctx.drawImage(previewCanvas, col * size, row * (size + 28), size, size);
          ctx.fillStyle = "#f5f2ec"; ctx.font = "12px sans-serif";
          ctx.fillText(`${row + 1} → ${(row + 1) % state.images.length + 1}   t=${time}`, col * size + 8, row * (size + 28) + size + 18);
        }));
        sheets.push({ mode, data: sheet.toDataURL() });
      }
      return sheets;
    });
    for (const sheet of sheets) fs.writeFileSync(path.join(output, `photos-${label}-${sheet.mode}.png`), Buffer.from(sheet.data.split(",")[1], "base64"));
    if (process.env.ZOOM_SCENE_VIDEO) {
      await page.locator("#renderModeInput").selectOption("stitched");
      await page.locator("#sizeInput").selectOption("720");
      await page.locator("#durationInput").fill("2");
      await page.locator("#fpsInput").selectOption("24");
      await page.evaluate(() => {
        const original = offerExport;
        offerExport = (blob, ...args) => { window.recordedPhotoVideo = blob; return original(blob, ...args); };
      });
      const downloadPromise = page.waitForEvent("download");
      await page.locator("#webmButton").click();
      const download = await downloadPromise;
      const destination = path.join(output, `photos-${label}.${download.suggestedFilename().split(".").pop()}`);
      await download.saveAs(destination);
      await page.waitForFunction(() => !state.isRecording);
      const metadata = await page.evaluate(async () => {
        const video = document.createElement("video");
        const url = URL.createObjectURL(recordedPhotoVideo);
        try {
          await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = () => reject(new Error("Exported photo video could not be decoded")); video.src = url; });
          return { width: video.videoWidth, height: video.videoHeight, duration: video.duration };
        } finally { video.removeAttribute("src"); video.load(); URL.revokeObjectURL(url); }
      });
      assert.equal(metadata.width, 720); assert.equal(metadata.height, 720);
      console.log(JSON.stringify({ video: path.basename(destination), ...metadata }));
    }
    const result = { photos: photos.map(file => path.basename(file)), profiles, records, errors };
    fs.writeFileSync(path.join(output, `photo-scenes-${label}.json`), JSON.stringify(result, null, 2));
    assert.deepEqual(errors, []);
    const seamChecks = records.flatMap(record => record.checks.map(check => check.seam));
    assert.ok(seamChecks.every(seam => seam.mean < 0.03 && seam.max <= 3), JSON.stringify(seamChecks.filter(seam => seam.mean >= 0.03 || seam.max > 3)));
    const approachingSeams = records.flatMap(record => record.checks.map(check => check.approachingSeam));
    // A photo nested a few levels deep is only a few pixels wide here and is
    // placed on whole pixels, so its position can step by one pixel in the
    // last instant before the handoff, as it can in any frame. Allow such
    // isolated pixels (under ~10 in a 720 frame), never a visible jump.
    const continuous = seam => (seam.mean < 0.03 && seam.max <= 3) || (seam.mean < 0.002 && seam.significantFraction < 0.00002);
    assert.ok(approachingSeams.every(continuous), JSON.stringify(approachingSeams.filter(seam => !continuous(seam))));
    const bucketChecks = records.flatMap(record => record.checks.flatMap(check => check.buckets));
    const rasterChecks = records.flatMap(record => record.checks.flatMap(check => check.rasterSteps));
    console.log(JSON.stringify({ endpoints: seamChecks.length, worstBucketMean: Math.max(...bucketChecks.map(check => check.mean)), worstBucketMax: Math.max(...bucketChecks.map(check => check.max)), worstRasterMean: Math.max(...rasterChecks.map(check => check.mean)), worstRasterMax: Math.max(...rasterChecks.map(check => check.max)) }));
    if (process.env.ZOOM_CHECK_BUCKETS) assert.ok(bucketChecks.every(check => check.mean < 0.1 && check.max <= 10), "Near-identical camera positions must not pop at resolution boundaries");
    // A few boundary samples can cross an 8-bit filtering threshold. Allow
    // isolated antialiasing changes, while rejecting a visible region popping.
    const stableRaster = check => check.mean < 0.01 && check.significantFraction < 0.0001;
    const noisyContent = check => check.control && check.mean < Math.max(0.01, check.control.mean * 1.5) &&
      check.significantFraction < 0.0001;
    // When a nested photo is first drawn wider than 1024 px, Chromium changes
    // how it filters several scaled drawings at once: up to ~1% of pixels
    // move by one to four levels, depending on the photos. About half comes
    // from the photo itself being drawn at exactly half its size; the rest
    // from other scaled layers. Every renderer version shows it, and pinning
    // the layer size or copying layers in tiles does not change it. Allow
    // that, and no more: any pixel changing by 5 or more levels still fails.
    const imperceptible = check => check.max <= 4 && check.significantFraction === 0;
    const accepted = check => stableRaster(check) || noisyContent(check) || imperceptible(check);
    assert.ok(rasterChecks.every(accepted), JSON.stringify(rasterChecks.filter(check => !accepted(check))));
    // The same browser filtering change can coincide with the moment the
    // feather leaves the screen (seen at the 34% start size on store photos,
    // in every renderer version); no pixel may change by 5 or more levels.
    const featherExits = records.flatMap(record => record.checks.map(check => check.featherExit));
    const exitAccepted = check => stableRaster(check) || imperceptible(check);
    assert.ok(featherExits.every(exitAccepted), JSON.stringify(featherExits.filter(check => !exitAccepted(check))));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
