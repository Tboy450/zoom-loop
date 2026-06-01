"use strict";

const previewCanvas = document.querySelector("#previewCanvas");
const previewCtx = previewCanvas.getContext("2d", { alpha: false });

const fileInput = document.querySelector("#fileInput");
const dropZone = document.querySelector("#dropZone");
const imageList = document.querySelector("#imageList");
const statusText = document.querySelector("#statusText");
const playButton = document.querySelector("#playButton");
const stagePlayButton = document.querySelector("#stagePlayButton");
const pngButton = document.querySelector("#pngButton");
const webmButton = document.querySelector("#webmButton");
const sampleButton = document.querySelector("#sampleButton");
const clearButton = document.querySelector("#clearButton");
const timelineInput = document.querySelector("#timelineInput");
const timeReadout = document.querySelector("#timeReadout");

const sizeInput = document.querySelector("#sizeInput");
const framesInput = document.querySelector("#framesInput");
const fpsInput = document.querySelector("#fpsInput");
const zoomRateInput = document.querySelector("#zoomRateInput");
const patchInput = document.querySelector("#patchInput");
const autoAnchorInput = document.querySelector("#autoAnchorInput");
const anchorXInput = document.querySelector("#anchorXInput");
const anchorYInput = document.querySelector("#anchorYInput");
const bindInput = document.querySelector("#bindInput");
const sampleBlendInput = document.querySelector("#sampleBlendInput");
const grainInput = document.querySelector("#grainInput");
const symmetryInput = document.querySelector("#symmetryInput");
const alignmentInput = document.querySelector("#alignmentInput");

const SOURCE_SIZE = 1024;
const MICRO_SIZE = 640;
const TAU = Math.PI * 2;

const state = {
  images: [],
  transitions: new Map(),
  progress: 0,
  isPlaying: false,
  isRecording: false,
  lastTime: 0,
  dragDepth: 0
};

