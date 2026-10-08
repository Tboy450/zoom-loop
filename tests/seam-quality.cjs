// Measures how noticeable each embedded photo is while it grows, using the
// detailed photos in test-results/photos. Lower scores are less noticeable.
//   colorStep: largest broad color change between neighbouring rings
//   detailDip: how far fine detail drops around the join (a blurred box)
//   streak:    directional bias of detail in the halo (stretched edge pixels)
//   ghost:     both photos' fine detail visible at once inside the incoming
//              photo (a double exposure); rimGhost, the same in its outer band
//   squareEdge: color jump straight across the incoming photo's border, in
//              short segments along its sides, so a visible square scores
//              high while ordinary texture averages out
//   detailJump: how much sharper the inside of that border is than the
//              outside (a crisp photo inside a soft, magnified scene)
//   addedEdge, addedStep: squareEdge and colorStep beyond what the scene
//              alone shows in the same place, so busy or shimmering areas,
//              whose own light jumps around, are not counted against a join
//   echo:      how strongly the area just outside the incoming photo copies
//              the photo mirrored across its edges (a kaleidoscope echo)
//   zoomDetail: fine detail in the magnified photo around the incoming one
//              (higher is sharper); with ZOOM_NO_CROPS=1 the sharp crops
//              from the originals are left out, for comparison
// ZOOM_SIZE sets the measuring size (default 480). ZOOM_TESTED=1 runs Find
// Best Spots for each start size and mode before measuring.
// ZOOM_PATCHES picks start sizes (default 0.02,0.08,0.16,0.34). Contact
// sheets show ZOOM_SHEET_COVERAGE, the share of the screen the incoming
// photo covers, so different start sizes show comparable stages.
// It also times preparing each join and drawing a 1080 frame.
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "test-results");
const label = process.env.ZOOM_SCENE_LABEL || "current";
const photoDirectory = path.join(output, process.env.ZOOM_PHOTO_DIR || "photos");
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
    const sheetPatch = Number(process.env.ZOOM_SHEET_PATCH) || 0;
    const sheetTimes = process.env.ZOOM_SHEET_TIMES ? process.env.ZOOM_SHEET_TIMES.split(",").map(Number) : null;
    const sheetCoverage = process.env.ZOOM_SHEET_COVERAGE ? process.env.ZOOM_SHEET_COVERAGE.split(",").map(Number) : null;
    const patches = (process.env.ZOOM_PATCHES || "0.02,0.08,0.16,0.34").split(",").map(Number);
    const modes = (process.env.ZOOM_MODES || "blend,stitched").split(",");
    // Extra settings as JSON, such as {"pixelReveal":1}.
    const extra = process.env.ZOOM_SETTINGS ? JSON.parse(process.env.ZOOM_SETTINGS) : {};
    const result = await page.evaluate(async ({ sort, sheetPatch, sheetTimes, sheetCoverage, patches, modes, extra, measureSize, crops, tested }) => {
      const size = measureSize;
      // Cut sharp crops for each join as "Preparing" does (newer versions).
      const prepareCrops = async settings => {
        if (tested && typeof testPlacements === "function") {
          state.testedSpots.clear();
          await testPlacements(settings);
        }
        if (typeof prepareSharpCrops !== "function") return;
        while (sharpCropsRun) await sharpCropsRun;
        for (const [pair, image] of state.images.entries()) {
          if (crops) await prepareSharpCrops(image, state.images[(pair + 1) % state.images.length], settings);
          else releaseSharpCrops(image);
        }
      };
      const base = { ...getSettings(), size, ...extra };
      let order = state.images.map(image => image.name);
      if (sort) {
        state.images = await sortImagesBySimilarity(state.images, base);
        order = state.images.map(image => image.name);
      }
      const snapshot = makeCanvas(size, size);
      const snapshotCtx = snapshot.getContext("2d", { willReadFrequently: true });
      const reference = makeCanvas(size, size);
      const referenceCtx = reference.getContext("2d", { willReadFrequently: true });
      // Correlation of the frame's fine detail with each photo drawn alone at
      // the same camera position. A double exposure correlates with both.
      const ghostScore = (data, from, to, camera, x0, y0, side, band = [0, 0.38]) => {
        referenceCtx.drawImage(from.canvas, camera.viewX, camera.viewY, camera.viewSize, camera.viewSize, 0, 0, size, size);
        const parent = referenceCtx.getImageData(0, 0, size, size).data;
        referenceCtx.fillStyle = "#000"; referenceCtx.fillRect(0, 0, size, size);
        referenceCtx.drawImage(to.canvas, x0, y0, side, side);
        const child = referenceCtx.getImageData(0, 0, size, size).data;
        const luma = (d, i) => d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722;
        const detail = (d, x, y) => { const i = (y * size + x) * 4, row = size * 4;
          return 4 * luma(d, i) - luma(d, i - 4) - luma(d, i + 4) - luma(d, i - row) - luma(d, i + row); };
        let fp = 0, fc = 0, ff = 0, pp = 0, cc = 0, n = 0;
        for (let y = Math.max(1, Math.ceil(y0)); y < Math.min(size - 1, y0 + side); y += 2) {
          for (let x = Math.max(1, Math.ceil(x0)); x < Math.min(size - 1, x0 + side); x += 2) {
            const d = Math.max(Math.abs((x + 0.5 - x0) / side - 0.5), Math.abs((y + 0.5 - y0) / side - 0.5));
            if (d < band[0] || d >= band[1]) continue;
            const f = detail(data, x, y), a = detail(parent, x, y), b = detail(child, x, y);
            fp += f * a; fc += f * b; ff += f * f; pp += a * a; cc += b * b; n++;
          }
        }
        if (n < 400 || !ff || !pp || !cc) return null;
        return Math.min(Math.max(0, fp / Math.sqrt(ff * pp)), Math.max(0, fc / Math.sqrt(ff * cc)));
      };
      // The incoming photo mirrored across each edge, drawn where it sits.
      const echoScore = (data, to, x0, y0, side) => {
        if (side < 12) return null;
        referenceCtx.fillStyle = "#000"; referenceCtx.fillRect(0, 0, size, size);
        for (let sy = -1; sy <= 1; sy++) for (let sx = -1; sx <= 1; sx++) {
          if (!sx && !sy) continue;
          referenceCtx.save();
          referenceCtx.translate(x0 + sx * side + (sx ? side : 0), y0 + sy * side + (sy ? side : 0));
          referenceCtx.scale(sx ? -1 : 1, sy ? -1 : 1);
          referenceCtx.drawImage(to.canvas, 0, 0, side, side);
          referenceCtx.restore();
        }
        const mirror = referenceCtx.getImageData(0, 0, size, size).data;
        const luma = (d, i) => d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722;
        const detail = (d, x, y) => { const i = (y * size + x) * 4, row = size * 4;
          return 4 * luma(d, i) - luma(d, i - 4) - luma(d, i + 4) - luma(d, i - row) - luma(d, i + row); };
        let fm = 0, ff = 0, mm = 0, n = 0;
        for (let y = 1; y < size - 1; y += 2) {
          for (let x = 1; x < size - 1; x += 2) {
            const d = Math.max(Math.abs((x + 0.5 - x0) / side - 0.5), Math.abs((y + 0.5 - y0) / side - 0.5));
            if (d < 0.52 || d > 0.95) continue;
            const f = detail(data, x, y), m = detail(mirror, x, y);
            fm += f * m; ff += f * f; mm += m * m; n++;
          }
        }
        return n > 200 && ff && mm ? Math.max(0, fm / Math.sqrt(ff * mm)) : null;
      };
      // The same border measures on the scene alone at the same camera.
      const addedJumps = (data, from, camera, x0, y0, side) => {
        if (typeof PhotoZoom.joinVisibility !== "function") return { addedEdge: null, addedStep: null };
        referenceCtx.drawImage(from.canvas, camera.viewX, camera.viewY, camera.viewSize, camera.viewSize, 0, 0, size, size);
        const scene = PhotoZoom.joinVisibility(referenceCtx.getImageData(0, 0, size, size).data, size, x0, y0, side);
        const frame = PhotoZoom.joinVisibility(data, size, x0, y0, side);
        if (!scene || !frame) return { addedEdge: null, addedStep: null };
        return { addedEdge: Math.max(0, frame.squareEdge - scene.squareEdge), addedStep: Math.max(0, frame.colorStep - scene.colorStep) };
      };
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
        // Jump across the photo's own border: thin bands just inside and just
        // outside it, in six segments per side.
        const segments = Array.from({ length: 24 }, () => ({ inside: [0, 0, 0, 0, 0], outside: [0, 0, 0, 0, 0] }));
        for (let y = Math.max(0, Math.floor(y0 - side * 0.06)); y < Math.min(size, y0 + side * 1.06); y++) {
          for (let x = Math.max(0, Math.floor(x0 - side * 0.06)); x < Math.min(size, x0 + side * 1.06); x++) {
            const u = (x + 0.5 - x0) / side - 0.5, v = (y + 0.5 - y0) / side - 0.5;
            const d = Math.max(Math.abs(u), Math.abs(v));
            if (d < 0.44 || d > 0.56 || (d > 0.49 && d < 0.51)) continue;
            const vertical = Math.abs(u) >= Math.abs(v);
            const along = vertical ? v : u;
            const segment = (vertical ? (u > 0 ? 0 : 1) : (v > 0 ? 2 : 3)) * 6 + clamp(Math.floor((along / (2 * d) + 0.5) * 6), 0, 5);
            const band = segments[segment][d < 0.5 ? "inside" : "outside"];
            const i = (y * size + x) * 4;
            band[0] += data[i]; band[1] += data[i + 1]; band[2] += data[i + 2]; band[3]++;
            if (x > 0 && y > 0 && x < size - 1 && y < size - 1) {
              const light = j => data[j] * 0.2126 + data[j + 1] * 0.7152 + data[j + 2] * 0.0722;
              band[4] += Math.abs(4 * light(i) - light(i - 4) - light(i + 4) - light(i - size * 4) - light(i + size * 4));
            }
          }
        }
        // Fine detail of the magnified photo outside the incoming one's band.
        let zoomSum = 0, zoomCount = 0;
        const luma = i => data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
        for (let y = 1; y < size - 1; y += 2) {
          for (let x = 1; x < size - 1; x += 2) {
            const d = Math.max(Math.abs((x + 0.5 - x0) / side - 0.5), Math.abs((y + 0.5 - y0) / side - 0.5));
            if (d < 0.55) continue;
            const i = (y * size + x) * 4;
            zoomSum += Math.abs(4 * luma(i) - luma(i - 4) - luma(i + 4) - luma(i - size * 4) - luma(i + size * 4));
            zoomCount++;
          }
        }
        const zoomDetail = zoomCount > 500 ? zoomSum / zoomCount : null;
        const jumps = segments.filter(s => s.inside[3] > 20 && s.outside[3] > 20)
          .map(s => Math.hypot(...[0, 1, 2].map(c => s.inside[c] / s.inside[3] - s.outside[c] / s.outside[3])) / 255);
        const squareEdge = jumps.length >= 6 ? jumps.reduce((sum, jump) => sum + jump, 0) / jumps.length : null;
        const sharpness = segments.filter(s => s.inside[3] > 20 && s.outside[3] > 20)
          .map(s => Math.abs(Math.log((s.inside[4] / s.inside[3] + 1) / (s.outside[4] / s.outside[3] + 1))));
        const detailJump = sharpness.length >= 6 ? sharpness.reduce((sum, value) => sum + value, 0) / sharpness.length : null;
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
        return sectors ? { colorStep: colorStep / sectors, detailDip: detailDip / sectors, streak: streak / sectors,
          ghost: ghostScore(data, from, to, camera, x0, y0, side), rimGhost: ghostScore(data, from, to, camera, x0, y0, side, [0.38, 0.5]),
          squareEdge, detailJump, zoomDetail, echo: echoScore(data, to, x0, y0, side), ...addedJumps(data, from, camera, x0, y0, side) } : null;
      };
      setCanvasSize(size);
      const records = [];
      for (const mode of modes) {
        for (const patch of patches) {
          const settings = { ...base, mode, patch };
          state.portalOverrides.clear(); invalidateTransitions();
          await prepareCrops(settings);
          for (let pair = 0; pair < state.images.length; pair++) {
            const pairScores = [];
            for (const coverage of [0.15, 0.25, 0.4, 0.55, 0.7, 0.85]) {
              const t = 1 - Math.log(0.8 * coverage) / Math.log(patch);
              const score = t >= 0 && t < 1 ? measure(pair, t, settings) : null;
              if (score) pairScores.push(score);
            }
            const mean = key => { const values = pairScores.map(s => s[key]).filter(value => value !== null);
              return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length); };
            records.push({ mode, patch, pair, colorStep: mean("colorStep"), detailDip: mean("detailDip"), streak: mean("streak"), ghost: mean("ghost"), rimGhost: mean("rimGhost"), squareEdge: mean("squareEdge"), detailJump: mean("detailJump"), zoomDetail: mean("zoomDetail"), echo: mean("echo"), addedEdge: mean("addedEdge"), addedStep: mean("addedStep") });
          }
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
      // Preparation and drawing time at the default 1080 size.
      const timing = {};
      setCanvasSize(1080);
      for (const mode of modes) {
        const settings = { ...base, mode, size: 1080 };
        state.portalOverrides.clear(); invalidateTransitions();
        let began = performance.now();
        state.images.forEach((image, pair) => getTransition(image, state.images[(pair + 1) % state.images.length], settings));
        const prepare = (performance.now() - began) / state.images.length;
        const frames = [];
        for (let pair = 0; pair < state.images.length; pair++) {
          for (const t of [0.2, 0.5, 0.8, 0.95]) {
            began = performance.now();
            drawTransition(state.images[pair], state.images[(pair + 1) % state.images.length], t, settings);
            previewCtx.getImageData(0, 0, 1, 1);
            frames.push(performance.now() - began);
          }
        }
        frames.sort((a, b) => a - b);
        timing[mode] = { prepareMsPerJoin: Math.round(prepare), frameMsMedian: +frames[frames.length >> 1].toFixed(1), frameMsWorst: +frames.at(-1).toFixed(1) };
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      setCanvasSize(size);
      // Contact sheet of the stretch where the join is most visible.
      const sheets = [];
      for (const mode of modes) {
        const cell = 300, times = sheetCoverage || sheetTimes || [0.45, 0.6, 0.72, 0.82, 0.9];
        const sheet = makeCanvas(cell * times.length, cell * state.images.length);
        const ctx = sheet.getContext("2d");
        const settings = { ...base, mode, size: 600, patch: sheetPatch || base.patch };
        state.portalOverrides.clear(); invalidateTransitions(); setCanvasSize(600);
        await prepareCrops(settings);
        const count = state.images.length;
        state.images.forEach((image, row) => times.forEach((value, col) => {
          let segment = row, time = value;
          if (sheetCoverage) {
            // The incoming photo is a grandchild in the previous segment while
            // it covers less than its start size.
            time = 1 - Math.log(0.8 * value) / Math.log(settings.patch);
            if (time < 0) { segment = (row + count - 1) % count; time += 1; }
            if (time < 0) return;
          }
          drawTransition(state.images[segment], state.images[(segment + 1) % count], Math.min(time, 1), settings);
          ctx.drawImage(previewCanvas, col * cell, row * cell, cell, cell);
        }));
        sheets.push({ mode, data: sheet.toDataURL("image/jpeg", 0.9) });
      }
      return { order, records, sheets, timing };
    }, { sort, sheetPatch, sheetTimes, sheetCoverage, patches, modes, extra, measureSize: Number(process.env.ZOOM_SIZE) || 480, crops: !process.env.ZOOM_NO_CROPS, tested: Boolean(process.env.ZOOM_TESTED) });
    for (const sheet of result.sheets) fs.writeFileSync(path.join(output, `seam-${label}-${sheet.mode}.jpg`), Buffer.from(sheet.data.split(",")[1], "base64"));
    delete result.sheets;
    const summary = {};
    for (const record of result.records) {
      const key = `${record.mode}@${record.patch}`;
      summary[key] ||= { colorStep: 0, detailDip: 0, streak: 0, ghost: 0, rimGhost: 0, squareEdge: 0, detailJump: 0, zoomDetail: 0, echo: 0, addedEdge: 0, addedStep: 0, n: 0 };
      for (const metric of ["colorStep", "detailDip", "streak", "ghost", "rimGhost", "squareEdge", "detailJump", "zoomDetail", "echo", "addedEdge", "addedStep"]) summary[key][metric] += record[metric];
      summary[key].n++;
    }
    for (const value of Object.values(summary)) {
      for (const metric of ["colorStep", "detailDip", "streak", "ghost", "rimGhost", "squareEdge", "detailJump", "zoomDetail", "echo", "addedEdge", "addedStep"]) value[metric] = +(value[metric] / value.n).toFixed(4);
      delete value.n;
    }
    fs.writeFileSync(path.join(output, `seam-quality-${label}.json`), JSON.stringify({ ...result, summary, errors }, null, 2));
    console.log(JSON.stringify({ label, summary, timing: result.timing, errors }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
