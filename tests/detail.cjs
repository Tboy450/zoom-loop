const assert = require("node:assert/strict");

// Sharp crops from a photo's original must line up with the 1024 working copy
// (including framing and rotation), or zooming into them would shift the
// picture. Scaled back down, each crop should match the working copy.
module.exports = async function testDetail(browser, url) {
  const page = await browser.newPage({ serviceWorkers: "block" });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto(url);
    const result = await page.evaluate(async () => {
      // A 3000 x 2000 original of smooth waves at several scales: any offset
      // shows clearly, while different scaling methods still agree.
      const original = makeCanvas(3000, 2000), ctx = original.getContext("2d");
      const pixels = ctx.createImageData(3000, 2000);
      for (let y = 0; y < 2000; y++) for (let x = 0; x < 3000; x++) {
        const i = (y * 3000 + x) * 4;
        pixels.data[i] = 128 + 70 * Math.sin(x / 23 + Math.sin(y / 41) * 2) + 40 * Math.sin((x + y) / 97);
        pixels.data[i + 1] = 128 + 80 * Math.sin(y / 29 + Math.cos(x / 53) * 2);
        pixels.data[i + 2] = 128 + 90 * Math.sin((x - y) / 37) * Math.cos(x / 151);
        pixels.data[i + 3] = 255;
      }
      ctx.putImageData(pixels, 0, 0);
      const blob = await new Promise(resolve => original.toBlob(resolve, "image/png"));
      await loadFiles([new File([blob], "detail.png", { type: "image/png" })]);
      const image = state.images.at(-1);
      const compare = async (centerX, centerY) => {
        const crops = await buildPhotoDetail(image, centerX, centerY);
        return crops.map(crop => {
          const size = Math.round(crop.size * SOURCE_SIZE);
          // Both scaled to the working copy's size. Scaling methods differ on
          // hard edges, so the test checks that no offset matches better.
          const grab = (source, sx, sy, sw) => {
            const canvas = makeCanvas(size + 8, size + 8), c = canvas.getContext("2d", { willReadFrequently: true });
            c.imageSmoothingQuality = "high";
            c.drawImage(source, sx, sy, sw, sw, 4, 4, size, size);
            return c.getImageData(0, 0, size + 8, size + 8).data;
          };
          const a = grab(crop.canvas, 0, 0, crop.canvas.width);
          const b = grab(image.canvas, crop.x * SOURCE_SIZE, crop.y * SOURCE_SIZE, size);
          const differenceAt = (dx, dy) => {
            let sum = 0, count = 0;
            for (let y = 8; y < size; y += 2) for (let x = 8; x < size; x += 2) {
              const i = (y * (size + 8) + x) * 4, j = ((y + dy) * (size + 8) + x + dx) * 4;
              sum += Math.abs(a[i] - b[j]) + Math.abs(a[i + 1] - b[j + 1]) + Math.abs(a[i + 2] - b[j + 2]); count += 3;
            }
            return sum / count;
          };
          let best = { dx: 0, dy: 0, mean: Infinity };
          for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
            const mean = differenceAt(dx, dy);
            if (mean < best.mean) best = { dx, dy, mean };
          }
          return { size: crop.size, pixels: crop.canvas.width, offset: [best.dx, best.dy], mean: best.mean, atZero: differenceAt(0, 0) };
        });
      };
      const plain = await compare(0.37, 0.61);
      // Reframe like the Frame dialog does: zoomed, moved and turned.
      const source = await loadPhotoSource(image.sourceBlob);
      image.framing = { x: 0.2, y: 0.7, zoom: 1.2, rotation: 90 };
      const framed = makeCanvas(SOURCE_SIZE, SOURCE_SIZE);
      drawPhotoFrame(framed.getContext("2d", { alpha: false }), source, SOURCE_SIZE, SOURCE_SIZE, image.framing);
      source.dispose();
      image.canvas = framed;
      const turned = await compare(0.62, 0.3);
      // No original, or one no sharper than the working copy: no crops.
      const noOriginal = await buildPhotoDetail({ canvas: image.canvas }, 0.5, 0.5);
      const smallOriginal = makeCanvas(1100, 900);
      smallOriginal.getContext("2d").fillRect(0, 0, 1100, 900);
      const smallBlob = await new Promise(resolve => smallOriginal.toBlob(resolve, "image/png"));
      const tooSmall = await buildPhotoDetail({ sourceBlob: smallBlob, canvas: image.canvas }, 0.5, 0.5);
      return { plain, turned, noOriginal, tooSmall };
    });
    for (const check of [...result.plain, ...result.turned]) {
      assert.deepEqual(check.offset, [0, 0], `Crops must line up with the working copy: ${JSON.stringify(check)}`);
      assert.ok(check.atZero < 3, JSON.stringify(check));
    }
    assert.equal(result.plain.length, 2, "A large original gives a wide and a close crop");
    assert.ok(result.plain.every(check => check.pixels > check.size * 1024 * 1.25), JSON.stringify(result.plain));
    assert.equal(result.noOriginal, null);
    assert.equal(result.tooSmall, null);
    const zoom = await testZoom(page);
    assert.deepEqual(errors, []);
    return { plain: result.plain.map(c => +c.atZero.toFixed(2)), turned: result.turned.map(c => +c.atZero.toFixed(2)), zoom };
  } finally {
    await page.close();
  }
};