const controls = [
  sizeInput,
  framesInput,
  fpsInput,
  zoomRateInput,
  patchInput,
  autoAnchorInput,
  anchorXInput,
  anchorYInput,
  bindInput,
  sampleBlendInput,
  grainInput,
  symmetryInput,
  alignmentInput
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function makeCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function coverDraw(ctx, image, width, height) {
  const sourceW = image.width;
  const sourceH = image.height;
  const sourceRatio = sourceW / sourceH;
  const targetRatio = width / height;
  let cropW = sourceW;
  let cropH = sourceH;
  let cropX = 0;
  let cropY = 0;

  if (sourceRatio > targetRatio) {
    cropW = sourceH * targetRatio;
    cropX = (sourceW - cropW) / 2;
  } else {
    cropH = sourceW / targetRatio;
    cropY = (sourceH - cropH) / 2;
  }

  ctx.drawImage(image, cropX, cropY, cropW, cropH, 0, 0, width, height);
}

function normalizeImage(image) {
  const canvas = makeCanvas(SOURCE_SIZE, SOURCE_SIZE);
  const ctx = canvas.getContext("2d", { alpha: false });
  coverDraw(ctx, image, SOURCE_SIZE, SOURCE_SIZE);
  return canvas;
}

function setCanvasSize(size) {
  if (previewCanvas.width === size && previewCanvas.height === size) return;
  previewCanvas.width = size;
  previewCanvas.height = size;
}

function getSettings() {
  return {
    size: Number(sizeInput.value),
    frames: Number(framesInput.value),
    fps: Number(fpsInput.value),
    zoomRate: Number(zoomRateInput.value) / 100,
    patch: Number(patchInput.value) / 100,
    autoAnchor: autoAnchorInput.checked,
    anchorX: Number(anchorXInput.value) / 100,
    anchorY: Number(anchorYInput.value) / 100,
    bind: Number(bindInput.value) / 100,
    sampleBlend: Number(sampleBlendInput.value) / 100,
    grain: Number(grainInput.value) / 100,
    symmetry: Number(symmetryInput.value),
    alignment: Number(alignmentInput.value) / 360
  };
}

function getTransitionFrames(settings) {
  return Math.max(8, Math.round(settings.frames / Math.max(0.25, settings.zoomRate)));
}

function transitionKey(fromId, toId, settings) {
  return [
    fromId,
    toId,
    settings.patch.toFixed(3),
    settings.autoAnchor ? "auto" : "manual",
    settings.anchorX.toFixed(3),
    settings.anchorY.toFixed(3),
    settings.bind.toFixed(3),
    settings.sampleBlend.toFixed(3),
    settings.grain.toFixed(3),
    settings.symmetry,
    settings.alignment.toFixed(3)
  ].join(":");
}

function invalidateTransitions() {
  state.transitions.clear();
}

async function loadFiles(files) {
  const imageFiles = [...files].filter((file) => file.type.startsWith("image/"));
  if (!imageFiles.length) return;

  statusText.textContent = "Loading images";

  for (const file of imageFiles) {
    const url = URL.createObjectURL(file);
    const bitmap = await createImageBitmap(file);
    const canvas = normalizeImage(bitmap);
    state.images.push({
      id: crypto.randomUUID(),
      name: file.name,
      width: bitmap.width,
      height: bitmap.height,
      url,
      canvas
    });
    bitmap.close();
  }

  invalidateTransitions();
  renderImageList();
  updateStatus();
  drawCurrentFrame();
}

function renderImageList() {
  imageList.replaceChildren();

  state.images.forEach((image, index) => {
    const item = document.createElement("li");
    item.className = "image-item";

    const thumb = document.createElement("img");
    thumb.src = image.url;
    thumb.alt = "";

    const meta = document.createElement("div");
    meta.className = "image-meta";
    const name = document.createElement("strong");
    name.textContent = image.name;
    const detail = document.createElement("span");
    detail.textContent = `${image.width} x ${image.height}`;
    meta.append(name, detail);

    const actions = document.createElement("div");
    actions.className = "image-actions";
    const up = document.createElement("button");
    up.type = "button";
    up.textContent = "Up";
    up.disabled = index === 0;
    up.addEventListener("click", () => moveImage(index, -1));

    const down = document.createElement("button");
    down.type = "button";
    down.textContent = "Dn";
    down.disabled = index === state.images.length - 1;
    down.addEventListener("click", () => moveImage(index, 1));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "X";
    remove.addEventListener("click", () => removeImage(index));

    actions.append(up, down, remove);
    item.append(thumb, meta, actions);
    imageList.append(item);
  });
}

function moveImage(index, direction) {
  const next = index + direction;
  if (next < 0 || next >= state.images.length) return;
  const [image] = state.images.splice(index, 1);
  state.images.splice(next, 0, image);
  invalidateTransitions();
  renderImageList();
  drawCurrentFrame();
}

function removeImage(index) {
  const [image] = state.images.splice(index, 1);
  if (image?.url?.startsWith("blob:")) URL.revokeObjectURL(image.url);
  invalidateTransitions();
  renderImageList();
  updateStatus();
  drawCurrentFrame();
}

function clearImages() {
  state.images.forEach((image) => {
    if (image.url.startsWith("blob:")) URL.revokeObjectURL(image.url);
  });
  state.images = [];
  state.transitions.clear();
  state.progress = 0;
  timelineInput.value = "0";
  renderImageList();
  updateStatus();
  drawCurrentFrame();
}

function updateStatus() {
  const count = state.images.length;
  if (count === 0) statusText.textContent = "Empty stack";
  else if (count === 1) statusText.textContent = "Add one more image";
  else statusText.textContent = `${count} images in loop`;
  if (count < 2 || state.isRecording) {
    state.isPlaying = false;
  }
  playButton.disabled = count < 2 || state.isRecording;
  stagePlayButton.disabled = count < 2 || state.isRecording;
  webmButton.disabled = count < 2 || state.isRecording;
  syncPlaybackUi();
}

function syncPlaybackUi() {
  const label = state.isPlaying ? "Pause" : "Play";
  playButton.textContent = label;
  stagePlayButton.classList.toggle("is-playing", state.isPlaying);
  stagePlayButton.setAttribute("aria-label", `${label} loop`);
}

function togglePlayback() {
  if (state.images.length < 2 || state.isRecording) return;
  state.isPlaying = !state.isPlaying;
  state.lastTime = 0;
  syncPlaybackUi();
}

function syncAnchorMode() {
  const isAuto = autoAnchorInput.checked;
  anchorXInput.disabled = isAuto;
  anchorYInput.disabled = isAuto;
}

function drawEmpty() {
  const size = previewCanvas.width;
  const ctx = previewCtx;
  ctx.fillStyle = "#0b0c0d";
  ctx.fillRect(0, 0, size, size);

  const grid = 48;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
  ctx.lineWidth = 1;
  for (let line = 0; line <= size; line += grid) {
    ctx.beginPath();
    ctx.moveTo(line, 0);
    ctx.lineTo(line, size);
    ctx.moveTo(0, line);
    ctx.lineTo(size, line);
    ctx.stroke();
  }

  ctx.fillStyle = "#f5f2ec";
  ctx.font = "700 34px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Zoom Loop", size / 2, size / 2 - 12);
  ctx.fillStyle = "#aaa398";
  ctx.font = "16px system-ui, sans-serif";
  ctx.fillText("No source stack", size / 2, size / 2 + 24);
}

