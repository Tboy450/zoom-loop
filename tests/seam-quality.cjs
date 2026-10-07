// Measures how noticeable each embedded photo is while it grows, using the
// detailed photos in test-results/photos. Lower scores are less noticeable.
//   colorStep: largest broad color change between neighbouring rings
//   detailDip: how far fine detail drops around the join (a blurred box)
//   streak:    directional bias of detail in the halo (stretched edge pixels)
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "test-results");
const label = process.env.ZOOM_SCENE_LABEL || "current";
const photoDirectory = path.join(output, "photos");
const photos = fs.readdirSync(photoDirectory).filter(name => /\.jpg$/i.test(name)).map(name => path.join(photoDirectory, name));
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
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.ZOOM_BROWSER });
  try {
    const page = await browser.newPage({ serviceWorkers: "block", viewport: { width: 1440, height: 1100 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    if (process.env.ZOOM_RENDERER) await page.route("**/zoom-renderer.js?*", route => route.fulfill({ contentType: "text/javascript", body: fs.readFileSync(process.env.ZOOM_RENDERER, "utf8") }));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    let seed = 42421;
    for (let i = photos.length - 1; i > 0; i--) { seed = (seed * 1664525 + 1013904223) >>> 0; const j = seed % (i + 1); [photos[i], photos[j]] = [photos[j], photos[i]]; }
    await page.locator("#fileInput").setInputFiles(photos);
    await page.waitForFunction(count => !state.isLoading && state.images.length === count, photos.length);
    const sort = process.env.ZOOM_SORT === "1";
    const result = await page.evaluate(async ({ sort }) => {
      const size = 480;
      const base = { ...getSettings(), size };
      let order = state.images.map(image => image.name);
      if (sort) {
        state.images = await sortImagesBySimilarity(state.images, base);
        order = state.images.map(image => image.name);
      }
      const snapshot = makeCanvas(size, size);
      const snapshotCtx = snapshot.getContext("2d", { willReadFrequently: true });
      const measure = (pair, t, settings) => {
        const from = state.images[pair], to = state.images[(pair + 1) % state.images.length];
        drawTransition(from, to, t, settings);
        snapshotCtx.drawImage(previewCanvas, 0, 0);
        const data = snapshotCtx.getImageData(0, 0, size, size).data;
        const transition = getTransition(from, to, settings);
        const camera = PhotoZoom.geometry(t, transition.settings, size, from.canvas.width);
        const x0 = (camera.patchX - camera.viewX) * camera.scale;
        const y0 = (camera.patchY - camera.viewY) * camera.scale;
        const side = camera.patchSize * camera.scale;
        const rings = [], step = 0.025;
        for (let d = 0.3; d <= 0.9; d += step) rings.push({ d, sectors: Array.from({ length: 8 }, () => ({ n: 0, r: 0, g: 0, b: 0, detail: 0, dx: 0, dy: 0 })) });
        const at = (x, y, c) => data[(y * size + x) * 4 + c];
        for (let y = 1; y < size - 1; y++) {
          for (let x = 1; x < size - 1; x++) {
            const u = (x + 0.5 - x0) / side - 0.5, v = (y + 0.5 - y0) / side - 0.5;
            const d = Math.max(Math.abs(u), Math.abs(v));
            const ring = rings[Math.round((d - 0.3) / step)];
            if (!ring || d < 0.3) continue;
            const sector = Math.floor(((Math.atan2(v, u) / (Math.PI * 2) + 1.0625) % 1) * 8);
            const s = ring.sectors[sector];
            const light = (xx, yy) => at(xx, yy, 0) * 0.2126 + at(xx, yy, 1) * 0.7152 + at(xx, yy, 2) * 0.0722;
            const l = light(x, y);
            const gx = light(x + 1, y) - light(x - 1, y), gy = light(x, y + 1) - light(x, y - 1);
            s.n++; s.r += at(x, y, 0); s.g += at(x, y, 1); s.b += at(x, y, 2);
            s.detail += Math.abs(4 * l - light(x + 1, y) - light(x - 1, y) - light(x, y + 1) - light(x, y - 1));
            // Tangential vs radial gradient: stretched edges have detail only
            // along the boundary and none away from it.
            const horizontalSide = Math.abs(u) > Math.abs(v);
            s.dx += Math.abs(horizontalSide ? gy : gx); s.dy += Math.abs(horizontalSide ? gx : gy);
          }
        }
        let colorStep = 0, detailDip = 0, streak = 0, sectors = 0;
        for (let k = 0; k < 8; k++) {
          const series = rings.map(ring => ring.sectors[k]).map(s => s.n > 40 ? { d: 0, ...s } : null);
          const valid = series.map((s, i) => s && { d: rings[i].d, r: s.r / s.n, g: s.g / s.n, b: s.b / s.n, detail: s.detail / s.n, tangential: s.dx / s.n, radial: s.dy / s.n }).filter(Boolean);
          if (valid.length < 6) continue;
          sectors++;
          let step = 0;
          for (let i = 1; i < valid.length; i++) step = Math.max(step, Math.hypot(valid[i].r - valid[i - 1].r, valid[i].g - valid[i - 1].g, valid[i].b - valid[i - 1].b) / 255);
          colorStep += step;
          const details = valid.map(s => s.detail).sort((a, b) => a - b);
          const median = details[Math.floor(details.length / 2)] + 0.5;
          const join = valid.filter(s => s.d >= 0.45 && s.d <= 0.75);
          detailDip += join.length ? Math.max(0, 1 - Math.min(...join.map(s => s.detail)) / median) : 0;
          const halo = valid.filter(s => s.d >= 0.52 && s.d <= 0.75);
          if (halo.length) streak += halo.reduce((sum, s) => sum + Math.abs(Math.log((s.tangential + 0.5) / (s.radial + 0.5))), 0) / halo.length;
        }
        return sectors ? { colorStep: colorStep / sectors, detailDip: detailDip / sectors, streak: streak / sectors } : null;
      };
      setCanvasSize(size);
      const records = [];
      for (const mode of ["blend", "stitched"]) {
        for (const patch of [0.08, 0.16]) {
          const settings = { ...base, mode, patch };
          state.portalOverrides.clear(); invalidateTransitions();
          for (let pair = 0; pair < state.images.length; pair++) {
            const pairScores = [];
            for (const t of [0.25, 0.45, 0.6, 0.72, 0.82, 0.9]) {
              const score = measure(pair, t, settings);
              if (score) pairScores.push(score);
            }
            const mean = key => pairScores.reduce((sum, s) => sum + s[key], 0) / pairScores.length;
            records.push({ mode, patch, pair, colorStep: mean("colorStep"), detailDip: mean("detailDip"), streak: mean("streak") });
          }
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
      // Contact sheet of the stretch where the join is most visible.
      const sheets = [];
      for (const mode of ["blend", "stitched"]) {
        const cell = 300, times = [0.45, 0.6, 0.72, 0.82, 0.9];
        const sheet = makeCanvas(cell * times.length, cell * state.images.length);
        const ctx = sheet.getContext("2d");
        const settings = { ...base, mode, size: 600 };
        state.portalOverrides.clear(); invalidateTransitions(); setCanvasSize(600);
        state.images.forEach((image, row) => times.forEach((time, col) => {
          drawTransition(image, state.images[(row + 1) % state.images.length], time, settings);
          ctx.drawImage(previewCanvas, col * cell, row * cell, cell, cell);
        }));
        sheets.push({ mode, data: sheet.toDataURL("image/jpeg", 0.9) });
      }
      return { order, records, sheets };
    }, { sort });
    for (const sheet of result.sheets) fs.writeFileSync(path.join(output, `seam-${label}-${sheet.mode}.jpg`), Buffer.from(sheet.data.split(",")[1], "base64"));
    delete result.sheets;
    const summary = {};
    for (const record of result.records) {
      const key = `${record.mode}@${record.patch}`;
      summary[key] ||= { colorStep: 0, detailDip: 0, streak: 0, n: 0 };
      for (const metric of ["colorStep", "detailDip", "streak"]) summary[key][metric] += record[metric];
      summary[key].n++;
    }
    for (const value of Object.values(summary)) {
      for (const metric of ["colorStep", "detailDip", "streak"]) value[metric] = +(value[metric] / value.n).toFixed(4);
      delete value.n;
    }
    fs.writeFileSync(path.join(output, `seam-quality-${label}.json`), JSON.stringify({ ...result, summary, errors }, null, 2));
    console.log(JSON.stringify({ label, order: result.order, summary, errors }, null, 1));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
