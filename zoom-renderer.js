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

  function findAnchor(parent, child, settings) {
    const parentData = analysis(parent);
    const target = patchSamples(analysis(child), 0, 0, 1);
    const p = settings.patch;
    const margin = Math.max(0.16, p / 2 + 0.04);
    let best = { anchorX: 0.5, anchorY: 0.5, score: Infinity };
    const score = (cx, cy) => {
      const candidate = patchSamples(parentData, cx - p / 2, cy - p / 2, p);
      let pattern = 0;
      let texture = 0;
      let parentEnergy = 0;
      for (let i = 0; i < candidate.values.length; i++) {
        const c = i % 3;
        const a = candidate.values[i] - candidate.mean[c];
        const b = target.values[i] - target.mean[c];
        // Compare structure after exposure/color offsets, not just averages.
        pattern += Math.abs(a - b);
        texture += Math.abs(Math.abs(a) - Math.abs(b));
        parentEnergy += Math.abs(a);
      }
      const color = candidate.mean.reduce((sum, v, c) => sum + Math.abs(v - target.mean[c]), 0) / 3;
      const framing = Math.hypot(cx - 0.5, cy - 0.5);
      const flat = 1 - smooth(3, 20, parentEnergy / candidate.values.length);
      return (pattern * 0.55 + texture * 0.25) / candidate.values.length / 255 +
        color / 255 * 0.22 + framing * 0.055 + flat * 0.025;
    };
    const consider = (x, y) => {
      const anchorX = clamp(x, margin, 1 - margin);
      const anchorY = clamp(y, margin, 1 - margin);
      const value = score(anchorX, anchorY);
      if (value < best.score) best = { anchorX, anchorY, score: value };
    };
    for (let y = 0; y < 13; y++) {
      for (let x = 0; x < 13; x++) consider(mix(margin, 1 - margin, x / 12), mix(margin, 1 - margin, y / 12));
    }
    for (const step of [0.025, 0.008]) {
      const { anchorX, anchorY } = best;
      for (let y = -1; y <= 1; y++) {
        for (let x = -1; x <= 1; x++) consider(anchorX + x * step, anchorY + y * step);
      }
    }
    return best;
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
    const centerT = smooth(0, 1, time);
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
    if (override) Object.assign(settings, override, { autoAnchor: false });
    else if (settings.autoAnchor) Object.assign(settings, findAnchor(parent, child, settings));
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
    return { settings, rect: portal, texture, cutout, extension: childExtension };
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
      const reveal = smooth(incoming.settings.cinematicMode ? 0.2 : 0.16, 0.9, coverage);
      local.clearRect(0, 0, size, size);
      local.imageSmoothingEnabled = true;
      local.imageSmoothingQuality = "high";
      // Blend broad color and fine detail separately: an abrupt change from
      // a sharp photograph to a soft extension would itself reveal a box.
      local.drawImage(incoming.extension, 0, 0, size, size);
      drawPhotoDetail(local, images[index % images.length].canvas, inset, core, coverage, depth);
      local.globalAlpha = 1 - reveal;
      local.drawImage(incoming.texture, 0, 0, size, size);
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