function drawSingleImage() {
  const size = previewCanvas.width;
  previewCtx.fillStyle = "#0b0c0d";
  previewCtx.fillRect(0, 0, size, size);
  previewCtx.drawImage(state.images[0].canvas, 0, 0, size, size);
}

function getParentPatchColor(parentCanvas, settings) {
  const ctx = parentCanvas.getContext("2d", { willReadFrequently: true });
  const patchSize = Math.max(8, Math.round(SOURCE_SIZE * settings.patch));
  const x = clamp(Math.round(SOURCE_SIZE * settings.anchorX - patchSize / 2), 0, SOURCE_SIZE - patchSize);
  const y = clamp(Math.round(SOURCE_SIZE * settings.anchorY - patchSize / 2), 0, SOURCE_SIZE - patchSize);
  const data = ctx.getImageData(x, y, patchSize, patchSize).data;
  let r = 0;
  let g = 0;
  let b = 0;
  const step = 16;
  let count = 0;

  for (let i = 0; i < data.length; i += 4 * step) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    count++;
  }

  return {
    r: r / count,
    g: g / count,
    b: b / count
  };
}

function summarizePixels(data, width, height, step) {
  let r = 0;
  let g = 0;
  let b = 0;
  let luma = 0;
  let lumaSquared = 0;
  let count = 0;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const index = (y * width + x) * 4;
      const pixelR = data[index];
      const pixelG = data[index + 1];
      const pixelB = data[index + 2];
      const pixelLuma = pixelR * 0.2126 + pixelG * 0.7152 + pixelB * 0.0722;

      r += pixelR;
      g += pixelG;
      b += pixelB;
      luma += pixelLuma;
      lumaSquared += pixelLuma * pixelLuma;
      count++;
    }
  }

  r /= count;
  g /= count;
  b /= count;
  luma /= count;

  const lumaVariance = Math.max(0, lumaSquared / count - luma * luma);
  const maxChannel = Math.max(r, g, b);
  const minChannel = Math.min(r, g, b);

  return {
    r,
    g,
    b,
    luma,
    contrast: Math.sqrt(lumaVariance),
    saturation: (maxChannel - minChannel) / 255
  };
}

