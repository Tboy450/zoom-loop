"use strict";

// Every photo lives in the coordinate system of its parent. Zooming changes
// only the camera; it never moves or spawns a portal during a transition.
const PhotoZoom = (() => {
  const TEXTURE_SIZE = 640;
  const HALO = 0.5;
  const SPAN = 1 + HALO * 2;
  const FRAME = 0.8;
  const MAX_LAYER = 4096;
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

  function drawPhotoDetail(ctx, source, x, y, core, offsetX, offsetY, outputSize) {
    const inset = core * 0.09;
    if (x + offsetX + inset <= 0 && y + offsetY + inset <= 0 &&
        x + offsetX + core - inset >= outputSize && y + offsetY + core - inset >= outputSize) {
      drawProjectedPhoto(ctx, source, x, y, core, offsetX, offsetY, outputSize);
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
    let sharp = detailCache.get(source);
    if (!sharp) {
      sharp = canvas(source.width);
      const detailCtx = sharp.getContext("2d");
      detailCtx.drawImage(source, 0, 0);
      detailCtx.globalCompositeOperation = "destination-out";
      detailCtx.drawImage(detailCutout, 0, 0, sharp.width, sharp.height);
      detailCache.set(source, sharp);
    }
    drawProjectedPhoto(ctx, sharp, x, y, core, offsetX, offsetY, outputSize);
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
    const integralAt = (c, u, v) => {
      const px = clamp(u * data.width, 0, data.width), py = clamp(v * data.height, 0, data.height);
      const ix = Math.floor(px), iy = Math.floor(py);
      const nx = Math.min(ix + 1, data.width), ny = Math.min(iy + 1, data.height);
      const stride = data.width + 1, sum = data.integrals[c];
      return mix(mix(sum[iy * stride + ix], sum[iy * stride + nx], px - ix),
        mix(sum[ny * stride + ix], sum[ny * stride + nx], px - ix), py - iy);
    };
    let edgeIndex = 0;
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const left = x + col / 8 * width, top = y + row / 8 * width;
        const right = left + width / 8, bottom = top + width / 8;
        const area = (right - left) * (bottom - top) * data.width * data.height;
        const average = c => (integralAt(c, right, bottom) - integralAt(c, left, bottom) -
          integralAt(c, right, top) + integralAt(c, left, top)) / area;
        const r = average(0), g = average(1), b = average(2);
        const light = r * 0.2126 + g * 0.7152 + b * 0.0722;
        const components = [light / 255, (r - light) / 255, (b - light) / 255];
        const index = row * 8 + col;
        for (let c = 0; c < 3; c++) {
          values[index * 3 + c] = components[c];
          mean[c] += components[c] / 64;
        }
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

  function anchorField(parent, p) {
    let field = anchorFields.get(parent);
    if (!field || field.patch !== p) {
      const parentData = analysis(parent);
      const margin = (1 - FRAME) / 2 + p / 2 + 0.05;
      field = { patch: p, center: anchorCandidate(parentData, 0.5, 0.5, p), grids: [] };
      for (const limit of [Math.max(0.32, margin), margin]) {
        const grid = [];
        for (let y = 0; y < 13; y++) for (let x = 0; x < 13; x++) {
          grid.push(anchorCandidate(parentData, mix(limit, 1 - limit, x / 12), mix(limit, 1 - limit, y / 12), p));
        }
        field.grids.push(grid);
      }
      anchorFields.set(parent, field);
    }
    return field;
  }

  // Match quality across the parent, for showing people where a photo would
  // blend in well. Lower match values are better, as in findAnchor.
  function matchField(parent, child, settings) {
    const target = photoFeatures(child);
    return anchorField(parent, settings.patch).grids[1].map(candidate => ({
      anchorX: candidate.anchorX, anchorY: candidate.anchorY,
      match: comparePatches(candidate.core, target.core, settings.matchPriority) * 0.65 +
        comparePatches(candidate.full, target.full, settings.matchPriority) * 0.35 + candidate.boundary * 0.04
    }));
  }

  function findAnchor(parent, child, settings, quick = false) {
    let children = matchCache.get(parent);
    if (!children) matchCache.set(parent, children = new WeakMap());
    let matches = children.get(child);
    if (!matches) children.set(child, matches = new Map());
    const key = `${settings.patch}:${settings.matchPriority || "balanced"}:${quick}`;
    if (matches.has(key)) return matches.get(key);
    const parentData = analysis(parent);
    const inset = (1 - FRAME) / 2;
    const target = photoFeatures(child);
    const p = settings.patch;
    // Search inside the visible crop, not the unseen edges of the source.
    const margin = inset + p / 2 + 0.05;
    const centralMargin = Math.max(0.32, margin);
    const score = candidate => {
      const match = comparePatches(candidate.core, target.core, settings.matchPriority) * 0.65 +
        comparePatches(candidate.full, target.full, settings.matchPriority) * 0.35 + candidate.boundary * 0.04;
      return { anchorX: candidate.anchorX, anchorY: candidate.anchorY, match,
        score: match + Math.hypot(candidate.anchorX - 0.5, candidate.anchorY - 0.5) * 0.06 };
    };
    const field = anchorField(parent, p);
    const search = (limit, grid) => {
      let best = score(field.center);
      const consider = (x, y) => {
        const candidate = score(anchorCandidate(parentData, clamp(x, limit, 1 - limit), clamp(y, limit, 1 - limit), p));
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

  function matchPair(parent, child, settings, override, quick = false) {
    if (settings.autoAnchor && !override) return findAnchor(parent, child, settings, quick);
    const point = rect({ ...settings, ...override });
    const candidate = anchorCandidate(analysis(parent), point.x + point.size / 2, point.y + point.size / 2, point.size);
    const target = photoFeatures(child);
    const match = comparePatches(candidate.core, target.core, settings.matchPriority) * 0.65 +
      comparePatches(candidate.full, target.full, settings.matchPriority) * 0.35 + candidate.boundary * 0.04;
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
      // Stitched World keeps every photo's own colors throughout.
      return { ...createStitchedTransition(parentData, childData, childExtension, settings, portal), placement };
    }
    const grade = createGrade(parentData, childData, settings);
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
          const detailGain = clamp((Math.abs(parentDetail) + 1) / (Math.abs(detail) + 12), 0.01, 0.28);
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
    const surround = createSurround(parentData, childData, settings);
    return { settings, rect: portal, texture, cutout, extension: surround, placement, grade };
  }

  function createGrade(parent, child, settings) {
    // Match the incoming photo's overall color to the area it replaces while
    // it is small, then relax to its true color as it fills the screen. The
    // grade is uniform across the photo, so it cannot draw an inner frame,
    // and fades out across the halo along with the lighting handoff.
    const mean = data => {
      const sum = [0, 0, 0];
      let count = 0;
      for (let y = 2; y < TEXTURE_SIZE; y += 4) {
        for (let x = 2; x < TEXTURE_SIZE; x += 4) {
          const u = (x + 0.5) / TEXTURE_SIZE * SPAN - HALO, v = (y + 0.5) / TEXTURE_SIZE * SPAN - HALO;
          if (u < 0 || u > 1 || v < 0 || v > 1) continue;
          const i = (y * TEXTURE_SIZE + x) * 4;
          for (let c = 0; c < 3; c++) sum[c] += data.data[i + c];
          count++;
        }
      }
      return sum.map(value => value / count / 255);
    };
    const target = mean(parent), source = mean(child);
    const gains = target.map((value, c) => clamp((value + 0.03) / (source[c] + 0.03), 0.45, 2.2));
    if (gains.every(gain => Math.abs(gain - 1) < 0.02)) return null;
    // Darkening uses multiply; brightening uses screen, sized so the mean of
    // each channel lands where the gain would put it.
    const multiply = gains.map(gain => Math.min(1, gain));
    const screen = gains.map((gain, c) => gain <= 1 ? 0 : clamp((gain - 1) * source[c] / Math.max(0.04, 1 - source[c]), 0, 1));
    const size = 64, reach = mix(0.32, 0.5, settings.edgeBlend);
    const layers = [multiply, screen].map((color, layer) => {
      const result = canvas(size);
      const ctx = result.getContext("2d");
      const image = ctx.createImageData(size, size);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const u = (x + 0.5) / size * SPAN - HALO, v = (y + 0.5) / size * SPAN - HALO;
          const weight = 1 - smooth(0, reach, Math.hypot(Math.max(0, -u, u - 1), Math.max(0, -v, v - 1)));
          const i = (y * size + x) * 4;
          for (let c = 0; c < 3; c++) image.data[i + c] = 255 * (layer ? color[c] * weight : 1 - (1 - color[c]) * weight);
          image.data[i + 3] = 255;
        }
      }
      ctx.putImageData(image, 0, 0);
      return result;
    });
    return { multiply: layers[0], screen: layers[1], strength: 0.7 * settings.bind };
  }

  function createSurround(parent, child, settings) {
    // Backing for a growing photo: the photo itself inside its edge, then a
    // multiband handoff to the parent's own material. Fine texture switches
    // to the parent almost at the edge, while lighting and color grade over
    // the whole feather, so the join shows neither a blur ring nor mirrored
    // copies of the incoming photo.
    const radii = [3, 14, 48];
    const parentBands = radii.map(radius => lowPass(parent, radius));
    const childBands = radii.map(radius => lowPass(child, radius));
    const reach = [0.03, 0.08, 0.18, mix(0.32, 0.5, settings.edgeBlend)];
    const result = canvas(TEXTURE_SIZE);
    const ctx = result.getContext("2d");
    const out = ctx.createImageData(TEXTURE_SIZE, TEXTURE_SIZE);
    for (let y = 0; y < TEXTURE_SIZE; y++) {
      for (let x = 0; x < TEXTURE_SIZE; x++) {
        const pixel = y * TEXTURE_SIZE + x;
        const u = (x + 0.5) / TEXTURE_SIZE * SPAN - HALO, v = (y + 0.5) / TEXTURE_SIZE * SPAN - HALO;
        const outside = Math.hypot(Math.max(0, -u, u - 1), Math.max(0, -v, v - 1));
        const weights = reach.map(r => smooth(0, r, outside));
        for (let c = 0; c < 3; c++) {
          const i = pixel * 4 + c, k = pixel * 3 + c;
          if (outside <= 0) { out.data[i] = child.data[i]; continue; }
          out.data[i] =
            mix(child.data[i] - childBands[0][k], parent.data[i] - parentBands[0][k], weights[0]) +
            mix(childBands[0][k] - childBands[1][k], parentBands[0][k] - parentBands[1][k], weights[1]) +
            mix(childBands[1][k] - childBands[2][k], parentBands[1][k] - parentBands[2][k], weights[2]) +
            mix(childBands[2][k], parentBands[2][k], weights[3]);
        }
        out.data[pixel * 4 + 3] = 255;
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
      const reveal = stitched ? 1 : smooth(incoming.settings.cinematicMode ? 0.2 : 0.16, 0.9, coverage);
      local.clearRect(0, 0, layer.width, layer.height);
      local.imageSmoothingEnabled = true;
      // Bilinear filtering stays consistent when a photo crosses 1:1 scale.
      // Browser "high" filtering switches kernels between shrinking/growing.
      local.imageSmoothingQuality = "low";
      // Blend broad color and fine detail separately: an abrupt change from
      // a sharp photograph to a soft extension would itself reveal a box.
      local.drawImage(incoming.extension, shiftX, shiftY, span, span);
      // Relaxes to the photo's own color well before it fills the screen,
      // so the handoff to the next segment stays pixel-identical.
      const grade = incoming.grade ? incoming.grade.strength * (1 - smooth(0.12, 0.85, coverage)) : 0;
      const applyGrade = () => {
        if (grade < 0.004) return;
        local.globalAlpha = grade;
        local.globalCompositeOperation = "multiply";
        local.drawImage(incoming.grade.multiply, shiftX, shiftY, span, span);
        local.globalCompositeOperation = "screen";
        local.drawImage(incoming.grade.screen, shiftX, shiftY, span, span);
        local.globalCompositeOperation = "source-over";
        local.globalAlpha = 1;
      };
      if (stitched) {
        drawProjectedPhoto(local, images[index % images.length].canvas, insetX, insetY, core, globalX, globalY, outputSize);
        local.drawImage(incoming.stitch, shiftX, shiftY, span, span);
      } else {
        drawPhotoDetail(local, images[index % images.length].canvas, insetX, insetY, core, globalX, globalY, outputSize);
        applyGrade();
        local.globalAlpha = 1 - reveal;
        local.drawImage(incoming.texture, shiftX, shiftY, span, span);
      }
      local.globalAlpha = 1;

      const nextSize = projectedSize * settings.patch;
      // Recursion ends below pixel visibility, independently of photo count.
      // The fade also makes changing the depth limit invisible while zooming.
      if (nextSize > 0.5 && depth < 12) {
        const next = pairAt(index);
        const child = nested(index + 1, next, nextSize, depth + 1,
          insetX + (next.rect.x - next.rect.size * HALO) * core, insetY + (next.rect.y - next.rect.size * HALO) * core, globalX, globalY);
        local.globalAlpha = smooth(0.5, 1.5, nextSize) * reveal;
        local.drawImage(child.layer, 0, 0, child.size, child.size, child.x, child.y, child.size, child.size);
        local.globalAlpha = 1;
      }

      // Feather only the extension. It leaves the viewport naturally; making
      // a rectangular mask opaque before it leaves would expose a hard box.
      local.globalCompositeOperation = "destination-out";
      local.drawImage(incoming.cutout, shiftX, shiftY, span, span);
      local.globalCompositeOperation = "source-over";
      return { layer, size, x, y };
    }

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "low";
    const rootSize = images[segment].canvas.width * camera.scale;
    drawProjectedPhoto(ctx, images[segment].canvas, -camera.viewX * camera.scale, -camera.viewY * camera.scale, rootSize, 0, 0, outputSize);
    const projectedSize = camera.patchSize * camera.scale;
    const child = nested(segment + 1, first, projectedSize, 0,
      (camera.patchX - camera.viewX) * camera.scale - projectedSize * HALO,
      (camera.patchY - camera.viewY) * camera.scale - projectedSize * HALO);
    ctx.drawImage(child.layer, 0, 0, child.size, child.size, child.x, child.y, child.size, child.size);
    ctx.restore();
    return camera;
  }

  return { createTransition, geometry, render, matchPair, matchField };
})();
