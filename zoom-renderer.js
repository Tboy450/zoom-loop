"use strict";

// Every photo lives in the coordinate system of its parent. Zooming changes
// only the camera; it never moves or spawns a portal during a transition.
const PhotoZoom = (() => {
  const TEXTURE_SIZE = 640;
  const HALO = 0.5;
  const SPAN = 1 + HALO * 2;
  const FRAME = 0.8;
  const analysisCache = new WeakMap();
  const extensionCache = new WeakMap();
  const layers = [];
  const detailLayers = [];
  let detailCutout;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const mix = (a, b, t) => a + (b - a) * t;
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
    // Continue the boundary pixels outside the photo without rescaling its
    // contents. The single, correctly aligned photo remains in the center.
    ctx.drawImage(source, 0, 0, w, 1, x, y - pad, size, pad);
    ctx.drawImage(source, 0, h - 1, w, 1, x, y + size, size, pad);
    ctx.drawImage(source, 0, 0, 1, h, x - pad, y, pad, size);
    ctx.drawImage(source, w - 1, 0, 1, h, x + size, y, pad, size);
    ctx.drawImage(source, 0, 0, 1, 1, x - pad, y - pad, pad, pad);
    ctx.drawImage(source, w - 1, 0, 1, 1, x + size, y - pad, pad, pad);
    ctx.drawImage(source, 0, h - 1, 1, 1, x - pad, y + size, pad, pad);
    ctx.drawImage(source, w - 1, h - 1, 1, 1, x + size, y + size, pad, pad);
    ctx.drawImage(source, x, y, size, size);
  }

  function analysis(source) {
    if (!analysisCache.has(source)) analysisCache.set(source, pixels(source, 128));
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
        for (let c = 0; c < 3; c++) data.data[pixel * 4 + c] = low[pixel * 3 + c];
      }
    }
    ctx.putImageData(data, 0, 0);
    extensionCache.set(source, result);
    return result;
  }

  function drawPhotoDetail(ctx, source, inset, core, coverage, depth) {
    if (coverage >= 1 / FRAME) {
      ctx.drawImage(source, inset, inset, core, core);
      return;
    }
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
    if (!detailLayers[depth]) detailLayers[depth] = canvas(core);
    const sharp = detailLayers[depth];
    if (sharp.width !== core) sharp.width = sharp.height = core;
    const detailCtx = sharp.getContext("2d");
    detailCtx.clearRect(0, 0, core, core);
    detailCtx.drawImage(source, 0, 0, core, core);
    detailCtx.globalCompositeOperation = "destination-out";
    detailCtx.drawImage(detailCutout, 0, 0, core, core);
    detailCtx.globalCompositeOperation = "source-over";
    detailCtx.globalAlpha = 1;
    ctx.drawImage(sharp, inset, inset, core, core);
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
    const mean = [0, 0, 0];
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        for (let c = 0; c < 3; c++) {
          const value = sample(data, x + (col + 0.5) / 8 * width,
            y + (row + 0.5) / 8 * width, c);
          values[(row * 8 + col) * 3 + c] = value;
          mean[c] += value / 64;
        }
      }
    }
    return { values, mean };
  }

  function comparePatches(candidate, target) {
    let pattern = 0;
    let texture = 0;
    let edges = 0;
    let edgeCount = 0;
    for (let i = 0; i < candidate.values.length; i++) {
      const c = i % 3;
      const a = candidate.values[i] - candidate.mean[c];
      const b = target.values[i] - target.mean[c];
      pattern += Math.abs(a - b);
      texture += Math.abs(Math.abs(a) - Math.abs(b));
      for (const offset of [3, 24]) {
        if (offset === 3 ? Math.floor(i / 3) % 8 === 0 : i < 24) continue;
        edges += Math.abs((candidate.values[i] - candidate.values[i - offset]) -
          (target.values[i] - target.values[i - offset]));
        edgeCount++;
      }
    }
    const color = candidate.mean.reduce((sum, v, c) => sum + Math.abs(v - target.mean[c]), 0) / 3;
    return (pattern * 0.5 + texture * 0.2) / candidate.values.length / 255 +
      color / 255 * 0.22 + edges / edgeCount / 255 * 0.08;
  }

  function findAnchor(parent, child, settings) {
    const parentData = analysis(parent);
    const childData = analysis(child);
    const inset = (1 - FRAME) / 2;
    const target = patchSamples(childData, inset, inset, FRAME);
    const fullTarget = patchSamples(childData, 0, 0, 1);
    const p = settings.patch;
    // Search inside the visible crop, not the unseen edges of the source.
    const margin = inset + p / 2 + 0.05;
    const centralMargin = Math.max(0.32, margin);
    const score = (anchorX, anchorY) => {
      const x = anchorX - p / 2, y = anchorY - p / 2;
      const candidate = patchSamples(parentData, x + p * inset, y + p * inset, p * FRAME);
      const fullCandidate = patchSamples(parentData, x, y, p);
      let boundary = 0;
      for (let i = 0; i < 8; i++) {
        const along = (i + 0.5) / 8;
        const step = p / 16;
        for (const edge of [0, 1]) {
          for (let c = 0; c < 3; c++) {
            boundary += Math.abs(sample(parentData, x + p * along, y + p * edge - step, c) -
              sample(parentData, x + p * along, y + p * edge + step, c));
            boundary += Math.abs(sample(parentData, x + p * edge - step, y + p * along, c) -
              sample(parentData, x + p * edge + step, y + p * along, c));
          }
        }
      }
      const match = comparePatches(candidate, target) * 0.75 +
        comparePatches(fullCandidate, fullTarget) * 0.25 + boundary / (96 * 255) * 0.04;
      return { anchorX, anchorY, match, score: match + Math.hypot(anchorX - 0.5, anchorY - 0.5) * 0.06 };
    };
    const search = (limit) => {
      let best = score(0.5, 0.5);
      const consider = (x, y) => {
        const candidate = score(clamp(x, limit, 1 - limit), clamp(y, limit, 1 - limit));
        if (candidate.score < best.score) best = candidate;
      };
      for (let y = 0; y < 13; y++) {
        for (let x = 0; x < 13; x++) consider(mix(limit, 1 - limit, x / 12), mix(limit, 1 - limit, y / 12));
      }
      for (const step of [0.025, 0.008]) {
        const { anchorX, anchorY } = best;
        for (let y = -1; y <= 1; y++) {
          for (let x = -1; x <= 1; x++) consider(anchorX + x * step, anchorY + y * step);
        }
      }
      return best;
    };
    const central = search(centralMargin);
    const wide = search(margin);
    const offCenter = Math.min(wide.anchorX, wide.anchorY, 1 - wide.anchorX, 1 - wide.anchorY) < centralMargin;
    const improvement = central.match - wide.match;
    // Small score differences are not evidence that a long camera pan is better.
    const useWide = wide.score < central.score &&
      (!offCenter || improvement >= Math.max(0.025, central.match * 0.2));
    const best = useWide ? wide : central;
    return {
      anchorX: best.anchorX,
      anchorY: best.anchorY,
      placement: {
        mode: "auto",
        reason: useWide && offCenter ? "stronger-match" : "balanced",
        matchImprovement: useWide && offCenter ? improvement : 0
      }
    };
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
  function lowPass(image, radius) {
    const { width: size, data } = image;
    const horizontal = new Float32Array(size * size * 3);
    const result = new Float32Array(horizontal.length);
    const count = radius * 2 + 1;
    for (let y = 0; y < size; y++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let k = -radius; k <= radius; k++) sum += data[(y * size + clamp(k, 0, size - 1)) * 4 + c];
        for (let x = 0; x < size; x++) {
          horizontal[(y * size + x) * 3 + c] = sum / count;
          sum += data[(y * size + clamp(x + radius + 1, 0, size - 1)) * 4 + c] -
            data[(y * size + clamp(x - radius, 0, size - 1)) * 4 + c];
        }
      }
    }
    for (let x = 0; x < size; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let k = -radius; k <= radius; k++) sum += horizontal[(clamp(k, 0, size - 1) * size + x) * 3 + c];
        for (let y = 0; y < size; y++) {
          result[(y * size + x) * 3 + c] = sum / count;
          sum += horizontal[(clamp(y + radius + 1, 0, size - 1) * size + x) * 3 + c] -
            horizontal[(clamp(y - radius, 0, size - 1) * size + x) * 3 + c];
        }
      }
    }
    return result;
  }

  function createTransition(parent, child, requested, override) {
    const settings = { ...requested };
    let placement = { mode: override ? "picked" : "manual" };
    if (override) Object.assign(settings, override, { autoAnchor: false });
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
    const parentData = patchCtx.getImageData(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
    const childExtension = extension(child);
    const childSource = canvas(TEXTURE_SIZE);
    const childCtx = childSource.getContext("2d", { willReadFrequently: true });
    drawExtended(childCtx, child, TEXTURE_SIZE * HALO / SPAN, TEXTURE_SIZE * HALO / SPAN, TEXTURE_SIZE / SPAN);
    const childData = childCtx.getImageData(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
    if (settings.mode === "stitched") {
      return { ...createStitchedTransition(parentData, childData, childExtension, settings, portal), placement };
    }
    const radius = Math.round(18 + settings.sampleBlend * 38);
    const parentLow = lowPass(parentData, radius);
    const childLow = lowPass(childData, radius);
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
          const detail = childData.data[childPixel * 4 + c] - childLow[childPixel * 3 + c];
          const parentDetail = parentData.data[i + c] - parentLow[pixel * 3 + c];
          const detailGain = clamp((Math.abs(parentDetail) + 1) / (Math.abs(detail) + 12), 0.035, 0.28);
          const camouflaged = parentData.data[i + c] + detail * detailGain;
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
    return { settings, rect: portal, texture, cutout, extension: childExtension, placement };
  }

  function createStitchedTransition(parent, child, childExtension, settings, portal) {
    // Prepare a multiband join once. Fine detail changes over a narrow seam;
    // broad color and lighting change across a much wider surrounding region.
    // All masks live in photo coordinates and never depend on the playhead.
    const parentBands = [3, 14, 48].map(radius => lowPass(parent, radius));
    const childBands = [3, 14, 48].map(radius => lowPass(child, radius));
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
        const variation = settings.shapeMorph * 0.025 * Math.sin(u * 17) * Math.sin(v * 19);
        const distance = d + variation * smooth(0.4, 0.6, d);
        const fine = 1 - smooth(0.44, 0.64, distance);
        const medium = 1 - smooth(0.4, mix(0.65, 0.85, settings.sampleBlend), distance);
        const broad = 1 - smooth(0.32, 0.94, distance);
        const lighting = 1 - smooth(mix(0.45, 0.22, settings.bind), 1, distance);
        for (let c = 0; c < 3; c++) {
          const k = pixel * 3 + c;
          const a = pixel * 4 + c;
          result.data[a] =
            mix(parent.data[a] - parentBands[0][k], child.data[a] - childBands[0][k], fine) +
            mix(parentBands[0][k] - parentBands[1][k], childBands[0][k] - childBands[1][k], medium) +
            mix(parentBands[1][k] - parentBands[2][k], childBands[1][k] - childBands[2][k], broad) +
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
    return { settings, rect: portal, stitch, cutout, extension: childExtension };
  }

  function layerAt(depth, projectedSize, outputSize) {
    // Bucket sizes avoid reallocating a canvas on every animation frame.
    const size = Math.min(outputSize, Math.max(32, 2 ** Math.ceil(Math.log2(projectedSize))));
    if (!layers[depth]) layers[depth] = canvas(size);
    const layer = layers[depth];
    if (layer.width !== size) layer.width = layer.height = size;
    return layer;
  }

  function render(ctx, images, segment, t, settings, getTransition) {
    const outputSize = ctx.canvas.width;
    const pairAt = (index) => getTransition(images[index % images.length], images[(index + 1) % images.length], settings);
    const first = pairAt(segment);
    const camera = geometry(t, first.settings, outputSize, images[segment].canvas.width);

    function nested(index, incoming, projectedSize, depth) {
      const layer = layerAt(depth, projectedSize * SPAN, outputSize * SPAN / FRAME);
      const local = layer.getContext("2d");
      const size = layer.width;
      const core = size / SPAN;
      const inset = core * HALO;
      const coverage = projectedSize / outputSize;
      const stitched = settings.mode === "stitched";
      const reveal = stitched ? 1 : smooth(incoming.settings.cinematicMode ? 0.2 : 0.16, 0.9, coverage);
      local.clearRect(0, 0, size, size);
      local.imageSmoothingEnabled = true;
      local.imageSmoothingQuality = "high";
      // Blend broad color and fine detail separately: an abrupt change from
      // a sharp photograph to a soft extension would itself reveal a box.
      local.drawImage(incoming.extension, 0, 0, size, size);
      if (stitched) {
        local.drawImage(images[index % images.length].canvas, inset, inset, core, core);
        local.drawImage(incoming.stitch, 0, 0, size, size);
      } else {
        drawPhotoDetail(local, images[index % images.length].canvas, inset, core, coverage, depth);
        local.globalAlpha = 1 - reveal;
        local.drawImage(incoming.texture, 0, 0, size, size);
      }
      local.globalAlpha = 1;

      const nextSize = projectedSize * settings.patch;
      // Recursion ends below pixel visibility, independently of photo count.
      // The fade also makes changing the depth limit invisible while zooming.
      if (nextSize > 0.5 && depth < 12) {
        const next = pairAt(index);
        const child = nested(index + 1, next, nextSize, depth + 1);
        local.globalAlpha = smooth(0.5, 1.5, nextSize) * reveal;
        local.drawImage(child, inset + (next.rect.x - next.rect.size * HALO) * core,
          inset + (next.rect.y - next.rect.size * HALO) * core, next.rect.size * core * SPAN, next.rect.size * core * SPAN);
        local.globalAlpha = 1;
      }

      // Feather only the extension. It leaves the viewport naturally; making
      // a rectangular mask opaque before it leaves would expose a hard box.
      local.globalCompositeOperation = "destination-out";
      local.drawImage(incoming.cutout, 0, 0, size, size);
      local.globalCompositeOperation = "source-over";
      return layer;
    }

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    const rootSize = images[segment].canvas.width * camera.scale;
    ctx.drawImage(images[segment].canvas, -camera.viewX * camera.scale, -camera.viewY * camera.scale, rootSize, rootSize);
    const projectedSize = camera.patchSize * camera.scale;
    const child = nested(segment + 1, first, projectedSize, 0);
    ctx.drawImage(child, (camera.patchX - camera.viewX) * camera.scale - projectedSize * HALO,
      (camera.patchY - camera.viewY) * camera.scale - projectedSize * HALO, projectedSize * SPAN, projectedSize * SPAN);
    ctx.restore();
    return camera;
  }

  return { createTransition, geometry, render };
})();