function getCanvasSignature(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const step = 16;
  const data = ctx.getImageData(0, 0, SOURCE_SIZE, SOURCE_SIZE).data;
  return summarizePixels(data, SOURCE_SIZE, SOURCE_SIZE, step);
}

function getPatchSignature(ctx, x, y, size) {
  const data = ctx.getImageData(x, y, size, size).data;
  const step = Math.max(4, Math.floor(size / 24));
  return summarizePixels(data, size, size, step);
}

function scorePatchSignature(patchSignature, targetSignature) {
  const red = (patchSignature.r - targetSignature.r) / 255;
  const green = (patchSignature.g - targetSignature.g) / 255;
  const blue = (patchSignature.b - targetSignature.b) / 255;
  const colorDistance = Math.sqrt(red * red + green * green + blue * blue) / Math.sqrt(3);
  const lumaDistance = Math.abs(patchSignature.luma - targetSignature.luma) / 255;
  const contrastDistance = Math.abs(patchSignature.contrast - targetSignature.contrast) / 128;
  const saturationDistance = Math.abs(patchSignature.saturation - targetSignature.saturation);

  return (
    colorDistance * 0.52 +
    lumaDistance * 0.22 +
    contrastDistance * 0.18 +
    saturationDistance * 0.08
  );
}

function findAutoAnchor(parentCanvas, childCanvas, settings) {
  const parentCtx = parentCanvas.getContext("2d", { willReadFrequently: true });
  const targetSignature = getCanvasSignature(childCanvas);
  const patchSize = Math.max(16, Math.round(SOURCE_SIZE * settings.patch));
  const minCenter = patchSize / 2;
  const maxCenter = SOURCE_SIZE - patchSize / 2;
  const gridSize = 11;
  let best = {
    anchorX: settings.anchorX,
    anchorY: settings.anchorY,
    score: Infinity
  };

  for (let gridY = 0; gridY < gridSize; gridY++) {
    const centerY = lerp(minCenter, maxCenter, gridY / (gridSize - 1));
    for (let gridX = 0; gridX < gridSize; gridX++) {
      const centerX = lerp(minCenter, maxCenter, gridX / (gridSize - 1));
      const x = clamp(Math.round(centerX - patchSize / 2), 0, SOURCE_SIZE - patchSize);
      const y = clamp(Math.round(centerY - patchSize / 2), 0, SOURCE_SIZE - patchSize);
      const patchSignature = getPatchSignature(parentCtx, x, y, patchSize);
      const score = scorePatchSignature(patchSignature, targetSignature);

      if (score < best.score) {
        best = {
          anchorX: (x + patchSize / 2) / SOURCE_SIZE,
          anchorY: (y + patchSize / 2) / SOURCE_SIZE,
          score
        };
      }
    }
  }

  return best;
}

function resolvePortalSettings(parentCanvas, childCanvas, settings) {
  if (!settings.autoAnchor) return settings;

  const anchor = findAutoAnchor(parentCanvas, childCanvas, settings);
  return {
    ...settings,
    anchorX: anchor.anchorX,
    anchorY: anchor.anchorY
  };
}

function getPortalSampleIndex(x, y, settings) {
  const symmetry = Math.max(1, Math.round(settings.symmetry));
  if (symmetry === 1) return (y * MICRO_SIZE + x) * 4;

  const center = (MICRO_SIZE - 1) / 2;
  const dx = x - center;
  const dy = y - center;
  const radius = Math.sqrt(dx * dx + dy * dy);
  const sector = TAU / symmetry;
  const alignment = settings.alignment * TAU;
  let angle = positiveModulo(Math.atan2(dy, dx) - alignment, TAU);
  let foldedAngle = positiveModulo(angle, sector);

  if (foldedAngle > sector / 2) {
    foldedAngle = sector - foldedAngle;
  }

  const sampleAngle = foldedAngle - sector / 4 + alignment;
  const sampleX = clamp(Math.round(center + Math.cos(sampleAngle) * radius), 0, MICRO_SIZE - 1);
  const sampleY = clamp(Math.round(center + Math.sin(sampleAngle) * radius), 0, MICRO_SIZE - 1);
  return (sampleY * MICRO_SIZE + sampleX) * 4;
}