// With crops prepared, handoffs must stay pixel-identical, including at 2160
// where a photo filling the screen already shows them, and fading the crops
// in must not make any frame jump.
async function testZoom(page) {
  const result = await page.evaluate(async () => {
    clearImages();
    const files = [];
    for (let n = 0; n < 4; n++) {
      // Fine detail (periods of a few original pixels) that the 1024 working
      // copy cannot hold, over broad shapes that differ between photos.
      const original = makeCanvas(2400, 2400), ctx = original.getContext("2d");
      const pixels = ctx.createImageData(2400, 2400);
      for (let y = 0; y < 2400; y++) for (let x = 0; x < 2400; x++) {
        const i = (y * 2400 + x) * 4, fine = 30 * Math.sin(x / 1.3 + n) * Math.sin(y / 1.7);
        pixels.data[i] = 120 + 60 * Math.sin(x / (90 + n * 20)) + fine;
        pixels.data[i + 1] = 120 + 60 * Math.sin(y / (70 + n * 15) + n) + fine;
        pixels.data[i + 2] = 120 + 60 * Math.sin((x + y) / (110 - n * 10)) + fine;
        pixels.data[i + 3] = 255;
      }
      ctx.putImageData(pixels, 0, 0);
      const blob = await new Promise(resolve => original.toBlob(resolve, "image/png"));
      files.push(new File([blob], `fine-${n}.png`, { type: "image/png" }));
    }
    await loadFiles(files);
    const delta = (a, b) => {
      let sum = 0, max = 0;
      for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); sum += d; if (d > max) max = d; }
      return { mean: sum / a.length, max };
    };
    const out = {};
    for (const size of [1080, 2160]) {
      const settings = { ...getSettings(), mode: "blend", patch: 0.08, size };
      state.portalOverrides.clear(); invalidateTransitions(); setCanvasSize(size);
      const snapshot = makeCanvas(size, size), snapshotCtx = snapshot.getContext("2d", { willReadFrequently: true });
      const render = (pair, t) => {
        drawTransition(state.images[pair], state.images[(pair + 1) % state.images.length], t, settings);
        snapshotCtx.drawImage(previewCanvas, 0, 0);
        return snapshotCtx.getImageData(0, 0, size, size).data;
      };
      // Frame-to-frame change at 30 fps for a 5 s photo, through the stretch
      // where crops fade in. Sharper detail moving adds change gradually; a
      // jump would show as one frame changing far more than its neighbours.
      const spikes = () => {
        const steps = [];
        let previous = render(0, 0.1);
        for (let t = 0.1 + 1 / 150; t < 0.8; t += 1 / 150) {
          const frame = render(0, t);
          steps.push(delta(previous, frame).mean);
          previous = frame;
        }
        let worst = 0;
        for (let k = 1; k < steps.length - 1; k++) worst = Math.max(worst, steps[k] / ((steps[k - 1] + steps[k + 1]) / 2));
        return worst;
      };
      state.images.forEach(releaseSharpCrops);
      const without = size === 1080 ? spikes() : null;
      const plainFrame = render(0, 0.5);
      for (const [pair, image] of state.images.entries()) await prepareSharpCrops(image, state.images[(pair + 1) % state.images.length], settings);
      // A redraw may have started a background run meanwhile; let it finish.
      while (sharpCropsRun) await sharpCropsRun;
      const prepared = state.images.filter(image => image.detailKey).length;
      const sharpened = delta(plainFrame, render(0, 0.5)).mean;
      const seams = state.images.map((image, pair) => delta(render(pair, 1), render((pair + 1) % state.images.length, 0)));
      out[size] = { prepared, seams, sharpened, without, with: size === 1080 ? spikes() : null };
    }
    return out;
  });
  for (const size of [1080, 2160]) {
    assert.equal(result[size].prepared, 4, `Every photo gets crops at ${size}`);
    assert.ok(result[size].sharpened > 0.5, `Crops must show while zoomed in: ${result[size].sharpened}`);
    for (const seam of result[size].seams) assert.ok(seam.max <= 3 && seam.mean < 0.03, `Handoff changed with crops at ${size}: ${JSON.stringify(seam)}`);
  }
  const fade = result[1080];
  assert.ok(fade.with <= Math.max(1.1, fade.without + 0.05), `Crops fading in must not jump: ${JSON.stringify(fade)}`);
  return { sharpened: [1080, 2160].map(size => +result[size].sharpened.toFixed(2)), seamMax: Math.max(...[1080, 2160].flatMap(size => result[size].seams.map(seam => seam.max))), fadeWithout: +fade.without.toFixed(3), fadeWith: +fade.with.toFixed(3) };
}
