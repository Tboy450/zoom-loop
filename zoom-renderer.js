"use strict";

// Every photo lives in the coordinate system of its parent. Zooming changes
// only the camera; it never moves or spawns a portal during a transition.
const PhotoZoom = (() => {
  const TEXTURE_SIZE = 640;
  const HALO = 0.5;
  const SPAN = 1 + HALO * 2;
  const FRAME = 0.8;
  const MAX_LAYER = 4096;
  // Photo Blend reveal, as the share of the screen a photo covers. Its form
  // grows out of matching areas from REVEAL_START to FORM_END; its border
  // stays softly camouflaged until RIM_END; it is lit like its surroundings
  // until LIGHT_END. Cinematic mode starts later and dissolves more softly.
  const REVEAL_START = 0.1;
  const FORM_END = 0.5;
  const CINEMATIC_REVEAL_START = 0.14;
  const CINEMATIC_FORM_END = 0.7;
  const RIM_END = 0.92;
  const LIGHT_END = 0.95;
  const RIM_LIGHT_START = 0.3;
  const RIM_LIGHT_END = 0.97;
  const REVEAL_MAP = 128;
  // Least share of the photo's detail its camouflage always carries, up to
  // PRESENCE_LEVELS levels of brightness.
  const PRESENCE = 0.1;
  // Fractal morphology around a forming photo: how far its material reaches
  // past its edge ([where it clashes, where it matches], in photo widths),
  // how strongly its folds bend, where its shapes have dissolved into their
  // colors, and how deep into the photo a fold reaches back for material
  // (1 would be a mirror; less reuses the material nearer its edge).
  const MORPH_REACH = [0.16, 0.42];
  const MORPH_WARP = 1.8;
  const MORPH_DISSOLVE = 0.08;
  const MORPH_DEPTH = 0.4;

  // Replaces the straight mirror past a photo's edge (drawExtended) in a
  // texture: each outside pixel folds back into the photo along a path bent
  // by fractal noise, which grows with distance, so the border continues the
  // photo at its edge without mirror lines or corner ornaments, and its
  // shapes melt into their colors farther out. The photo itself is unchanged.
  // Edge styles: "band" (the default: an exact mirror in a thin band at the
  // edge that continues the photo's lines across its border, fractal folds
  // beyond it), "fractal" (fractal folds from the edge) and "mirror" (a
  // plain reflection, as before).
  const MIRROR_BAND = 0.1;
  function morphBorder(image, band = 0) {
    const size = image.width, data = image.data, original = new Uint8ClampedArray(data);
    const soft = lowPass(image, 6), softer = lowPass(image, 16);
    for (let y = 0; y < size; y++) {
      const mv = (y + 0.5) / size * SPAN - HALO;
      for (let x = 0; x < size; x++) {
        const mu = (x + 0.5) / size * SPAN - HALO;
        const beyond = Math.max(0, -mu, mu - 1, -mv, mv - 1);
        if (beyond <= 0) continue;
        const fold = band ? smooth(0, band, beyond) : 1;
        const warp = beyond * MORPH_WARP * fold, depth = mix(1, MORPH_DEPTH, fold);
        let su = mu < 0 ? -mu * depth : mu > 1 ? 1 - (mu - 1) * depth : mu;
        let sv = mv < 0 ? -mv * depth : mv > 1 ? 1 - (mv - 1) * depth : mv;
        su = clamp(su + fractalNoise(mu * 7, mv * 7, 1) * warp, 0, 1);
        sv = clamp(sv + fractalNoise(mu * 7, mv * 7, 2) * warp, 0, 1);
        const sx = clamp(Math.floor((su + HALO) / SPAN * size), 0, size - 1);
        const sy = clamp(Math.floor((sv + HALO) / SPAN * size), 0, size - 1);
        const from = sy * size + sx, to = (y * size + x) * 4;
        const melt = smooth(0, MORPH_DISSOLVE, beyond), melted = smooth(MORPH_DISSOLVE * 0.5, MORPH_DISSOLVE * 1.5, beyond);
        for (let c = 0; c < 3; c++) {
          const sharp = original[from * 4 + c];
          data[to + c] = mix(mix(sharp, soft[from * 3 + c], melt), softer[from * 3 + c], melted);
        }
      }
    }
    return image;
  }
  const PRESENCE_LEVELS = 4;
  const analysisCache = new WeakMap();
  const extensionCache = new WeakMap();
  const layers = [];
  const detailCache = new WeakMap();
  const featureCache = new WeakMap();
  const anchorFields = new WeakMap();
  const matchCache = new WeakMap();
  let detailCutout;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const mix = (a, b, t) => a + (b - a) * t;
  // Smooth value noise in [0, 1] and a fractal sum of it in [-1, 1]: the
  // same irregular structure at several scales.
  const hashNoise = (x, y) => {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const valueNoise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
    const top = hashNoise(xi, yi) + (hashNoise(xi + 1, yi) - hashNoise(xi, yi)) * sx;
    const bottom = hashNoise(xi, yi + 1) + (hashNoise(xi + 1, yi + 1) - hashNoise(xi, yi + 1)) * sx;
    return top + (bottom - top) * sy;
  };
  const fractalNoise = (x, y, seed) => {
    let sum = 0, amplitude = 0.5, frequency = 1;
    for (let octave = 0; octave < 4; octave++) {
      sum += (valueNoise(x * frequency + seed * 17.3, y * frequency + seed * 31.7) * 2 - 1) * amplitude;
      amplitude *= 0.5; frequency *= 2.03;
    }
    return sum / 0.9375;
  };
  const smooth = (lo, hi, v) => {
    const t = clamp((v - lo) / (hi - lo), 0, 1);
    return t * t * (3 - 2 * t);
  };

  function canvas(size) {
    const result = document.createElement("canvas");
    result.width = result.height = size;
    return result;
  }

  function pixels(source, size) {
    const result = canvas(size);
    const ctx = result.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, size, size);
    return ctx.getImageData(0, 0, size, size);
  }

  function drawExtended(ctx, source, x, y, size) {
    const pad = size * HALO;
    const w = source.width, h = source.height;
    // Reflect the photo across each edge. Stretching only the boundary row
    // painted visible streaks (or, once blurred, a soft box) around every
    // join; a reflection keeps the photo's own texture and lighting there.
    for (const sy of [-1, 0, 1]) {
      for (const sx of [-1, 0, 1]) {
        if (!sx && !sy) continue;
        ctx.save();
        ctx.translate(sx < 0 ? x : sx > 0 ? x + size : 0, sy < 0 ? y : sy > 0 ? y + size : 0);
        ctx.scale(sx ? -1 : 1, sy ? -1 : 1);
        const srcX = sx > 0 ? w * (1 - HALO) : 0, srcW = sx ? w * HALO : w;
        const srcY = sy > 0 ? h * (1 - HALO) : 0, srcH = sy ? h * HALO : h;
        ctx.drawImage(source, srcX, srcY, srcW, srcH,
          sx > 0 ? -pad : sx < 0 ? 0 : x, sy > 0 ? -pad : sy < 0 ? 0 : y, sx ? pad : size, sy ? pad : size);
        ctx.restore();
      }
    }
    ctx.drawImage(source, x, y, size, size);
  }

  function analysis(source) {
    if (!analysisCache.has(source)) {
      const data = pixels(source, 128);
      const stride = data.width + 1;
      data.integrals = Array.from({ length: 4 }, () => new Float64Array(stride * stride));
      for (let y = 0; y < data.height; y++) {
        const row = [0, 0, 0, 0];
        for (let x = 0; x < data.width; x++) {
          const i = (y * data.width + x) * 4;
          const light = data.data[i] * 0.2126 + data.data[i + 1] * 0.7152 + data.data[i + 2] * 0.0722;
          for (let c = 0; c < 4; c++) {
            row[c] += c === 3 ? light * light : data.data[i + c];
            data.integrals[c][(y + 1) * stride + x + 1] = row[c] + data.integrals[c][y * stride + x + 1];
          }
        }
      }
      analysisCache.set(source, data);
    }
    return analysisCache.get(source);
  }

  function extension(source) {
    if (extensionCache.has(source)) return extensionCache.get(source);
    const result = canvas(TEXTURE_SIZE);
    const ctx = result.getContext("2d", { willReadFrequently: true });
    drawExtended(ctx, source, TEXTURE_SIZE * HALO / SPAN, TEXTURE_SIZE * HALO / SPAN, TEXTURE_SIZE / SPAN);
    const data = ctx.getImageData(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
    const low = lowPass(data, 64);
    for (let y = 0; y < TEXTURE_SIZE; y++) {
      for (let x = 0; x < TEXTURE_SIZE; x++) {
        const pixel = y * TEXTURE_SIZE + x;
        // Keep the photo, and its reflected detail just past the edge, sharp.
        // A uniformly blurred backing showed up as a soft ring at every join.
        const u = (x + 0.5) / TEXTURE_SIZE * SPAN - HALO, v = (y + 0.5) / TEXTURE_SIZE * SPAN - HALO;
        const detail = 1 - smooth(0, 0.3, Math.max(0, -u, u - 1, -v, v - 1));
        for (let c = 0; c < 3; c++) {
          const i = pixel * 4 + c;
          data.data[i] = mix(low[pixel * 3 + c], data.data[i], detail);
        }
      }
    }
    ctx.putImageData(data, 0, 0);
    extensionCache.set(source, result);
    return result;
  }

  function drawProjectedPhoto(ctx, source, x, y, core, offsetX, offsetY, outputSize) {
    const left = Math.max(x, -offsetX), top = Math.max(y, -offsetY);
    const right = Math.min(x + core, outputSize - offsetX), bottom = Math.min(y + core, outputSize - offsetY);
    if (right <= left || bottom <= top) return;
    ctx.drawImage(source, (left - x) / core * source.width, (top - y) / core * source.height,
      (right - left) / core * source.width, (bottom - top) / core * source.height,
      left, top, right - left, bottom - top);
  }

  function drawPhotoDetail(ctx, source, x, y, core, offsetX, offsetY, outputSize, patch) {
    const inset = core * 0.09;
    if (x + offsetX + inset <= 0 && y + offsetY + inset <= 0 &&
        x + offsetX + core - inset >= outputSize && y + offsetY + core - inset >= outputSize) {
      drawProjectedPhoto(ctx, source, x, y, core, offsetX, offsetY, outputSize);
    } else {
      drawProjectedPhoto(ctx, photoDetail(source, patch), x, y, core, offsetX, offsetY, outputSize);
    }
    drawSharpCrops(ctx, source, x, y, core, offsetX, offsetY, outputSize);
  }

  // Sharp crops of a photo's original (see setDetail), drawn over the 1024
  // working copy. Each fades in once it is no longer much reduced on screen
  // (from 0.55 to 0.85 screen pixels per crop pixel), so the wide crop
  // shows first and the close one later, without the shimmer of a shrunken
  // image. Crops stay out of the photo's border band, which is softened for
  // the join and never seen once the photo fills the screen. They are drawn
  // the same way whether the photo is on its own or nested, so handoffs stay
  // pixel-identical.
  const sharpCrops = new WeakMap();
  const CROP_BAND = [0.36, 0.4];
  function setDetail(source, crops) {
    const previous = sharpCrops.get(source);
    if (previous) releaseCanvases(...previous.map(crop => crop.canvas));
    if (!crops) { sharpCrops.delete(source); return; }
    for (const crop of crops) {
      // Fades over the crop's outer fifth, so sharpness changes gradually.
      const mask = canvas(64), maskCtx = mask.getContext("2d");
      const pixels = maskCtx.createImageData(64, 64);
      for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 64; x++) {
          const edge = smooth(0, 0.2, Math.min(x + 0.5, y + 0.5, 63.5 - x, 63.5 - y) / 64);
          const u = crop.x + (x + 0.5) / 64 * crop.size, v = crop.y + (y + 0.5) / 64 * crop.size;
          const band = 1 - smooth(CROP_BAND[0], CROP_BAND[1], Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)));
          pixels.data[(y * 64 + x) * 4 + 3] = 255 * edge * band;
        }
      }
      maskCtx.putImageData(pixels, 0, 0);
      const cropCtx = crop.canvas.getContext("2d");
      // The crop may still carry the transform it was cut with.
      cropCtx.setTransform(1, 0, 0, 1, 0, 0);
      cropCtx.globalCompositeOperation = "destination-in";
      cropCtx.drawImage(mask, 0, 0, crop.canvas.width, crop.canvas.height);
      cropCtx.globalCompositeOperation = "source-over";
      releaseCanvases(mask);
    }
    // Widest first, so the closest, sharpest crop ends on top.
    sharpCrops.set(source, [...crops].sort((a, b) => b.size - a.size));
  }

  function drawSharpCrops(ctx, source, x, y, core, offsetX, offsetY, outputSize) {
    const crops = sharpCrops.get(source);
    if (!crops) return;
    for (const crop of crops) {
      const alpha = smooth(0.55, 0.85, crop.size * core / crop.canvas.width);
      if (alpha <= 0) continue;
      ctx.globalAlpha = alpha;
      drawProjectedPhoto(ctx, crop.canvas, x + crop.x * core, y + crop.y * core, crop.size * core, offsetX, offsetY, outputSize);
    }
    ctx.globalAlpha = 1;
  }

  // The photo with its border band softened and its outermost edge faded,
  // cached per photo. Built while preparing a join so playback never stalls.
  function photoDetail(source, patch) {
    if (!detailCutout) {
      detailCutout = canvas(128);
      const maskCtx = detailCutout.getContext("2d");
      const mask = maskCtx.createImageData(128, 128);
      for (let y = 0; y < 128; y++) {
        for (let x = 0; x < 128; x++) {
          const edge = Math.min(x, y, 127 - x, 127 - y) / 128;
          mask.data[(y * 128 + x) * 4 + 3] = 255 * (1 - smooth(0, 0.085, edge));
        }
      }
      maskCtx.putImageData(mask, 0, 0);
    }
    let cached = detailCache.get(source);
    if (!cached || cached.patch !== patch) {
      const sharp = cached?.canvas || canvas(source.width);
      const detailCtx = sharp.getContext("2d", { willReadFrequently: true });
      detailCtx.globalCompositeOperation = "copy";
      detailCtx.drawImage(source, 0, 0);
      detailCtx.globalCompositeOperation = "source-over";
      softenBorder(detailCtx, sharp.width, patch);
      detailCtx.globalCompositeOperation = "destination-out";
      detailCtx.drawImage(detailCutout, 0, 0, sharp.width, sharp.height);
      detailCtx.globalCompositeOperation = "source-over";
      cached = { canvas: sharp, patch };
      detailCache.set(source, cached);
    }
    return cached.canvas;
  }

  // The photo's own outer tenth, softened toward its border like the
  // surround (see borderDetail): the magnified parent around it cannot show
  // detail finer than 1/patch photo pixels, so a sharp border read as a
  // square. The full frame after the handoff never includes this band.
  function softenBorder(ctx, size, patch) {
    const radius = Math.round(0.6 / patch * size / 1024);
    if (radius < 1) return;
    const image = ctx.getImageData(0, 0, size, size);
    const blurred = lowPass(image, radius);
    for (let y = 0; y < size; y++) {
      const dy = Math.abs((y + 0.5) / size - 0.5);
      for (let x = 0; x < size; x++) {
        const amount = borderBand(Math.max(dy, Math.abs((x + 0.5) / size - 0.5)));
        if (!amount) continue;
        const i = (y * size + x) * 4, k = (y * size + x) * 3;
        for (let c = 0; c < 3; c++) image.data[i + c] = mix(image.data[i + c], blurred[k + c], amount);
      }
    }
    ctx.putImageData(image, 0, 0);
  }

  function sample(data, u, v, channel) {
    const x = clamp(u * data.width - 0.5, 0, data.width - 1);
    const y = clamp(v * data.height - 0.5, 0, data.height - 1);
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const nx = Math.min(ix + 1, data.width - 1);
    const ny = Math.min(iy + 1, data.height - 1);
    const top = mix(data.data[(iy * data.width + ix) * 4 + channel],
      data.data[(iy * data.width + nx) * 4 + channel], x - ix);
    const bottom = mix(data.data[(ny * data.width + ix) * 4 + channel],
      data.data[(ny * data.width + nx) * 4 + channel], x - ix);
    return mix(top, bottom, y - iy);
  }

  function patchSamples(data, x, y, width) {
    const values = new Float32Array(8 * 8 * 3);
    const texture = new Float32Array(64);
    const edges = new Float32Array(112);
    const mean = [0, 0, 0];
    // Interpolated summed-area values at the 9 × 9 cell corners, shared by
    // neighbouring cells, for red, green, blue and squared light.
    const corners = new Float64Array(81 * 4);
    const stride = data.width + 1;
    for (let j = 0; j <= 8; j++) {
      const py = clamp((y + j / 8 * width) * data.height, 0, data.height);
      const iy = Math.floor(py), ny = Math.min(iy + 1, data.height), fy = py - iy;
      for (let i = 0; i <= 8; i++) {
        const px = clamp((x + i / 8 * width) * data.width, 0, data.width);
        const ix = Math.floor(px), nx = Math.min(ix + 1, data.width), fx = px - ix;
        for (let c = 0; c < 4; c++) {
          const sum = data.integrals[c];
          corners[(j * 9 + i) * 4 + c] = mix(mix(sum[iy * stride + ix], sum[iy * stride + nx], fx),
            mix(sum[ny * stride + ix], sum[ny * stride + nx], fx), fy);
        }
      }
    }
    const area = (width / 8) ** 2 * data.width * data.height;
    let edgeIndex = 0;
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const a = (row * 9 + col) * 4, b = a + 4, c0 = a + 36, d = a + 40;
        const average = c => (corners[d + c] - corners[c0 + c] - corners[b + c] + corners[a + c]) / area;
        const r = average(0), g = average(1), bl = average(2);
        const light = r * 0.2126 + g * 0.7152 + bl * 0.0722;
        const index = row * 8 + col;
        values[index * 3] = light / 255;
        values[index * 3 + 1] = (r - light) / 255;
        values[index * 3 + 2] = (bl - light) / 255;
        for (let c = 0; c < 3; c++) mean[c] += values[index * 3 + c] / 64;
        texture[index] = Math.sqrt(Math.max(0, average(3) - light * light)) / 255;
        if (col) edges[edgeIndex++] = values[index * 3] - values[(index - 1) * 3];
        if (row) edges[edgeIndex++] = values[index * 3] - values[(index - 8) * 3];
      }
    }
    return { values, mean, texture, edges };
  }

  function comparePatches(candidate, target, priority = "balanced") {
    let pattern = 0, texture = 0, edges = 0, rim = 0;
    for (let i = 0; i < candidate.values.length; i++) {
      const c = i % 3;
      const a = candidate.values[i] - candidate.mean[c];
      const b = target.values[i] - target.mean[c];
      const weight = c === 0 ? 1 : 0.5;
      pattern += Math.abs(a - b) * weight;
      const pixel = Math.floor(i / 3), row = Math.floor(pixel / 8), col = pixel % 8;
      if (!row || row === 7 || !col || col === 7) rim += Math.abs(candidate.values[i] - target.values[i]) * weight;
    }
    for (let i = 0; i < 64; i++) texture += Math.abs(candidate.texture[i] - target.texture[i]);
    for (let i = 0; i < 112; i++) edges += Math.abs(candidate.edges[i] - target.edges[i]);
    const light = Math.abs(candidate.mean[0] - target.mean[0]);
    const color = Math.hypot(candidate.mean[1] - target.mean[1], candidate.mean[2] - target.mean[2]);
    const weights = priority === "lighting" ? [0.3, 0.28, 0.12, 0.06, 0.1, 0.14] :
      priority === "structure" ? [0.13, 0.12, 0.27, 0.23, 0.13, 0.12] : [0.22, 0.2, 0.22, 0.12, 0.12, 0.12];
    return light * weights[0] + color * weights[1] + pattern / 128 * weights[2] +
      edges / 112 * weights[3] + texture / 64 * weights[4] + rim / 56 * weights[5];
  }

  function photoFeatures(source) {
    if (!featureCache.has(source)) {
      const data = analysis(source), inset = (1 - FRAME) / 2;
      featureCache.set(source, { core: patchSamples(data, inset, inset, FRAME), full: patchSamples(data, 0, 0, 1) });
    }
    return featureCache.get(source);
  }

  function anchorCandidate(data, anchorX, anchorY, p) {
    const inset = (1 - FRAME) / 2, x = anchorX - p / 2, y = anchorY - p / 2;
    let boundary = 0;
    for (let i = 0; i < 8; i++) {
      const along = (i + 0.5) / 8, step = p / 16;
      for (const edge of [0, 1]) {
        for (let c = 0; c < 3; c++) {
          boundary += Math.abs(sample(data, x + p * along, y + p * edge - step, c) - sample(data, x + p * along, y + p * edge + step, c));
          boundary += Math.abs(sample(data, x + p * edge - step, y + p * along, c) - sample(data, x + p * edge + step, y + p * along, c));
        }
      }
    }
    return { anchorX, anchorY, core: patchSamples(data, x + p * inset, y + p * inset, p * FRAME),
      full: patchSamples(data, x, y, p), boundary: boundary / (96 * 255) };
  }

  // Where a photo's light shifts: reflections, glare, ripples, foliage and
  // other irregular, curved variation. A forming photo disappears best there,
  // since whatever it adds looks like more of the same. Plain areas score
  // low, and long straight lines (all one direction) somewhat lower. Kept
  // as an integral image over a 256 grid, for fast window means.
  const shimmerCache = new WeakMap();
  const SHIMMER_GRID = 256;
  function shimmerMap(source) {
    if (shimmerCache.has(source)) return shimmerCache.get(source);
    const size = SHIMMER_GRID, n = size * size, image = pixels(source, size);
    const luma = (values, i, stride) => values[i * stride] * 0.2126 + values[i * stride + 1] * 0.7152 + values[i * stride + 2] * 0.0722;
    const fineBlur = lowPass(image, 2), broadBlur = lowPass(image, 8);
    const energy = { width: size, data: new Float32Array(n * 4) };
    const tensor = { width: size, data: new Float32Array(n * 4) };
    const near = new Float32Array(n);
    for (let i = 0; i < n; i++) near[i] = luma(fineBlur, i, 3);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const light = luma(image.data, i, 4), broad = luma(broadBlur, i, 3);
        // Fine flicker, mid-scale variation, and highlights brighter than
        // their surroundings (glints and glare).
        energy.data[i * 4] = Math.abs(light - near[i]) * 0.4 + Math.abs(near[i] - broad) * 0.6 + Math.max(0, near[i] - broad) * 0.4;
        const gx = near[y * size + Math.min(size - 1, x + 1)] - near[y * size + Math.max(0, x - 1)];
        const gy = near[Math.min(size - 1, y + 1) * size + x] - near[Math.max(0, y - 1) * size + x];
        tensor.data[i * 4] = gx * gx; tensor.data[i * 4 + 1] = gy * gy; tensor.data[i * 4 + 2] = gx * gy;
      }
    }
    const local = lowPass(energy, 6), structure = lowPass(tensor, 6);
    const stride = size + 1, integral = new Float64Array(stride * stride);
    for (let y = 0; y < size; y++) {
      let row = 0;
      for (let x = 0; x < size; x++) {
        const i = y * size + x, xx = structure[i * 3], yy = structure[i * 3 + 1], xy = structure[i * 3 + 2];
        // 1 when every edge nearby runs the same way, 0 when they turn freely.
        const coherence = Math.sqrt((xx - yy) ** 2 + 4 * xy * xy) / (xx + yy + 1e-3);
        row += local[i * 3] * (1 - 0.45 * coherence);
        integral[(y + 1) * stride + x + 1] = row + integral[y * stride + x + 1];
      }
    }
    const result = { integral, stride, size };
    shimmerCache.set(source, result);
    return result;
  }

  function shimmerAt(map, x, y, width) {
    const x0 = clamp(Math.round(x * map.size), 0, map.size), y0 = clamp(Math.round(y * map.size), 0, map.size);
    const x1 = clamp(Math.round((x + width) * map.size), x0 + 1, map.size), y1 = clamp(Math.round((y + width) * map.size), y0 + 1, map.size);
    const { integral, stride } = map;
    return (integral[y1 * stride + x1] - integral[y0 * stride + x1] - integral[y1 * stride + x0] + integral[y0 * stride + x0]) /
      Math.max(1, (x1 - x0) * (y1 - y0));
  }

  // Spots are judged over at least MIN_MATCH of the photo: a 1% patch is
  // about ten pixels of the parent, too little to tell whether the next
  // photo blends in. Each spot also records the light and color of the area
  // around it that stays on screen while the next photo forms.
  const MIN_MATCH = 0.06;
  const CONTEXT = 3;
  function anchorField(parent, p) {
    let field = anchorFields.get(parent);
    if (!field || field.patch !== p) {
      const parentData = analysis(parent);
      const margin = (1 - FRAME) / 2 + p / 2 + 0.05;
      const size = Math.max(p, MIN_MATCH);
      // Shimmer over the spot and the band around it where its halo forms,
      // relative to the photo's most shimmering areas (90th percentile).
      const shimmer = shimmerMap(parent), reach = size * 1.5;
      const windows = [];
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        windows.push(shimmerAt(shimmer, mix(margin, 1 - margin, x / 15) - reach / 2, mix(margin, 1 - margin, y / 15) - reach / 2, reach));
      }
      windows.sort((a, b) => a - b);
      const shimmerTop = Math.max(1e-3, windows[Math.floor(windows.length * 0.9)]);
      const candidate = (x, y) => {
        const result = anchorCandidate(parentData, x, y, size);
        result.shimmer = clamp(shimmerAt(shimmer, x - reach / 2, y - reach / 2, reach) / shimmerTop, 0, 1);
        const area = Math.min(0.9, size * CONTEXT);
        result.context = patchSamples(parentData, x - area / 2, y - area / 2, area).mean;
        // The 8 x 8 cells of a window 8/6 the spot's size: its outer ring of
        // cells is the parent just outside the spot, which meets the photo's
        // edge at the seam.
        result.ring = patchSamples(parentData, x - size * 2 / 3, y - size * 2 / 3, size * 4 / 3);
        return result;
      };
      field = { patch: p, center: candidate(0.5, 0.5), grids: [], candidate };
      for (const limit of [Math.max(0.32, margin), margin]) {
        const grid = [];
        for (let y = 0; y < 13; y++) for (let x = 0; x < 13; x++) grid.push(candidate(mix(limit, 1 - limit, x / 12), mix(limit, 1 - limit, y / 12)));
        field.grids.push(grid);
      }
      anchorFields.set(parent, field);
    }
    return field;
  }

  // How well a spot suits the next photo, lower being better: the photo
  // against the spot itself and against the area around it that stays on
  // screen while it forms, and its edge against what touches it.
  function spotMatch(candidate, target, settings) {
    // Shimmer placement judges fit by light and color: shifting light hides
    // differences in texture.
    const shimmering = settings.placementStyle === "shimmer";
    const priority = shimmering ? "lighting" : settings.matchPriority;
    const own = comparePatches(candidate.core, target.core, priority) * 0.65 +
      comparePatches(candidate.full, target.full, priority) * 0.35 + candidate.boundary * 0.04;
    const context = candidate.context;
    const surroundings = Math.abs(target.full.mean[0] - context[0]) * 0.6 +
      Math.hypot(target.full.mean[1] - context[1], target.full.mean[2] - context[2]) * 0.4;
    // Seam: each cell along the photo's edge against the parent cell just
    // outside it, in light and color.
    let seam = 0, cells = 0;
    for (let k = 0; k < 8; k++) {
      for (const [inner, outer] of [[k, k], [56 + k, 56 + k], [k * 8, k * 8], [k * 8 + 7, k * 8 + 7]]) {
        const a = target.full.values, b = candidate.ring.values;
        seam += Math.abs(a[inner * 3] - b[outer * 3]) * 0.6 +
          Math.hypot(a[inner * 3 + 1] - b[outer * 3 + 1], a[inner * 3 + 2] - b[outer * 3 + 2]) * 0.4;
        cells++;
      }
    }
    // The surroundings fill more of the screen while small photos form.
    const match = own + surroundings * SURROUNDINGS_WEIGHT * (1 - smooth(0.03, 0.12, settings.patch)) + seam / cells * SEAM_WEIGHT;
    // Shimmer placement: shifting light counts for up to SHIMMER_PULL of the
    // score, so a shimmering spot wins unless its colors fit clearly worse.
    return shimmering ? match * (1 - SHIMMER_PULL * candidate.shimmer) : match;
  }
  const SHIMMER_PULL = 0.5;
  const SURROUNDINGS_WEIGHT = 0.3;
  const SEAM_WEIGHT = 0.25;

  // Match quality across the parent, for showing people where a photo would
  // blend in well. Lower match values are better, as in findAnchor.
  function matchField(parent, child, settings) {
    const target = photoFeatures(child), field = anchorField(parent, settings.patch);
    return field.grids[1].map(candidate => ({
      anchorX: candidate.anchorX, anchorY: candidate.anchorY,
      match: spotMatch(candidate, target, settings)
    }));
  }

  function findAnchor(parent, child, settings, quick = false) {
    let children = matchCache.get(parent);
    if (!children) matchCache.set(parent, children = new WeakMap());
    let matches = children.get(child);
    if (!matches) children.set(child, matches = new Map());
    const key = `${settings.patch}:${settings.matchPriority || "balanced"}:${settings.placementStyle || "match"}:${quick}`;
    if (matches.has(key)) return matches.get(key);
    const inset = (1 - FRAME) / 2;
    const target = photoFeatures(child);
    const p = settings.patch;
    // Search inside the visible crop, not the unseen edges of the source.
    const margin = inset + p / 2 + 0.05;
    const centralMargin = Math.max(0.32, margin);
    const field = anchorField(parent, p);
    const score = candidate => {
      const match = spotMatch(candidate, target, settings);
      return { anchorX: candidate.anchorX, anchorY: candidate.anchorY, match,
        score: match + Math.hypot(candidate.anchorX - 0.5, candidate.anchorY - 0.5) * 0.06 };
    };
    const search = (limit, grid) => {
      let best = score(field.center);
      const consider = (x, y) => {
        const candidate = score(field.candidate(clamp(x, limit, 1 - limit), clamp(y, limit, 1 - limit)));
        if (candidate.score < best.score) best = candidate;
      };
      for (let i = 0; i < grid.length; i++) {
        if (quick && (i % 13 % 2 || Math.floor(i / 13) % 2)) continue;
        const candidate = score(grid[i]);
        if (candidate.score < best.score) best = candidate;
      }
      for (const step of quick ? [] : [0.025, 0.008]) {
        const { anchorX, anchorY } = best;
        for (let y = -1; y <= 1; y++) {
          for (let x = -1; x <= 1; x++) consider(anchorX + x * step, anchorY + y * step);
        }
      }
      return best;
    };
    const central = search(centralMargin, field.grids[0]);
    const wide = search(margin, field.grids[1]);
    const offCenter = Math.min(wide.anchorX, wide.anchorY, 1 - wide.anchorX, 1 - wide.anchorY) < centralMargin;
    const improvement = central.match - wide.match;
    // Small score differences are not evidence that a long camera pan is better.
    const useWide = wide.score < central.score &&
      (!offCenter || improvement >= Math.max(0.025, central.match * 0.2));
    const best = useWide ? wide : central;
    const result = {
      anchorX: best.anchorX,
      anchorY: best.anchorY,
      match: best.match,
      score: best.score,
      placement: {
        mode: "auto",
        reason: useWide && offCenter ? "stronger-match" : "balanced",
        matchImprovement: useWide && offCenter ? improvement : 0
      }
    };
    if (matches.size >= 12) matches.delete(matches.keys().next().value);
    matches.set(key, result);
    return result;
  }

  // The best few distinct spots for a join, best first: the automatic choice,
  // then the strongest alternatives at least SPREAD apart, judged like it.
  // The app renders each to keep the one that blends in best.
  const SPREAD = 0.12;
  function placementCandidates(parent, child, settings, count = 4) {
    const chosen = findAnchor(parent, child, settings);
    const target = photoFeatures(child), field = anchorField(parent, settings.patch);
    const scored = [...field.grids[0], ...field.grids[1]].map(candidate => {
      const match = spotMatch(candidate, target, settings);
      return { anchorX: candidate.anchorX, anchorY: candidate.anchorY, match,
        score: match + Math.hypot(candidate.anchorX - 0.5, candidate.anchorY - 0.5) * 0.06 };
    }).sort((a, b) => a.score - b.score);
    const picked = [{ anchorX: chosen.anchorX, anchorY: chosen.anchorY, match: chosen.match, score: chosen.score }];
    for (const candidate of scored) {
      if (picked.length >= count) break;
      if (picked.every(other => Math.hypot(other.anchorX - candidate.anchorX, other.anchorY - candidate.anchorY) >= SPREAD)) picked.push(candidate);
    }
    return picked;
  }

  // How visible a join is in a rendered frame, lower being better: the color
  // jump straight across the incoming photo's border (a square), how much
  // sharper one side of it is than the other, and the largest broad color
  // step between rings around it. `side` is the photo's drawn size and
  // (x0, y0) its top-left corner, in pixels of the frame.
  function joinVisibility(data, size, x0, y0, side) {
    const light = i => data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
    const segments = Array.from({ length: 24 }, () => ({ inside: [0, 0, 0, 0, 0], outside: [0, 0, 0, 0, 0] }));
    // Twelve rings from inside the photo to well outside it, in 8 sectors.
    const rings = Array.from({ length: 12 * 8 }, () => [0, 0, 0, 0]);
    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        const u = (x + 0.5 - x0) / side - 0.5, v = (y + 0.5 - y0) / side - 0.5;
        const d = Math.max(Math.abs(u), Math.abs(v));
        const i = (y * size + x) * 4;
        if (d >= 0.3 && d < 0.9) {
          const sector = Math.floor(((Math.atan2(v, u) / (Math.PI * 2) + 1.0625) % 1) * 8);
          const ring = rings[Math.floor((d - 0.3) / 0.05) * 8 + sector];
          ring[0] += data[i]; ring[1] += data[i + 1]; ring[2] += data[i + 2]; ring[3]++;
        }
        if (d < 0.44 || d > 0.56 || (d > 0.49 && d < 0.51)) continue;
        const vertical = Math.abs(u) >= Math.abs(v);
        const along = vertical ? v : u;
        const segment = (vertical ? (u > 0 ? 0 : 1) : (v > 0 ? 2 : 3)) * 6 + clamp(Math.floor((along / (2 * d) + 0.5) * 6), 0, 5);
        const band = segments[segment][d < 0.5 ? "inside" : "outside"];
        band[0] += data[i]; band[1] += data[i + 1]; band[2] += data[i + 2]; band[3]++;
        band[4] += Math.abs(4 * light(i) - light(i - 4) - light(i + 4) - light(i - size * 4) - light(i + size * 4));
      }
    }
    const valid = segments.filter(s => s.inside[3] > 8 && s.outside[3] > 8);
    if (valid.length < 6) return null;
    const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
    const squareEdge = mean(valid.map(s => Math.hypot(...[0, 1, 2].map(c => s.inside[c] / s.inside[3] - s.outside[c] / s.outside[3])) / 255));
    const detailJump = mean(valid.map(s => Math.abs(Math.log((s.inside[4] / s.inside[3] + 1) / (s.outside[4] / s.outside[3] + 1)))));
    const steps = [];
    for (let sector = 0; sector < 8; sector++) {
      const filled = [];
      for (let k = 0; k < 12; k++) if (rings[k * 8 + sector][3] > 20) filled.push(rings[k * 8 + sector]);
      if (filled.length < 4) continue;
      let step = 0;
      for (let k = 1; k < filled.length; k++) {
        step = Math.max(step, Math.hypot(...[0, 1, 2].map(c => filled[k][c] / filled[k][3] - filled[k - 1][c] / filled[k - 1][3])) / 255);
      }
      steps.push(step);
    }
    const colorStep = steps.length ? mean(steps) : 0;
    // Scaled so each part counts about equally on typical photos.
    return { squareEdge, detailJump, colorStep, score: squareEdge / 0.06 + detailJump / 0.6 + colorStep / 0.12 };
  }

  function matchPair(parent, child, settings, override, quick = false) {
    if (settings.autoAnchor && !override) return findAnchor(parent, child, settings, quick);
    const point = rect({ ...settings, ...override });
    // Judged exactly like automatic spots, so the two can be compared.
    const field = anchorField(parent, settings.patch);
    const candidate = field.candidate(point.x + point.size / 2, point.y + point.size / 2);
    const match = spotMatch(candidate, photoFeatures(child), settings);
    return { anchorX: candidate.anchorX, anchorY: candidate.anchorY, match, score: match };
  }

  function rect(settings) {
    const p = settings.patch;
    // Leave enough photographic material around even a picked edge portal.
    const border = 0.025;
    return {
      x: clamp(settings.anchorX - p / 2, border, 1 - p - border),
      y: clamp(settings.anchorY - p / 2, border, 1 - p - border),
      size: p
    };
  }

  function geometry(t, settings, targetSize, sourceSize = 1024) {
    const portal = rect(settings);
    const time = clamp(t, 0, 1);
    // Constant logarithmic speed. Zero center velocity at both ends gives the
    // same camera velocity in the next photo's coordinate system as this one.
    // Start/end on the same inset crop of every photo. The feather leaves the
    // screen before handoff, so there is never a need to expose a hard border.
    const view = FRAME * Math.pow(portal.size, time);
    // Steer with zoom progress: easing by elapsed time lets the shrinking
    // viewport overtake an off-center target before the camera reaches it.
    const zoomT = (1 - Math.pow(portal.size, time)) / (1 - portal.size);
    const centerT = smooth(0, 1, zoomT);
    const centerX = mix(0.5, portal.x + portal.size / 2, centerT);
    const centerY = mix(0.5, portal.y + portal.size / 2, centerT);
    const viewX = clamp(centerX - view / 2, 0, 1 - view);
    const viewY = clamp(centerY - view / 2, 0, 1 - view);
    return {
      patchX: portal.x * sourceSize,
      patchY: portal.y * sourceSize,
      patchSize: portal.size * sourceSize,
      patchCenterX: (portal.x + portal.size / 2) * sourceSize,
      patchCenterY: (portal.y + portal.size / 2) * sourceSize,
      viewSize: view * sourceSize,
      viewX: viewX * sourceSize,
      viewY: viewY * sourceSize,
      scale: targetSize / (view * sourceSize)
    };
  }

  // A separable low-pass separates illumination/color from photo detail.
  // Unlike multiplying RGB by the parent, this retains detail in dark photos.
  // Box blur with edge clamping: one sweep per row for all three channels,
  // then running column sums row by row, which reads memory in order.
  function lowPass(image, radius) {
    const { width: size, data } = image;
    const horizontal = new Float32Array(size * size * 3);
    const result = new Float32Array(horizontal.length);
    const count = radius * 2 + 1, last = size - 1;
    for (let y = 0; y < size; y++) {
      const row = y * size;
      let r = 0, g = 0, b = 0;
      for (let k = -radius; k <= radius; k++) {
        const i = (row + (k < 0 ? 0 : k > last ? last : k)) * 4;
        r += data[i]; g += data[i + 1]; b += data[i + 2];
      }
      for (let x = 0; x < size; x++) {
        const o = (row + x) * 3;
        horizontal[o] = r / count; horizontal[o + 1] = g / count; horizontal[o + 2] = b / count;
        const add = x + radius + 1, remove = x - radius;
        const a = (row + (add > last ? last : add)) * 4, d = (row + (remove < 0 ? 0 : remove)) * 4;
        r += data[a] - data[d]; g += data[a + 1] - data[d + 1]; b += data[a + 2] - data[d + 2];
      }
    }
    const stride = size * 3, sums = new Float64Array(stride);
    for (let k = -radius; k <= radius; k++) {
      const source = (k < 0 ? 0 : k > last ? last : k) * stride;
      for (let i = 0; i < stride; i++) sums[i] += horizontal[source + i];
    }
    for (let y = 0; y < size; y++) {
      const target = y * stride, add = y + radius + 1, remove = y - radius;
      const addRow = (add > last ? last : add) * stride, removeRow = (remove < 0 ? 0 : remove) * stride;
      for (let i = 0; i < stride; i++) {
        result[target + i] = sums[i] / count;
        sums[i] += horizontal[addRow + i] - horizontal[removeRow + i];
      }
    }
    return result;
  }

  // iOS Safari reclaims canvas memory late and fails once its total is
  // exceeded, so a discarded join frees its own canvases straight away.
  function releaseCanvases(...items) {
    for (const item of items) if (item) item.width = item.height = 0;
  }

  function createTransition(parent, child, requested, override) {
    const settings = { ...requested };
    let placement = { mode: override ? (override.tested ? "tested" : "picked") : "manual" };
    if (override) Object.assign(settings, { anchorX: override.anchorX, anchorY: override.anchorY, autoAnchor: false });
    else if (settings.autoAnchor) {
      const anchor = findAnchor(parent, child, settings);
      settings.anchorX = anchor.anchorX;
      settings.anchorY = anchor.anchorY;
      placement = anchor.placement;
    }
    const portal = rect(settings);
    settings.anchorX = portal.x + portal.size / 2;
    settings.anchorY = portal.y + portal.size / 2;
    const patch = canvas(TEXTURE_SIZE);
    const patchCtx = patch.getContext("2d", { willReadFrequently: true });
    // Sample the actual surrounding material across the entire feather, too.
    const parentScale = TEXTURE_SIZE / (portal.size * SPAN);
    drawExtended(patchCtx, parent, -(portal.x - portal.size * HALO) * parentScale,
      -(portal.y - portal.size * HALO) * parentScale, parentScale);
    // At small start sizes this area is a few dozen pixels of the working
    // copy; the sharp crops let the camouflage and surround match the
    // sharpened scene around them.
    drawSharpCrops(patchCtx, parent, -(portal.x - portal.size * HALO) * parentScale,
      -(portal.y - portal.size * HALO) * parentScale, parentScale, 0, 0, TEXTURE_SIZE);
    const parentData = patchCtx.getImageData(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
    const childSource = canvas(TEXTURE_SIZE);
    const childCtx = childSource.getContext("2d", { willReadFrequently: true });
    drawExtended(childCtx, child, TEXTURE_SIZE * HALO / SPAN, TEXTURE_SIZE * HALO / SPAN, TEXTURE_SIZE / SPAN);
    // Photo Blend's edge style; Stitched World draws its own seam.
    const edgeStyle = settings.mode === "stitched" ? "mirror" : settings.edgeStyle || "band";
    const childImage = childCtx.getImageData(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
    const childData = edgeStyle === "mirror" ? childImage : morphBorder(childImage, edgeStyle === "band" ? MIRROR_BAND : 0);
    if (settings.mode === "stitched") {
      // Stitched World keeps every photo's own colors throughout.
      const stitched = { ...createStitchedTransition(parentData, childData, extension(child), settings, portal), placement };
      // The extension is cached per photo and shared, so it is not released.
      return { ...stitched, release: () => releaseCanvases(stitched.stitch, stitched.cutout) };
    }
    const radius = Math.round(18 + settings.sampleBlend * 38);
    const parentLow = lowPass(parentData, radius);
    const childLow = lowPass(childData, radius);
    const parentMid = lowPass(parentData, 14);
    const childMid = lowPass(childData, 14);
    const lighting = createLighting(parentLow, childLow, settings);
    const order = createRevealOrder(parentMid, childMid, settings);
    const soft = createSoftPhoto(childData, settings.patch);
    photoDetail(child, settings.patch);
    const texture = canvas(TEXTURE_SIZE);
    const ctx = texture.getContext("2d");
    const embedded = ctx.createImageData(TEXTURE_SIZE, TEXTURE_SIZE);
    const cutout = canvas(TEXTURE_SIZE);
    const cutoutCtx = cutout.getContext("2d");
    const mask = cutoutCtx.createImageData(TEXTURE_SIZE, TEXTURE_SIZE);
    const bind = clamp(settings.bind + (settings.cinematicMode ? 0.05 : 0), 0, 1);
    const feather = HALO * Math.max(settings.smoothGuard ? 0.6 : 0.2, 0.3 + settings.edgeBlend * 0.7);
    const fold = Math.max(1, Math.round(settings.symmetry));
    const sector = Math.PI * 2 / fold;
    const alignment = settings.alignment * Math.PI * 2;
    const grain = settings.grain * (settings.smoothGuard ? 0.35 : 1);

    for (let y = 0; y < TEXTURE_SIZE; y++) {
      for (let x = 0; x < TEXTURE_SIZE; x++) {
        const pixel = y * TEXTURE_SIZE + x;
        const i = pixel * 4;
        let childPixel = pixel;
        const mu = (x + 0.5) / TEXTURE_SIZE * SPAN - HALO, mv = (y + 0.5) / TEXTURE_SIZE * SPAN - HALO;
        const beyond = Math.max(0, -mu, mu - 1, -mv, mv - 1);
        let carry = 1, light = 1;
        if (beyond > 0 && edgeStyle !== "mirror") {
          // Reach: far where the photo's edge matches the scene in light and
          // color, short where it clashes, along an irregular outline.
          const ex = clamp(Math.floor((clamp(mu, 0, 1) + HALO) / SPAN * TEXTURE_SIZE), 0, TEXTURE_SIZE - 1);
          const ey = clamp(Math.floor((clamp(mv, 0, 1) + HALO) / SPAN * TEXTURE_SIZE), 0, TEXTURE_SIZE - 1);
          const e = (ey * TEXTURE_SIZE + ex) * 3;
          const lightGap = Math.abs((parentLow[e] - childLow[e]) * 0.2126 + (parentLow[e + 1] - childLow[e + 1]) * 0.7152 + (parentLow[e + 2] - childLow[e + 2]) * 0.0722);
          const colorGap = Math.hypot(parentLow[e] - childLow[e], parentLow[e + 1] - childLow[e + 1], parentLow[e + 2] - childLow[e + 2]);
          const clash = smooth(8, 60, lightGap * 0.6 + colorGap * 0.4);
          const reach = mix(MORPH_REACH[1], MORPH_REACH[0], clash) * (1 + 0.35 * fractalNoise(mu * 4, mv * 4, 3));
          carry = 1 - smooth(reach * 0.35, reach, beyond);
          // Carried variations take on the scene's light.
          const at = pixel * 3;
          const sceneLight = parentLow[at] * 0.2126 + parentLow[at + 1] * 0.7152 + parentLow[at + 2] * 0.0722;
          const photoLight = childLow[at] * 0.2126 + childLow[at + 1] * 0.7152 + childLow[at + 2] * 0.0722;
          light = clamp((sceneLight + 8) / (photoLight + 8), 0.6, 1.5);
        }
        if (fold > 1) {
          const dx = x - TEXTURE_SIZE / 2;
          const dy = y - TEXTURE_SIZE / 2;
          const r = Math.hypot(dx, dy);
          let angle = ((Math.atan2(dy, dx) - alignment) % sector + sector) % sector;
          angle = Math.min(angle, sector - angle) - sector / 4 + alignment;
          const sx = clamp(Math.round(TEXTURE_SIZE / 2 + Math.cos(angle) * r), 0, TEXTURE_SIZE - 1);
          const sy = clamp(Math.round(TEXTURE_SIZE / 2 + Math.sin(angle) * r), 0, TEXTURE_SIZE - 1);
          childPixel = sy * TEXTURE_SIZE + sx;
        }
        for (let c = 0; c < 3; c++) {
          const detail = (childData.data[childPixel * 4 + c] - childLow[childPixel * 3 + c]) * carry * light;
          const parentDetail = parentData.data[i + c] - parentLow[pixel * 3 + c];
          // A faint, steady trace of the photo's own detail from the moment it
          // appears, so it feels as if it had been there all along without
          // being fully there; where the parent was smooth it vanished, then
          // seemed to arrive all at once when it began to form.
          const detailGain = clamp((Math.abs(parentDetail) + 1) / (Math.abs(detail) + 12), 0.01, 0.28);
          // The trace is kept to a few levels, so even a stark photo inside
          // a plain one stays a whisper rather than a visible pattern.
          const trace = clamp(detail * Math.max(0, PRESENCE - detailGain), -PRESENCE_LEVELS, PRESENCE_LEVELS);
          const camouflaged = parentData.data[i + c] + detail * detailGain + trace;
          const noise = (((x * 13 + y * 17) % 11) / 10 - 0.5) * grain * 12;
          embedded.data[i + c] = mix(childData.data[childPixel * 4 + c], camouflaged, bind) + noise;
        }
        embedded.data[i + 3] = 255;
        const u = (x + 0.5) / TEXTURE_SIZE * SPAN - HALO;
        const v = (y + 0.5) / TEXTURE_SIZE * SPAN - HALO;
        const dx = Math.max(0, -u, u - 1);
        const dy = Math.max(0, -v, v - 1);
        const edge = Math.hypot(dx, dy);
        // Texture-guided, irregular feather: no outline or second stretched image.
        const textureAmount = Math.abs(parentData.data[i + 1] - parentLow[pixel * 3 + 1]) / 255;
        const variation = 1 + settings.shapeMorph * 0.22 * Math.sin(u * 19 + Math.sin(v * 13)) * Math.sin(v * 17);
        const width = feather * variation * (1 - Math.min(0.3, textureAmount));
        mask.data[i + 3] = 255 * smooth(0, Math.min(HALO, width), edge);
      }
    }
    ctx.putImageData(embedded, 0, 0);
    cutoutCtx.putImageData(mask, 0, 0);
    const surround = createSurround(parentData, childData, settings,
      { radius, parent: parentLow, child: childLow, parentMid, childMid });
    return { settings, rect: portal, texture, cutout, extension: surround, placement, lighting, order, soft,
      release: () => releaseCanvases(texture, cutout, surround, soft, lighting?.darken, lighting?.brighten, lighting?.lift,
        lighting?.rim?.darken, lighting?.rim?.brighten, lighting?.rim?.lift) };
  }

  function createLighting(parentLow, childLow, settings) {
    // Local lighting match for the incoming photo: a gain per region that
    // gives it the light and color of the area it replaces while keeping
    // its own sharp detail. The renderer relaxes it to the photo's true
    // lighting before the handoff. Darkening uses multiply and brightening
    // color-dodge, which scale pixels and so keep the photo's contrast. A
    // scale cannot lift black, so whatever brightening remains past the
    // largest gain comes from screen, which raises shadows.
    // A second set covers only the photo's outer part, which keeps the
    // surrounding light longer than the middle (see render): the photo's own
    // colors then fade in from the middle instead of ending in a square.
    const size = 80, reach = mix(0.32, 0.5, settings.edgeBlend);
    const build = rimOnly => {
      const maps = [canvas(size), canvas(size), canvas(size)];
      const contexts = maps.map(map => map.getContext("2d"));
      const [down, up, lift] = contexts.map(ctx => ctx.createImageData(size, size));
      let largest = 0;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const u = (x + 0.5) / size * SPAN - HALO, v = (y + 0.5) / size * SPAN - HALO;
          // Full strength on the photo, fading out with the halo's handoff.
          const weight = (1 - smooth(0, reach, Math.hypot(Math.max(0, -u, u - 1), Math.max(0, -v, v - 1)))) *
            (rimOnly ? smooth(0.22, 0.5, Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5))) : 1);
          const k = (Math.min(TEXTURE_SIZE - 1, Math.floor((y + 0.5) / size * TEXTURE_SIZE)) * TEXTURE_SIZE +
            Math.min(TEXTURE_SIZE - 1, Math.floor((x + 0.5) / size * TEXTURE_SIZE))) * 3;
          const i = (y * size + x) * 4;
          for (let c = 0; c < 3; c++) {
            const target = parentLow[k + c] / 255, source = childLow[k + c] / 255;
            const ratio = clamp((target + 0.03) / (source + 0.03), 0.4, 4);
            const gain = Math.min(ratio, 2);
            const scaled = Math.min(1, source * Math.max(1, gain));
            const raise = ratio > 1 ? clamp((target - scaled) / Math.max(0.02, 1 - scaled), 0, 1) : 0;
            const weighted = 1 + (gain - 1) * weight;
            largest = Math.max(largest, Math.abs(weighted - 1), raise * weight);
            down.data[i + c] = 255 * Math.min(1, weighted);
            // color-dodge divides by (1 - source), so this gives x * gain.
            up.data[i + c] = 255 * Math.max(0, 1 - 1 / weighted);
            lift.data[i + c] = 255 * raise * weight;
          }
          down.data[i + 3] = up.data[i + 3] = lift.data[i + 3] = 255;
        }
      }
      if (largest < 0.02) return null;
      [down, up, lift].forEach((image, index) => contexts[index].putImageData(image, 0, 0));
      return { darken: maps[0], brighten: maps[1], lift: maps[2] };
    };
    const whole = build(false);
    return whole && { ...whole, rim: build(true), strength: 0.9 * settings.bind };
  }

  function drawLighting(local, maps, alpha, x, y, span) {
    if (!maps || alpha < 0.004) return;
    local.globalAlpha = alpha;
    local.globalCompositeOperation = "multiply";
    local.drawImage(maps.darken, x, y, span, span);
    local.globalCompositeOperation = "color-dodge";
    local.drawImage(maps.brighten, x, y, span, span);
    local.globalCompositeOperation = "screen";
    local.drawImage(maps.lift, x, y, span, span);
    local.globalCompositeOperation = "source-over";
    local.globalAlpha = 1;
  }

  // Where a photo meets its parent, the parent is magnified so far that one
  // of its pixels covers 1/patch pixels of the photo (0.3125/patch texture
  // pixels). Detail finer than that drew a crisp square inside a soft scene,
  // so it fades out toward the border. Returns the share of each child
  // detail band (finer than 3, 3 to 14, and 14 to broadRadius texture
  // pixels) that remains at the border; the handoff never shows this band.
  function borderDetail(patch, broadRadius) {
    const blur = 0.6 * 0.3125 / patch;
    return [1 - clamp(blur / 3, 0, 1), 1 - clamp((blur - 3) / 11, 0, 1), 1 - clamp((blur - 14) / Math.max(1, broadRadius - 14), 0, 1)];
  }

  // 0 inside the part of a photo that becomes the full frame (and that the
  // plain photo is swapped in for, 9% in from its border), rising to 1 at its
  // border and beyond.
  const borderBand = d => smooth(0.41, 0.5, d);

  function blurMap(values, size, radius) {
    const out = new Float32Array(values.length), temp = new Float32Array(values.length);
    for (const [from, to, horizontal] of [[values, temp, true], [temp, out, false]]) {
      for (let line = 0; line < size; line++) {
        let sum = 0;
        const at = i => from[horizontal ? line * size + clamp(i, 0, size - 1) : clamp(i, 0, size - 1) * size + line];
        for (let k = -radius; k <= radius; k++) sum += at(k);
        for (let i = 0; i < size; i++) {
          to[horizontal ? line * size + i : i * size + line] = sum / (radius * 2 + 1);
          sum += at(i + radius + 1) - at(i - radius);
        }
      }
    }
    return out;
  }

  // When each part of an incoming photo stops being camouflaged, from 0
  // (first) to 1 (last). Parts that already match the surrounding color and
  // light come first, so the photo forms out of its environment as blobs
  // that grow together. Organic edge sets how much the order follows the
  // match rather than spreading evenly outward from the middle. The border
  // is handled separately by a soft rim (see drawCamouflage).
  function createRevealOrder(parentMid, childMid, settings) {
    const size = REVEAL_MAP;
    const mismatch = new Float32Array(size * size);
    const distance = new Float32Array(size * size);
    const inside = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const u = (x + 0.5) / size * SPAN - HALO, v = (y + 0.5) / size * SPAN - HALO;
        distance[i] = Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5));
        const k = (Math.floor((y + 0.5) / size * TEXTURE_SIZE) * TEXTURE_SIZE + Math.floor((x + 0.5) / size * TEXTURE_SIZE)) * 3;
        // Light (brightness) and color (the rest) mismatch, both counted, so
        // parts that already fit the scene's light and color come first.
        const light = c => c[k] * 0.2126 + c[k + 1] * 0.7152 + c[k + 2] * 0.0722;
        const childLight = light(childMid), parentLight = light(parentMid);
        const color = Math.hypot(childMid[k] - childLight - parentMid[k] + parentLight,
          childMid[k + 2] - childLight - parentMid[k + 2] + parentLight);
        mismatch[i] = (Math.abs(childLight - parentLight) * 0.55 + color * 0.45) / 255;
        if (distance[i] < 0.5) inside.push(i);
      }
    }
    // Regions about a twentieth of the photo across, with edges shaped by
    // finer matching detail so the growing front follows the pictures.
    const broadRegions = blurMap(mismatch, size, 3), fineRegions = blurMap(mismatch, size, 1);
    // Pixel reveal swaps the regions for single cells, still ordered by how
    // well each matches, with a little per-cell scatter for a pixel dissolve.
    const pixel = settings.pixelReveal || 0;
    const scatter = i => (((Math.imul(i + 1, 2654435761) >>> 0) % 1000) / 1000 - 0.5) * 0.06;
    const regions = broadRegions.map((value, i) =>
      mix(value * 0.6 + fineRegions[i] * 0.4, mismatch[i] + scatter(i) * pixel, smooth(0, 0.6, pixel)));
    inside.sort((a, b) => regions[a] - regions[b]);
    const rank = new Float32Array(size * size);
    inside.forEach((i, n) => { rank[i] = n / Math.max(1, inside.length - 1); });
    const order = new Float32Array(size * size).fill(1);
    // Mostly the match; Organic edge 0 still keeps half of it.
    const matchWeight = 0.5 + 0.5 * settings.shapeMorph;
    for (const i of inside) order[i] = mix(distance[i] / 0.5, rank[i], matchWeight);
    // The border camouflage begins nearer the middle where the photo matches
    // its surroundings least, so its inner edge follows the pictures rather
    // than a square.
    const rimStart = blurMap(rank.map((value, i) => 0.22 - (value - 0.5) * 0.18 * settings.shapeMorph), size, 4);
    // Above half, the specks grow into square blocks (up to 8 across the
    // photo at full strength), each forming at its cells' average order.
    if (pixel > 0.5) {
      const block = Math.round(1 + (pixel - 0.5) * 14);
      for (let by = 0; by < size; by += block) {
        for (let bx = 0; bx < size; bx += block) {
          let sum = 0, count = 0;
          for (let y = by; y < Math.min(size, by + block); y++) for (let x = bx; x < Math.min(size, bx + block); x++) {
            if (distance[y * size + x] < 0.5) { sum += order[y * size + x]; count++; }
          }
          if (!count) continue;
          for (let y = by; y < Math.min(size, by + block); y++) for (let x = bx; x < Math.min(size, bx + block); x++) {
            if (distance[y * size + x] < 0.5) order[y * size + x] = sum / count;
          }
        }
      }
    }
    return { order: pixel > 0.5 ? order : blurMap(order, size, 1), distance, rimStart, pixel };
  }

  // The photo as soft as the magnified parent around it. One parent pixel
  // covers 1/patch photo pixels at every zoom, so a fixed blur matches the
  // parent's softness throughout. Drawn over the sharp photo while it forms
  // and faded out as it grows: a focus pull, so its first specks are not
  // crisp dots inside a blurred scene. Same picture, so no double exposure.
  function createSoftPhoto(child, patch) {
    const radius = Math.round(0.6 * 0.3125 / patch);
    if (radius < 2) return null;
    const blurred = lowPass(child, radius);
    const result = canvas(TEXTURE_SIZE);
    const ctx = result.getContext("2d");
    const image = ctx.createImageData(TEXTURE_SIZE, TEXTURE_SIZE);
    for (let y = 0; y < TEXTURE_SIZE; y++) {
      for (let x = 0; x < TEXTURE_SIZE; x++) {
        const u = (x + 0.5) / TEXTURE_SIZE * SPAN - HALO, v = (y + 0.5) / TEXTURE_SIZE * SPAN - HALO;
        const i = (y * TEXTURE_SIZE + x) * 4, k = (y * TEXTURE_SIZE + x) * 3;
        image.data[i] = blurred[k]; image.data[i + 1] = blurred[k + 1]; image.data[i + 2] = blurred[k + 2];
        image.data[i + 3] = 255 * (1 - smooth(0.45, 0.5, Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5))));
      }
    }
    ctx.putImageData(image, 0, 0);
    return result;
  }

  // Width of the soft edge between formed and camouflaged parts: crisper as
  // pixel reveal rises, softer in cinematic mode.
  function revealSoftness(settings) {
    return mix(settings.cinematicMode ? 0.14 : 0.07, 0.012, settings.pixelReveal || 0);
  }

  // Photo Blend timing for a photo covering `coverage` of the screen. At
  // first the photo is only its color and light inside the parent's texture.
  // Its own form then grows out of the areas that already match, the border
  // stays softly camouflaged until late, and the photo is lit like its
  // surroundings until it returns to its true light before filling the
  // screen, so the handoff to the next segment stays pixel-identical.
  function revealTiming(settings, cinematic, zoomed, coverage, lighting) {
    // The photo begins forming while it is still tiny: at small start sizes
    // from half its start size, nested inside the photo before, so its
    // best-matching specks show within its first few pixels on screen and
    // grow from there. Waiting for a fixed share of the screen hid it for
    // nearly half the zoom. From 8% up it starts at 1.25x its start size,
    // since forming earlier there made the border's ghost frame stronger.
    // It finishes forming over an 8x wider view.
    const revealStart = cinematic ? CINEMATIC_REVEAL_START : REVEAL_START;
    const earliest = mix(cinematic ? 0.8 : 0.5, cinematic ? 1.75 : 1.25, smooth(0.02, 0.08, settings.patch));
    const formStart = Math.min(revealStart, settings.patch / FRAME * earliest);
    const formEnd = Math.min(cinematic ? CINEMATIC_FORM_END : FORM_END, formStart * (cinematic ? 10 : 8));
    // Constant growth through the zoom, so each frame reveals about the same
    // few pixels; an eased curve grew 1.5x faster in the middle. The border
    // camouflage and lighting match follow the photo's actual size on
    // screen, since that is when its border shows.
    const strength = lighting ? lighting.strength : 0;
    // Stays as soft as the scene until it has formed, then sharpens while it
    // grows to cover half the screen. Small start sizes only: from 8% up the
    // scene is barely softened.
    const focusEnd = 0.5;
    return {
      soft: (1 - smooth(0.02, 0.08, settings.patch)) * (1 - (settings.pixelReveal || 0)) *
        (1 - clamp((zoomed - Math.log(formEnd)) / Math.max(1e-6, Math.log(focusEnd) - Math.log(formEnd)), 0, 1)),
      form: clamp((zoomed - Math.log(formStart)) / (Math.log(formEnd) - Math.log(formStart)), 0, 1),
      rim: smooth(revealStart, RIM_END, coverage),
      lit: strength * (1 - smooth(Math.log(revealStart * 2), Math.log(LIGHT_END), zoomed)),
      litRim: strength * (1 - smooth(Math.log(RIM_LIGHT_START), Math.log(RIM_LIGHT_END), zoomed))
    };
  }

  let revealMask, revealMaskImage, revealScratch;
  // Draws the camouflage where the photo has not formed yet. Inside, the
  // edge between the two is a soft moving threshold, so each part shows one
  // photo or the other rather than both at half strength. Toward the border
  // the camouflage fades gradually in space and late in time; a threshold
  // there drew a crisp square while the photo was still small.
  function drawCamouflage(local, incoming, form, rim, softness, x, y, span) {
    if (form >= 1 && rim >= 1) return;
    if (!incoming.order || (form <= 0 && rim <= 0)) {
      local.globalAlpha = 1 - Math.max(0, Math.min(form, rim));
      local.drawImage(incoming.texture, x, y, span, span);
      local.globalAlpha = 1;
      return;
    }
    if (!revealMask) {
      revealMask = canvas(REVEAL_MAP);
      revealMaskImage = revealMask.getContext("2d").createImageData(REVEAL_MAP, REVEAL_MAP);
      revealScratch = canvas(TEXTURE_SIZE);
    }
    const low = form * (1 + 2 * softness) - 2 * softness, data = revealMaskImage.data;
    const { order, distance, rimStart, pixel } = incoming.order;
    for (let i = 0; i < order.length; i++) {
      const inner = smooth(low, low + 2 * softness, order[i]);
      const border = smooth(rimStart[i], 0.5, distance[i]) * (1 - rim);
      data[i * 4 + 3] = 255 * Math.max(inner, border);
    }
    revealMask.getContext("2d").putImageData(revealMaskImage, 0, 0);
    const scratch = revealScratch.getContext("2d");
    scratch.globalCompositeOperation = "copy";
    scratch.drawImage(incoming.texture, 0, 0);
    scratch.globalCompositeOperation = "destination-in";
    // Square pixel edges for a bold pixel dissolve.
    scratch.imageSmoothingEnabled = pixel < 0.5;
    scratch.drawImage(revealMask, 0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
    scratch.globalCompositeOperation = "source-over";
    local.drawImage(revealScratch, x, y, span, span);
  }

  function createSurround(parent, child, settings, broad) {
    // Backing for a growing photo: the photo itself inside its edge, then a
    // multiband handoff to the parent's own material. Fine texture switches
    // to the parent almost at the edge, while lighting and color grade over
    // the whole feather, so the join shows neither a blur ring nor mirrored
    // copies of the incoming photo. The two broader bands reuse blurs the
    // color match and reveal order already computed.
    const parentBands = [lowPass(parent, 3), broad.parentMid, broad.parent];
    const childBands = [lowPass(child, 3), broad.childMid, broad.child];
    const [r0, r1, r2, r3] = [0.03, 0.08, 0.18, mix(0.32, 0.5, settings.edgeBlend)];
    const result = canvas(TEXTURE_SIZE);
    const ctx = result.getContext("2d");
    const out = ctx.createImageData(TEXTURE_SIZE, TEXTURE_SIZE);
    const [p0, p1, p2] = parentBands, [c0, c1, c2] = childBands;
    const [a0, a1, a2] = borderDetail(settings.patch, broad.radius);
    for (let y = 0; y < TEXTURE_SIZE; y++) {
      const v = (y + 0.5) / TEXTURE_SIZE * SPAN - HALO;
      const dy = Math.max(0, -v, v - 1);
      for (let x = 0; x < TEXTURE_SIZE; x++) {
        const pixel = y * TEXTURE_SIZE + x;
        const u = (x + 0.5) / TEXTURE_SIZE * SPAN - HALO;
        const dx = Math.max(0, -u, u - 1);
        const i = pixel * 4;
        out.data[i + 3] = 255;
        const soften = borderBand(Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)));
        if (!soften) {
          out.data[i] = child.data[i]; out.data[i + 1] = child.data[i + 1]; out.data[i + 2] = child.data[i + 2];
          continue;
        }
        const k0 = 1 - soften * (1 - a0), k1 = 1 - soften * (1 - a1), k2 = 1 - soften * (1 - a2);
        const outside = Math.hypot(dx, dy);
        const w0 = smooth(0, r0, outside), w1 = smooth(0, r1, outside), w2 = smooth(0, r2, outside), w3 = smooth(0, r3, outside);
        for (let c = 0; c < 3; c++) {
          const k = pixel * 3 + c;
          out.data[i + c] =
            mix((child.data[i + c] - c0[k]) * k0, parent.data[i + c] - p0[k], w0) +
            mix((c0[k] - c1[k]) * k1, p0[k] - p1[k], w1) +
            mix((c1[k] - c2[k]) * k2, p1[k] - p2[k], w2) +
            mix(c2[k], p2[k], w3);
        }
      }
    }
    ctx.putImageData(out, 0, 0);
    return result;
  }

  function createStitchedTransition(parent, child, childExtension, settings, portal) {
    // Prepare a multiband join once. Fine detail changes over a narrow seam;
    // broad color and lighting change across a much wider surrounding region.
    // All masks live in photo coordinates and never depend on the playhead.
    const parentBands = [3, 14, 48].map(radius => lowPass(parent, radius));
    const childBands = [3, 14, 48].map(radius => lowPass(child, radius));
    const contour = settings.shapeMorph > 0 ? findStitchContour(parent, child, parentBands[0], childBands[0]) : null;
    const [a0, a1, a2] = borderDetail(settings.patch, 48);
    const stitch = canvas(TEXTURE_SIZE);
    const ctx = stitch.getContext("2d");
    const result = ctx.createImageData(TEXTURE_SIZE, TEXTURE_SIZE);
    const cutout = canvas(TEXTURE_SIZE);
    const maskCtx = cutout.getContext("2d");
    const mask = maskCtx.createImageData(TEXTURE_SIZE, TEXTURE_SIZE);
    const feather = mix(0.25, HALO, settings.edgeBlend);
    for (let y = 0; y < TEXTURE_SIZE; y++) {
      for (let x = 0; x < TEXTURE_SIZE; x++) {
        const pixel = y * TEXTURE_SIZE + x;
        const u = (x + 0.5) / TEXTURE_SIZE * SPAN - HALO;
        const v = (y + 0.5) / TEXTURE_SIZE * SPAN - HALO;
        const d = Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5));
        const offset = contour ? (0.52 - contourRadius(contour.radii, u, v)) * settings.shapeMorph : 0;
        const distance = d + offset * smooth(0.405, 0.5, d);
        // Past the photo edge the child is only a reflection of itself. Hand
        // fine and medium detail to the parent's real material within a few
        // percent, or the reflection reads as a mirrored copy around the join.
        const outside = Math.max(0, d - 0.5);
        const fine = (1 - smooth(mix(0.48, 0.415, settings.edgeBlend), mix(0.55, 0.71, settings.edgeBlend), distance)) *
          (1 - smooth(0, 0.04, outside));
        const medium = (1 - smooth(0.4, mix(0.62, 0.85, settings.sampleBlend * 0.6 + settings.edgeBlend * 0.4), distance)) *
          (1 - smooth(0, 0.09, outside));
        const broad = (1 - smooth(0.32, mix(0.76, 1, settings.edgeBlend), d + offset * 0.35)) *
          (1 - smooth(0, 0.2, outside));
        const lighting = 1 - smooth(mix(0.45, 0.22, settings.bind), 1, d + offset * 0.15);
        const soften = borderBand(d);
        const k0 = 1 - soften * (1 - a0), k1 = 1 - soften * (1 - a1), k2 = 1 - soften * (1 - a2);
        for (let c = 0; c < 3; c++) {
          const k = pixel * 3 + c;
          const a = pixel * 4 + c;
          result.data[a] =
            mix(parent.data[a] - parentBands[0][k], (child.data[a] - childBands[0][k]) * k0, fine) +
            mix(parentBands[0][k] - parentBands[1][k], (childBands[0][k] - childBands[1][k]) * k1, medium) +
            mix(parentBands[1][k] - parentBands[2][k], (childBands[1][k] - childBands[2][k]) * k2, broad) +
            mix(parentBands[2][k], childBands[2][k], lighting);
        }
        // The central 80% remains the full-resolution original, including its
        // own nested join. That makes rebasing into it pixel-continuous.
        result.data[pixel * 4 + 3] = 255 * smooth(0.405, 0.49, d);
        const outer = Math.hypot(Math.max(0, -u, u - 1), Math.max(0, -v, v - 1));
        mask.data[pixel * 4 + 3] = 255 * smooth(0, feather, outer);
      }
    }
    ctx.putImageData(result, 0, 0);
    maskCtx.putImageData(mask, 0, 0);
    return { settings, rect: portal, stitch, cutout, extension: childExtension,
      seam: contour ? { matchImprovement: contour.improvement, radii: contour.radii } : null };
  }

  function contourRadius(radii, u, v) {
    const angle = ((Math.atan2(v - 0.5, u - 0.5) / (Math.PI * 2) + 1) % 1) * radii.length;
    const i = Math.floor(angle);
    return mix(radii[i], radii[(i + 1) % radii.length], angle - i);
  }

  function findStitchContour(parent, child, parentFine, childFine) {
    // Follow places where existing detail matches, rather than imposing a
    // repeating geometric border. Keep the central handoff crop untouched.
    const angles = 192, choices = 25, low = 0.435, high = 0.545;
    const costs = new Float32Array(angles * choices);
    const radiusAt = index => mix(low, high, index / (choices - 1));
    for (let a = 0; a < angles; a++) {
      const angle = a / angles * Math.PI * 2;
      const dx = Math.cos(angle), dy = Math.sin(angle);
      const scale = Math.max(Math.abs(dx), Math.abs(dy));
      for (let r = 0; r < choices; r++) {
        const radius = radiusAt(r);
        const u = 0.5 + dx / scale * radius, v = 0.5 + dy / scale * radius;
        const x = clamp(Math.round((u + HALO) / SPAN * TEXTURE_SIZE), 0, TEXTURE_SIZE - 1);
        const y = clamp(Math.round((v + HALO) / SPAN * TEXTURE_SIZE), 0, TEXTURE_SIZE - 1);
        const pixel = y * TEXTURE_SIZE + x;
        let detail = 0, color = 0;
        for (let c = 0; c < 3; c++) {
          const k = pixel * 3 + c, i = pixel * 4 + c;
          detail += Math.abs((parent.data[i] - parentFine[k]) - (child.data[i] - childFine[k]));
          color += Math.abs(parent.data[i] - child.data[i]);
        }
        costs[a * choices + r] = (detail * 0.85 + color * 0.15) / (3 * 255) + Math.abs(radius - 0.52) * 0.12;
      }
    }
    const reference = Math.round((0.52 - low) / (high - low) * (choices - 1));
    let bestCost = Infinity, bestPath;
    // Closed-contour candidates avoid a discontinuity at the angular wrap.
    for (const start of [Math.max(0, reference - 8), reference, Math.min(choices - 1, reference + 8)]) {
      let previous = new Float32Array(choices).fill(Infinity);
      previous[start] = costs[start];
      const back = new Int16Array(angles * choices);
      for (let a = 1; a < angles; a++) {
        const next = new Float32Array(choices).fill(Infinity);
        for (let r = 0; r < choices; r++) {
          for (let before = Math.max(0, r - 1); before <= Math.min(choices - 1, r + 1); before++) {
            const cost = previous[before] + costs[a * choices + r] + Math.abs(r - before) * 0.008;
            if (cost < next[r]) { next[r] = cost; back[a * choices + r] = before; }
          }
        }
        previous = next;
      }
      if (previous[start] < bestCost) {
        bestCost = previous[start];
        bestPath = new Int16Array(angles);
        bestPath[angles - 1] = start;
        for (let a = angles - 1; a > 0; a--) bestPath[a - 1] = back[a * choices + bestPath[a]];
      }
    }
    // Use the centered contour if optimization costs more, including the
    // continuity penalty.
    let referenceCost = 0;
    for (let a = 0; a < angles; a++) referenceCost += costs[a * choices + reference];
    const radii = Float32Array.from(bestPath, radiusAt);
    if (bestCost >= referenceCost) radii.fill(0.52);
    return { radii, improvement: Math.max(0, referenceCost - bestCost) / angles };
  }

  function layerAt(depth, projectedSize, outputSize) {
    const size = Math.max(1, Math.ceil(projectedSize));
    // iPhone and iPad refuse canvases over 4096 × 4096 pixels. The part of a
    // layer the camera can show stays within 1.75× the output (3780 px at
    // 2160), so the cap clips only material that is off screen.
    const capacity = Math.min(Math.ceil(outputSize), MAX_LAYER, Math.max(32, 2 ** Math.ceil(Math.log2(size))));
    if (!layers[depth]) layers[depth] = canvas(capacity);
    const layer = layers[depth];
    if (layer.width < capacity || layer.width > outputSize) layer.width = layer.height = capacity;
    return { layer, size };
  }

  function render(ctx, images, segment, t, settings, getTransition) {
    const outputSize = ctx.canvas.width;
    const pairAt = (index) => getTransition(images[index % images.length], images[(index + 1) % images.length], settings);
    const first = pairAt(segment);
    const camera = geometry(t, first.settings, outputSize, images[segment].canvas.width);

    function nested(index, incoming, projectedSize, depth, originX, originY, parentX = 0, parentY = 0) {
      // Paint each tile in the final screen's pixel grid. Copying it at an
      // integer origin and 1:1 scale avoids a second filtering pass, so detail
      // stays stable as the camera moves, buffers grow, and photos hand off.
      const x = Math.floor(originX), y = Math.floor(originY);
      const globalX = parentX + x, globalY = parentY + y;
      const shiftX = originX - x, shiftY = originY - y;
      const span = projectedSize * SPAN;
      const { layer, size } = layerAt(depth, span + Math.max(shiftX, shiftY), outputSize * SPAN / FRAME + 2);
      const local = layer.getContext("2d");
      const core = projectedSize;
      const insetX = core * HALO + shiftX, insetY = core * HALO + shiftY;
      const coverage = projectedSize / outputSize;
      const stitched = settings.mode === "stitched";
      // Photo Blend: at first the photo is only its color and light inside the
      // parent's texture. Its own form then grows out of the areas that
      // already match, and the square border forms last. Meanwhile it is lit
      // like its surroundings, returning to its true light before it fills
      // the screen, so the handoff to the next segment stays pixel-identical.
      // Timing follows the zoom (log of coverage), so pacing is even.
      const cinematic = incoming.settings.cinematicMode;
      const zoomed = Math.log(Math.max(coverage, 1e-6));
      const { soft, form, rim, lit, litRim } = stitched ? { soft: 0, form: 1, rim: 1, lit: 0, litRim: 0 } :
        revealTiming(incoming.settings, cinematic, zoomed, coverage, incoming.lighting);
      local.clearRect(0, 0, layer.width, layer.height);
      local.imageSmoothingEnabled = true;
      // Bilinear filtering stays consistent when a photo crosses 1:1 scale.
      // Browser "high" filtering switches kernels between shrinking/growing.
      local.imageSmoothingQuality = "low";
      // Blend broad color and fine detail separately: an abrupt change from
      // a sharp photograph to a soft extension would itself reveal a box.
      local.drawImage(incoming.extension, shiftX, shiftY, span, span);
      const drawNested = () => {
        const nextSize = projectedSize * settings.patch;
        // Recursion ends below pixel visibility, independently of photo count.
        // The fade also makes changing the depth limit invisible while zooming.
        if (nextSize > 0.5 && depth < 12) {
          const next = pairAt(index);
          const child = nested(index + 1, next, nextSize, depth + 1,
            insetX + (next.rect.x - next.rect.size * HALO) * core, insetY + (next.rect.y - next.rect.size * HALO) * core, globalX, globalY);
          local.globalAlpha = smooth(0.5, 1.5, nextSize);
          local.drawImage(child.layer, 0, 0, child.size, child.size, child.x, child.y, child.size, child.size);
          local.globalAlpha = 1;
        }
      };
      if (stitched) {
        drawProjectedPhoto(local, images[index % images.length].canvas, insetX, insetY, core, globalX, globalY, outputSize);
        drawSharpCrops(local, images[index % images.length].canvas, insetX, insetY, core, globalX, globalY, outputSize);
        local.drawImage(incoming.stitch, shiftX, shiftY, span, span);
        drawNested();
      } else {
        drawPhotoDetail(local, images[index % images.length].canvas, insetX, insetY, core, globalX, globalY, outputSize, settings.patch);
        // Nested photos belong to this one: softened, lit and camouflaged with it.
        drawNested();
        if (incoming.soft && soft > 0.004) {
          local.globalAlpha = soft;
          local.drawImage(incoming.soft, shiftX, shiftY, span, span);
          local.globalAlpha = 1;
        }
        drawLighting(local, incoming.lighting, lit, shiftX, shiftY, span);
        drawLighting(local, incoming.lighting?.rim, Math.max(0, litRim - lit), shiftX, shiftY, span);
        drawCamouflage(local, incoming, form, rim, revealSoftness(incoming.settings), shiftX, shiftY, span);
      }

      // Feather only the extension. It leaves the viewport naturally; making
      // a rectangular mask opaque before it leaves would expose a hard box.
      local.globalCompositeOperation = "destination-out";
      local.drawImage(incoming.cutout, shiftX, shiftY, span, span);
      local.globalCompositeOperation = "source-over";
      // The pixels the layer's edge only partly covers keep a trace of every
      // drawing (lighting most of all), which showed as a thin square line
      // at twice the photo's size. The feather has faded everything there.
      const right = Math.floor(shiftX + span), bottom = Math.floor(shiftY + span);
      local.clearRect(0, 0, layer.width, 1);
      local.clearRect(0, 0, 1, layer.height);
      local.clearRect(right, 0, layer.width - right, layer.height);
      local.clearRect(0, bottom, layer.width, layer.height - bottom);
      return { layer, size, x, y };
    }

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "low";
    const rootSize = images[segment].canvas.width * camera.scale;
    drawProjectedPhoto(ctx, images[segment].canvas, -camera.viewX * camera.scale, -camera.viewY * camera.scale, rootSize, 0, 0, outputSize);
    drawSharpCrops(ctx, images[segment].canvas, -camera.viewX * camera.scale, -camera.viewY * camera.scale, rootSize, 0, 0, outputSize);
    const projectedSize = camera.patchSize * camera.scale;
    const child = nested(segment + 1, first, projectedSize, 0,
      (camera.patchX - camera.viewX) * camera.scale - projectedSize * HALO,
      (camera.patchY - camera.viewY) * camera.scale - projectedSize * HALO);
    ctx.drawImage(child.layer, 0, 0, child.size, child.size, child.x, child.y, child.size, child.size);
    ctx.restore();
    return camera;
  }

  // Share of a photo's area no longer camouflaged at a given coverage of the
  // screen, as drawn by render (for tests).
  function revealedShare(transition, coverage) {
    const order = transition.order;
    if (!order) return 1;
    const cinematic = transition.settings.cinematicMode, zoomed = Math.log(coverage);
    const { form, rim } = revealTiming(transition.settings, cinematic, zoomed, coverage, transition.lighting);
    const softness = revealSoftness(transition.settings), low = form * (1 + 2 * softness) - 2 * softness;
    let shown = 0, count = 0;
    for (let i = 0; i < order.order.length; i++) {
      if (order.distance[i] >= 0.5) continue;
      const inner = form >= 1 ? 0 : smooth(low, low + 2 * softness, order.order[i]);
      const border = smooth(order.rimStart[i], 0.5, order.distance[i]) * (1 - rim);
      shown += 1 - (form <= 0 && rim <= 0 ? 1 : Math.max(inner, border));
      count++;
    }
    return shown / count;
  }

  // How much a spot shimmers (0-1, relative to the photo's most shimmering
  // areas), for tests and the placement editor.
  function spotShimmer(parent, settings, anchorX, anchorY) {
    return anchorField(parent, settings.patch).candidate(anchorX, anchorY).shimmer;
  }

  return { createTransition, geometry, render, matchPair, matchField, revealedShare, setDetail, placementCandidates, joinVisibility, spotShimmer };
})();