function getPortalColor(x, y, childData, settings) {
  const spread = Math.max(1, Math.round(1 + settings.sampleBlend * 7));
  const samples = settings.sampleBlend > 0.04
    ? [
        [0, 0, 4],
        [spread, 0, 1],
        [-spread, 0, 1],
        [0, spread, 1],
        [0, -spread, 1]
      ]
    : [[0, 0, 1]];

  let r = 0;
  let g = 0;
  let b = 0;
  let weight = 0;

  for (const [offsetX, offsetY, sampleWeight] of samples) {
    const sampleX = clamp(x + offsetX, 0, MICRO_SIZE - 1);
    const sampleY = clamp(y + offsetY, 0, MICRO_SIZE - 1);
    const index = getPortalSampleIndex(sampleX, sampleY, settings);
    r += childData.data[index] * sampleWeight;
    g += childData.data[index + 1] * sampleWeight;
    b += childData.data[index + 2] * sampleWeight;
    weight += sampleWeight;
  }

  return {
    r: r / weight,
    g: g / weight,
    b: b / weight
  };
}

function buildMicroCanvas(parentCanvas, childCanvas, settings) {
  const sourceParent = makeCanvas(MICRO_SIZE, MICRO_SIZE);
  const sourceChild = makeCanvas(MICRO_SIZE, MICRO_SIZE);
  const output = makeCanvas(MICRO_SIZE, MICRO_SIZE);
  const parentCtx = sourceParent.getContext("2d", { alpha: false, willReadFrequently: true });
  const childCtx = sourceChild.getContext("2d", { alpha: false, willReadFrequently: true });
  const outputCtx = output.getContext("2d", { alpha: false });

  const patch = settings.patch * SOURCE_SIZE;
  const px = clamp(settings.anchorX * SOURCE_SIZE - patch / 2, 0, SOURCE_SIZE - patch);
  const py = clamp(settings.anchorY * SOURCE_SIZE - patch / 2, 0, SOURCE_SIZE - patch);

  parentCtx.imageSmoothingEnabled = false;
  parentCtx.drawImage(parentCanvas, px, py, patch, patch, 0, 0, MICRO_SIZE, MICRO_SIZE);
  childCtx.drawImage(childCanvas, 0, 0, MICRO_SIZE, MICRO_SIZE);

  const parentData = parentCtx.getImageData(0, 0, MICRO_SIZE, MICRO_SIZE);
  const childData = childCtx.getImageData(0, 0, MICRO_SIZE, MICRO_SIZE);
  const result = outputCtx.createImageData(MICRO_SIZE, MICRO_SIZE);
  const block = Math.max(1, Math.round(1 + settings.grain * 18));
  const bind = settings.bind;
  const baseColor = getParentPatchColor(parentCanvas, settings);

  for (let y = 0; y < MICRO_SIZE; y++) {
    const blockY = Math.floor(y / block) * block;
    for (let x = 0; x < MICRO_SIZE; x++) {
      const index = (y * MICRO_SIZE + x) * 4;
      const blockX = Math.floor(x / block) * block;
      const sampleIndex = (blockY * MICRO_SIZE + blockX) * 4;
      const childColor = getPortalColor(x, y, childData, settings);
      const cr = childColor.r;
      const cg = childColor.g;
      const cb = childColor.b;
      const localPr = parentData.data[index];
      const localPg = parentData.data[index + 1];
      const localPb = parentData.data[index + 2];
      const pr = lerp(localPr, parentData.data[sampleIndex], settings.grain);
      const pg = lerp(localPg, parentData.data[sampleIndex + 1], settings.grain);
      const pb = lerp(localPb, parentData.data[sampleIndex + 2], settings.grain);
      const luma = (cr * 0.2126 + cg * 0.7152 + cb * 0.0722) / 255;
      const tintBoost = 0.48 + luma * (0.88 + settings.sampleBlend * 0.22);
      const chroma = 0.18 * (1 - settings.bind) * (1 - settings.sampleBlend * 0.45);
      const neutral = luma * 255;
      const boundR = clamp(pr * tintBoost + baseColor.r * 0.08 + (cr - neutral) * chroma, 0, 255);
      const boundG = clamp(pg * tintBoost + baseColor.g * 0.08 + (cg - neutral) * chroma, 0, 255);
      const boundB = clamp(pb * tintBoost + baseColor.b * 0.08 + (cb - neutral) * chroma, 0, 255);
      const noise = ((x * 13 + y * 17) % 11) / 10 - 0.5;
      const dither = noise * settings.grain * (1 - settings.sampleBlend * 0.55) * 22;
      const edgeDistance = Math.min(x, y, MICRO_SIZE - 1 - x, MICRO_SIZE - 1 - y) / MICRO_SIZE;
      const edgeWidth = 0.012 + settings.sampleBlend * 0.16;
      const edgeBlend = smoothstep(0, edgeWidth, edgeDistance);

      result.data[index] = clamp(lerp(localPr, lerp(cr, boundR, bind) + dither, edgeBlend), 0, 255);
      result.data[index + 1] = clamp(lerp(localPg, lerp(cg, boundG, bind) + dither, edgeBlend), 0, 255);
      result.data[index + 2] = clamp(lerp(localPb, lerp(cb, boundB, bind) + dither, edgeBlend), 0, 255);
      result.data[index + 3] = 255;
    }
  }

  outputCtx.putImageData(result, 0, 0);
  return output;
}

