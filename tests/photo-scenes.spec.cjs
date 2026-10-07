const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "test-results");
fs.mkdirSync(output, { recursive: true });
const label = process.env.ZOOM_SCENE_LABEL || "current";
const photoDirectory = path.join(output, "photos");
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
      { name: "default", patch: 0.08 }, { name: "medium", patch: 0.16 }, { name: "large", patch: 0.34 },
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
    assert.ok(approachingSeams.every(seam => seam.mean < 0.03 && seam.max <= 3), JSON.stringify(approachingSeams.filter(seam => seam.mean >= 0.03 || seam.max > 3)));
    const bucketChecks = records.flatMap(record => record.checks.flatMap(check => check.buckets));
    const rasterChecks = records.flatMap(record => record.checks.flatMap(check => check.rasterSteps));
    console.log(JSON.stringify({ endpoints: seamChecks.length, worstBucketMean: Math.max(...bucketChecks.map(check => check.mean)), worstBucketMax: Math.max(...bucketChecks.map(check => check.max)), worstRasterMean: Math.max(...rasterChecks.map(check => check.mean)), worstRasterMax: Math.max(...rasterChecks.map(check => check.max)) }));
    if (process.env.ZOOM_CHECK_BUCKETS) assert.ok(bucketChecks.every(check => check.mean < 0.1 && check.max <= 10), "Near-identical camera positions must not pop at resolution boundaries");
    // A few boundary samples can cross an 8-bit filtering threshold. Allow
    // isolated antialiasing changes, while rejecting a visible region popping.
    const stableRaster = check => check.mean < 0.01 && check.significantFraction < 0.0001;
    const noisyContent = check => check.control && check.mean < Math.max(0.01, check.control.mean * 1.5) &&
      check.significantFraction < 0.0001;
    assert.ok(rasterChecks.every(check => stableRaster(check) || noisyContent(check)), JSON.stringify(rasterChecks.filter(check => !stableRaster(check) && !noisyContent(check))));
    const featherExits = records.flatMap(record => record.checks.map(check => check.featherExit));
    assert.ok(featherExits.every(stableRaster), JSON.stringify(featherExits.filter(check => !stableRaster(check))));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