function getTransition(from, to, settings) {
  const key = transitionKey(from.id, to.id, settings);
  if (!state.transitions.has(key)) {
    const portalSettings = resolvePortalSettings(from.canvas, to.canvas, settings);
    state.transitions.set(key, {
      canvas: buildMicroCanvas(from.canvas, to.canvas, portalSettings),
      settings: portalSettings
    });
  }
  return state.transitions.get(key);
}

function drawTransition(from, to, t, settings) {
  const ctx = previewCtx;
  const size = previewCanvas.width;
  const sourceSize = SOURCE_SIZE;
  const eased = easeInOutCubic(t);
  const transition = getTransition(from, to, settings);
  const portalSettings = transition.settings;
  const patchSize = sourceSize * portalSettings.patch;
  const patchX = clamp(sourceSize * portalSettings.anchorX - patchSize / 2, 0, sourceSize - patchSize);
  const patchY = clamp(sourceSize * portalSettings.anchorY - patchSize / 2, 0, sourceSize - patchSize);
  const patchCenterX = patchX + patchSize / 2;
  const patchCenterY = patchY + patchSize / 2;
  const viewSize = sourceSize * Math.pow(portalSettings.patch, eased);
  const viewCenterX = lerp(sourceSize / 2, patchCenterX, eased);
  const viewCenterY = lerp(sourceSize / 2, patchCenterY, eased);
  const viewX = viewCenterX - viewSize / 2;
  const viewY = viewCenterY - viewSize / 2;
  const scale = size / viewSize;
  const micro = transition.canvas;
  const reveal = smoothstep(0.58, 0.96, t);
  const glow = 1 - smoothstep(0.2, 0.72, t);

  ctx.save();
  ctx.fillStyle = "#050607";
  ctx.fillRect(0, 0, size, size);
  ctx.scale(scale, scale);
  ctx.translate(-viewX, -viewY);

  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(from.canvas, 0, 0, sourceSize, sourceSize);

  ctx.save();
  ctx.beginPath();
  ctx.rect(patchX, patchY, patchSize, patchSize);
  ctx.clip();
  ctx.drawImage(micro, patchX, patchY, patchSize, patchSize);
  if (reveal > 0) {
    ctx.globalAlpha = reveal;
    ctx.drawImage(to.canvas, patchX, patchY, patchSize, patchSize);
  }
  ctx.restore();

  if (glow > 0.01) {
    ctx.strokeStyle = `rgba(55, 192, 170, ${0.24 * glow})`;
    ctx.lineWidth = Math.max(1, viewSize / size * 2);
    ctx.strokeRect(patchX, patchY, patchSize, patchSize);
  }

  ctx.restore();
}

function drawLoopFrame(progress) {
  const settings = getSettings();
  setCanvasSize(settings.size);

  if (state.images.length === 0) {
    drawEmpty();
    return;
  }

  if (state.images.length === 1) {
    drawSingleImage();
    return;
  }

  const transitionCount = state.images.length;
  const loopProgress = ((progress % 1) + 1) % 1;
  const rawSegment = loopProgress * transitionCount;
  const segment = Math.min(transitionCount - 1, Math.floor(rawSegment));
  const localT = rawSegment - segment;
  const from = state.images[segment];
  const to = state.images[(segment + 1) % state.images.length];

  drawTransition(from, to, localT, settings);
}

function drawCurrentFrame() {
  drawLoopFrame(state.progress);
  const percent = Math.round(state.progress * 100);
  timeReadout.textContent = `${percent}%`;
}

function tick(timestamp) {
  if (!state.lastTime) state.lastTime = timestamp;
  const delta = timestamp - state.lastTime;
  state.lastTime = timestamp;

  if (state.isPlaying && !state.isRecording && state.images.length > 1) {
    const settings = getSettings();
    const loopMs = (getTransitionFrames(settings) * state.images.length / settings.fps) * 1000;
    state.progress = (state.progress + delta / loopMs) % 1;
    timelineInput.value = String(Math.round(state.progress * 1000));
    drawCurrentFrame();
  }

  requestAnimationFrame(tick);
}

async function createSampleSet() {
  clearImages();
  const names = ["street-light", "orchid-glass", "desert-door"];
  const colors = [
    ["#202326", "#37c0aa", "#e7bd4f", "#f06d4f"],
    ["#131617", "#8fd1c3", "#f6a66f", "#4c8f7d"],
    ["#171717", "#cc523f", "#d6b052", "#6bb49c"]
  ];

  for (let index = 0; index < names.length; index++) {
    const canvas = makeCanvas(SOURCE_SIZE, SOURCE_SIZE);
    const ctx = canvas.getContext("2d", { alpha: false });
    drawSampleImage(ctx, colors[index], index);
    state.images.push({
      id: crypto.randomUUID(),
      name: `${names[index]}.png`,
      width: SOURCE_SIZE,
      height: SOURCE_SIZE,
      url: canvas.toDataURL("image/png"),
      canvas
    });
  }

  invalidateTransitions();
  renderImageList();
  updateStatus();
  drawCurrentFrame();
}

function drawSampleImage(ctx, palette, index) {
  const gradient = ctx.createLinearGradient(0, 0, SOURCE_SIZE, SOURCE_SIZE);
  gradient.addColorStop(0, palette[0]);
  gradient.addColorStop(0.35, palette[1]);
  gradient.addColorStop(0.72, palette[2]);
  gradient.addColorStop(1, palette[3]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, SOURCE_SIZE, SOURCE_SIZE);

  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < 42; i++) {
    const radius = 18 + ((i * 29 + index * 17) % 120);
    const x = (i * 83 + index * 151) % SOURCE_SIZE;
    const y = (i * 137 + index * 71) % SOURCE_SIZE;
    ctx.fillStyle = `rgba(255, 255, 255, ${0.025 + (i % 4) * 0.012})`;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalCompositeOperation = "multiply";
  ctx.strokeStyle = "rgba(12, 13, 14, 0.42)";
  ctx.lineWidth = 18;
  for (let i = 0; i < 9; i++) {
    const y = 140 + i * 94 + index * 7;
    ctx.beginPath();
    ctx.moveTo(-50, y);
    ctx.bezierCurveTo(260, y - 160, 720, y + 160, SOURCE_SIZE + 60, y - 40);
    ctx.stroke();
  }

  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "rgba(245, 242, 236, 0.78)";
  ctx.font = "900 160px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(index + 1), SOURCE_SIZE / 2, SOURCE_SIZE / 2);
}

function downloadCanvasPng() {
  const link = document.createElement("a");
  link.href = previewCanvas.toDataURL("image/png");
  link.download = "zoom-loop-frame.png";
  link.click();
}

async function recordWebm() {
  if (state.images.length < 2 || state.isRecording) return;
  if (!previewCanvas.captureStream || !window.MediaRecorder) {
    statusText.textContent = "Recording is not supported";
    return;
  }

  state.isRecording = true;
  state.isPlaying = false;
  updateStatus();
  webmButton.textContent = "Recording";

  const settings = getSettings();
  const chunks = [];
  const stream = previewCanvas.captureStream(settings.fps);
  const mimeType = getRecorderMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  const finished = new Promise((resolve) => {
    recorder.onstop = resolve;
  });

  recorder.start();
  const totalFrames = getTransitionFrames(settings) * state.images.length;

  for (let frame = 0; frame < totalFrames; frame++) {
    state.progress = frame / totalFrames;
    timelineInput.value = String(Math.round(state.progress * 1000));
    drawCurrentFrame();
    await new Promise((resolve) => setTimeout(resolve, 1000 / settings.fps));
  }

  recorder.stop();
  await finished;
  stream.getTracks().forEach((track) => track.stop());

  const blob = new Blob(chunks, { type: recorder.mimeType || "video/webm" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "zoom-loop.webm";
  link.click();
  URL.revokeObjectURL(url);

  state.isRecording = false;
  webmButton.textContent = "WebM";
  updateStatus();
}

function getRecorderMimeType() {
  const options = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm"
  ];
  return options.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

fileInput.addEventListener("change", (event) => {
  loadFiles(event.target.files);
  fileInput.value = "";
});

dropZone.addEventListener("dragenter", (event) => {
  event.preventDefault();
  state.dragDepth++;
  dropZone.classList.add("is-over");
});

dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
});

dropZone.addEventListener("dragleave", () => {
  state.dragDepth = Math.max(0, state.dragDepth - 1);
  if (state.dragDepth === 0) dropZone.classList.remove("is-over");
});

dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  state.dragDepth = 0;
  dropZone.classList.remove("is-over");
  loadFiles(event.dataTransfer.files);
});

playButton.addEventListener("click", () => {
  togglePlayback();
});
stagePlayButton.addEventListener("click", togglePlayback);

pngButton.addEventListener("click", downloadCanvasPng);
webmButton.addEventListener("click", recordWebm);
sampleButton.addEventListener("click", createSampleSet);
clearButton.addEventListener("click", clearImages);

timelineInput.addEventListener("input", () => {
  state.progress = Number(timelineInput.value) / 1000;
  drawCurrentFrame();
});

controls.forEach((control) => {
  control.addEventListener("input", () => {
    syncAnchorMode();
    if (control === sizeInput) setCanvasSize(Number(sizeInput.value));
    if (
      control !== sizeInput &&
      control !== framesInput &&
      control !== fpsInput &&
      control !== zoomRateInput
    ) {
      invalidateTransitions();
    }
    drawCurrentFrame();
  });
});

setCanvasSize(Number(sizeInput.value));
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get("auto") === "1") {
  autoAnchorInput.checked = true;
}
syncAnchorMode();
updateStatus();
drawCurrentFrame();
if (urlParams.get("sample") === "1") {
  createSampleSet();
}
requestAnimationFrame(tick);
