"use strict";

const previewCanvas = document.querySelector("#previewCanvas");
const previewCtx = previewCanvas.getContext("2d", { alpha: false });
const canvasWrap = document.querySelector(".canvas-wrap");

const fileInput = document.querySelector("#fileInput");
const dropZone = document.querySelector("#dropZone");
const imageList = document.querySelector("#imageList");
const statusText = document.querySelector("#statusText");
const uploadHelp = document.querySelector("#uploadHelp");
const installButton = document.querySelector("#installButton");
const playButton = document.querySelector("#playButton");
const stagePlayButton = document.querySelector("#stagePlayButton");
const shareButton = document.querySelector("#shareButton");
const pngButton = document.querySelector("#pngButton");
const webmButton = document.querySelector("#webmButton");
const sampleButton = document.querySelector("#sampleButton");
const autoSortButton = document.querySelector("#autoSortButton");
const clearButton = document.querySelector("#clearButton");
const timelineInput = document.querySelector("#timelineInput");
const timeReadout = document.querySelector("#timeReadout");
const autoTuneButton = document.querySelector("#autoTuneButton");
const smoothDefaultsButton = document.querySelector("#smoothDefaultsButton");
const portalPickButton = document.querySelector("#portalPickButton");
const portalClearButton = document.querySelector("#portalClearButton");
const portalHelp = document.querySelector("#portalHelp");

const sizeInput = document.querySelector("#sizeInput");
const framesInput = document.querySelector("#framesInput");
const fpsInput = document.querySelector("#fpsInput");
const zoomRateInput = document.querySelector("#zoomRateInput");
const smoothGuardInput = document.querySelector("#smoothGuardInput");
const patchInput = document.querySelector("#patchInput");
const autoAnchorInput = document.querySelector("#autoAnchorInput");
const anchorXInput = document.querySelector("#anchorXInput");
const anchorYInput = document.querySelector("#anchorYInput");
const bindInput = document.querySelector("#bindInput");
const sampleBlendInput = document.querySelector("#sampleBlendInput");
const edgeBlendInput = document.querySelector("#edgeBlendInput");
const shapeMorphInput = document.querySelector("#shapeMorphInput");
const grainInput = document.querySelector("#grainInput");
const symmetryInput = document.querySelector("#symmetryInput");
const alignmentInput = document.querySelector("#alignmentInput");

const SOURCE_SIZE = 1024;
const MICRO_SIZE = 640;
const TAU = Math.PI * 2;
const HEIC_CONVERTER_URL = "https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js";
const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "bmp",
  "avif",
  "heic",
  "heif",
  "tif",
  "tiff"
]);
const HEIC_EXTENSIONS = new Set(["heic", "heif"]);

const state = {
  images: [],
  transitions: new Map(),
  portalOverrides: new Map(),
  progress: 0,
  isPlaying: false,
  isRecording: false,
  isLoading: false,
  isPickingPortal: false,
  lastTime: 0,
  dragDepth: 0
};

const featherMaskCache = new Map();
let deferredInstallPrompt = null;
let heicConverterPromise = null;

const controls = [
  sizeInput,
  framesInput,
  fpsInput,
  zoomRateInput,
  smoothGuardInput,
  patchInput,
  autoAnchorInput,
  anchorXInput,
  anchorYInput,
  bindInput,
  sampleBlendInput,
  edgeBlendInput,
  shapeMorphInput,
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
  const sourceW = image.naturalWidth || image.videoWidth || image.width;
  const sourceH = image.naturalHeight || image.videoHeight || image.height;
  if (!sourceW || !sourceH) {
    throw new Error("Image has no readable dimensions");
  }
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
    smoothGuard: smoothGuardInput.checked,
    patch: Number(patchInput.value) / 100,
    autoAnchor: autoAnchorInput.checked,
    anchorX: Number(anchorXInput.value) / 100,
    anchorY: Number(anchorYInput.value) / 100,
    bind: Number(bindInput.value) / 100,
    sampleBlend: Number(sampleBlendInput.value) / 100,
    edgeBlend: Number(edgeBlendInput.value) / 100,
    shapeMorph: Number(shapeMorphInput.value) / 100,
    grain: Number(grainInput.value) / 100,
    symmetry: Number(symmetryInput.value),
    alignment: Number(alignmentInput.value) / 360
  };
}

function getTransitionFrames(settings) {
  return Math.max(8, Math.round(settings.frames / Math.max(0.25, settings.zoomRate)));
}

function transitionKey(fromId, toId, settings, override) {
  const anchorX = override ? override.anchorX : settings.anchorX;
  const anchorY = override ? override.anchorY : settings.anchorY;
  const placementMode = override ? "picked" : settings.autoAnchor ? "auto" : "manual";

  return [
    fromId,
    toId,
    settings.smoothGuard ? "guard" : "raw",
    settings.patch.toFixed(3),
    placementMode,
    anchorX.toFixed(3),
    anchorY.toFixed(3),
    settings.bind.toFixed(3),
    settings.sampleBlend.toFixed(3),
    settings.edgeBlend.toFixed(3),
    settings.shapeMorph.toFixed(3),
    settings.grain.toFixed(3),
    settings.symmetry,
    settings.alignment.toFixed(3)
  ].join(":");
}

function invalidateTransitions() {
  state.transitions.clear();
}

function getPairKey(fromId, toId) {
  return `${fromId}->${toId}`;
}

function getPortalOverride(fromId, toId) {
  return state.portalOverrides.get(getPairKey(fromId, toId));
}

function setPortalOverride(fromId, toId, anchorX, anchorY) {
  state.portalOverrides.set(getPairKey(fromId, toId), {
    anchorX: clamp(anchorX, 0.08, 0.92),
    anchorY: clamp(anchorY, 0.08, 0.92)
  });
  invalidateTransitions();
}

function clearPortalOverride(fromId, toId) {
  state.portalOverrides.delete(getPairKey(fromId, toId));
  invalidateTransitions();
}

function purgePortalOverrides() {
  const ids = new Set(state.images.map((image) => image.id));
  for (const key of state.portalOverrides.keys()) {
    const [fromId, toId] = key.split("->");
    if (!ids.has(fromId) || !ids.has(toId)) {
      state.portalOverrides.delete(key);
    }
  }
}

function setPortalHelp(message, tone = "") {
  if (!portalHelp) return;
  portalHelp.textContent = message;
  portalHelp.classList.toggle("is-error", tone === "error");
  portalHelp.classList.toggle("is-ok", tone === "ok");
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || window.location.protocol === "file:") {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      statusText.textContent = "Offline install unavailable";
    });
  });
}

function setupInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    installButton.classList.remove("is-hidden");
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    installButton.classList.add("is-hidden");
  });
}

async function promptInstall() {
  if (!deferredInstallPrompt) return;

  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  installButton.classList.add("is-hidden");
}

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `image-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function plural(count, singular, pluralForm = `${singular}s`) {
  return count === 1 ? singular : pluralForm;
}

function getFileExtension(file) {
  const name = file.name || "";
  const dotIndex = name.lastIndexOf(".");
  return dotIndex === -1 ? "" : name.slice(dotIndex + 1).toLowerCase();
}

function getReadableFileName(file) {
  return file.name || "phone photo";
}

function isLikelyImageFile(file) {
  const type = (file.type || "").toLowerCase();
  return type.startsWith("image/") || SUPPORTED_IMAGE_EXTENSIONS.has(getFileExtension(file));
}

function isHeicFile(file) {
  const type = (file.type || "").toLowerCase();
  return type.includes("heic") || type.includes("heif") || HEIC_EXTENSIONS.has(getFileExtension(file));
}

function setUploadHelp(message, tone = "") {
  if (!uploadHelp) return;
  uploadHelp.textContent = message;
  uploadHelp.classList.toggle("is-error", tone === "error");
  uploadHelp.classList.toggle("is-ok", tone === "ok");
}

function setUploadBusy(isBusy) {
  state.isLoading = isBusy;
  fileInput.disabled = isBusy;
  dropZone.classList.toggle("is-loading", isBusy);
}

function createThumbnailUrl(canvas) {
  const thumb = makeCanvas(160, 160);
  const ctx = thumb.getContext("2d", { alpha: false });
  ctx.drawImage(canvas, 0, 0, thumb.width, thumb.height);
  return thumb.toDataURL("image/jpeg", 0.78);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existingScript = document.querySelector(`script[src="${src}"]`);
    if (existingScript) {
      if (existingScript.dataset.ready === "true") {
        resolve();
        return;
      }
      existingScript.addEventListener("load", resolve, { once: true });
      existingScript.addEventListener("error", reject, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.addEventListener("load", () => {
      script.dataset.ready = "true";
      resolve();
    }, { once: true });
    script.addEventListener("error", () => {
      reject(new Error("HEIC converter could not be loaded"));
    }, { once: true });
    document.head.append(script);
  });
}

async function getHeicConverter() {
  if (window.heic2any) return window.heic2any;

  if (!heicConverterPromise) {
    heicConverterPromise = loadScript(HEIC_CONVERTER_URL);
  }

  await heicConverterPromise;
  if (!window.heic2any) {
    throw new Error("HEIC converter is unavailable");
  }
  return window.heic2any;
}

function makeConvertedFile(blob, originalFile) {
  const safeName = (originalFile.name || "photo.heic").replace(/\.[^.]+$/, "") || "photo";
  const fileName = `${safeName}.jpg`;

  try {
    return new File([blob], fileName, { type: "image/jpeg" });
  } catch {
    blob.name = fileName;
    return blob;
  }
}

async function convertHeicFile(file) {
  const heic2any = await getHeicConverter();
  const result = await heic2any({
    blob: file,
    toType: "image/jpeg",
    quality: 0.92
  });
  const convertedBlob = Array.isArray(result) ? result[0] : result;
  return makeConvertedFile(convertedBlob, file);
}

async function decodeWithImageBitmap(file) {
  let bitmap = null;

  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    bitmap = await createImageBitmap(file);
  }

  try {
    return {
      canvas: normalizeImage(bitmap),
      width: bitmap.width,
      height: bitmap.height
    };
  } finally {
    if (bitmap?.close) bitmap.close();
  }
}

async function decodeWithImageElement(file) {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";

  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("Browser could not read this image"));
      image.src = url;
    });

    return {
      canvas: normalizeImage(image),
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function decodeNatively(file) {
  let bitmapError = null;

  if ("createImageBitmap" in window) {
    try {
      return await decodeWithImageBitmap(file);
    } catch (error) {
      bitmapError = error;
    }
  }

  try {
    return await decodeWithImageElement(file);
  } catch (imageError) {
    throw bitmapError || imageError;
  }
}

async function decodePhotoFile(file) {
  try {
    return {
      ...(await decodeNatively(file)),
      converted: false
    };
  } catch (nativeError) {
    if (!isHeicFile(file)) throw nativeError;

    const convertedFile = await convertHeicFile(file);
    return {
      ...(await decodeNatively(convertedFile)),
      converted: true
    };
  }
}

async function loadFiles(files) {
  if (state.isLoading) return;

  const selectedFiles = [...files];
  const imageFiles = selectedFiles.filter(isLikelyImageFile);
  const skippedCount = selectedFiles.length - imageFiles.length;

  if (!selectedFiles.length) return;

  if (!imageFiles.length) {
    statusText.textContent = "No images loaded";
    setUploadHelp("Try JPG, PNG, WebP, GIF, BMP, AVIF, HEIC, or HEIF.", "error");
    return;
  }

  const failed = [];
  let loadedCount = 0;
  let convertedCount = 0;

  setUploadBusy(true);
  setUploadHelp("Preparing images");

  try {
    for (const [index, file] of imageFiles.entries()) {
      statusText.textContent = `Loading ${index + 1} of ${imageFiles.length}`;

      try {
        const decoded = await decodePhotoFile(file);
        state.images.push({
          id: createId(),
          name: getReadableFileName(file),
          width: decoded.width,
          height: decoded.height,
          url: createThumbnailUrl(decoded.canvas),
          canvas: decoded.canvas
        });
        loadedCount++;
        if (decoded.converted) convertedCount++;
      } catch (error) {
        failed.push({ file, error });
      }
    }
  } finally {
    setUploadBusy(false);
  }

  if (loadedCount > 0) {
    invalidateTransitions();
    renderImageList();
    drawCurrentFrame();
  }

  updateStatus();

  if (!loadedCount) {
    statusText.textContent = "No images loaded";
  }

  const messages = [];
  if (loadedCount > 0) {
    messages.push(`Loaded ${loadedCount} ${plural(loadedCount, "image")}`);
  }
  if (convertedCount > 0) {
    messages.push(`converted ${convertedCount} HEIC/HEIF ${plural(convertedCount, "photo", "photos")}`);
  }
  if (skippedCount > 0) {
    messages.push(`skipped ${skippedCount} unsupported ${plural(skippedCount, "file")}`);
  }
  if (failed.length > 0) {
    const failedNames = failed
      .slice(0, 2)
      .map(({ file }) => getReadableFileName(file))
      .join(", ");
    const hasHeicFailure = failed.some(({ file }) => isHeicFile(file));
    const extra = hasHeicFailure
      ? "HEIC conversion needs internet the first time; JPEG or PNG will work too."
      : "Try saving the photo as JPEG or PNG if your browser cannot read it.";
    messages.push(`could not open ${failedNames}${failed.length > 2 ? " and more" : ""}. ${extra}`);
  }

  setUploadHelp(
    messages.length ? `${messages.join(". ")}.` : "",
    failed.length > 0 && loadedCount === 0 ? "error" : "ok"
  );
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
  purgePortalOverrides();
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
  state.portalOverrides.clear();
  state.isPickingPortal = false;
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
  shareButton.disabled = state.isRecording;
  pngButton.disabled = state.isRecording;
  webmButton.disabled = count < 2 || state.isRecording;
  autoSortButton.disabled = count < 3 || state.isRecording || state.isLoading;
  autoTuneButton.disabled = state.isRecording || state.isLoading;
  portalPickButton.disabled = count < 2 || state.isRecording || state.isLoading;
  portalClearButton.disabled = count < 2 || state.isRecording || state.isLoading;
  syncPortalPickingUi();
  syncPlaybackUi();
}

function syncPortalPickingUi() {
  const canPick = state.images.length >= 2 && !state.isRecording && !state.isLoading;
  if (!canPick) state.isPickingPortal = false;
  portalPickButton.classList.toggle("is-active", state.isPickingPortal);
  portalPickButton.textContent = state.isPickingPortal ? "Click Preview" : "Pick Portal";
  canvasWrap.classList.toggle("is-picking", state.isPickingPortal);
}

function syncPlaybackUi() {
  const label = state.isPlaying ? "Pause" : "Play";
  playButton.textContent = label;
  stagePlayButton.classList.toggle("is-playing", state.isPlaying);
  stagePlayButton.setAttribute("aria-label", `${label} loop`);
}

function togglePlayback() {
  if (state.images.length < 2 || state.isRecording) return;
  state.isPickingPortal = false;
  state.isPlaying = !state.isPlaying;
  state.lastTime = 0;
  syncPortalPickingUi();
  syncPlaybackUi();
}

function syncAnchorMode() {
  const isAuto = autoAnchorInput.checked;
  anchorXInput.disabled = isAuto;
  anchorYInput.disabled = isAuto;
}

function applySmoothDefaults() {
  framesInput.value = "120";
  fpsInput.value = "30";
  zoomRateInput.value = "82";
  smoothGuardInput.checked = true;
  patchInput.value = "16";
  autoAnchorInput.checked = true;
  anchorXInput.value = "50";
  anchorYInput.value = "50";
  bindInput.value = "78";
  sampleBlendInput.value = "68";
  edgeBlendInput.value = "76";
  shapeMorphInput.value = "72";
  grainInput.value = "16";
  symmetryInput.value = "1";
  alignmentInput.value = "0";

  state.isPickingPortal = false;
  invalidateTransitions();
  syncAnchorMode();
  updateStatus();
  setPortalHelp("Smooth defaults loaded. Use Pick Portal for stubborn transitions.", "ok");
  drawCurrentFrame();
}

function autoTuneLoop() {
  if (state.isRecording || state.isLoading) return;

  state.portalOverrides.clear();
  applySmoothDefaults();

  if (state.images.length >= 3) {
    state.images = sortImagesBySimilarity(state.images);
    state.progress = 0;
    timelineInput.value = "0";
    renderImageList();
  }

  invalidateTransitions();
  updateStatus();
  setUploadHelp(
    state.images.length >= 3
      ? `Auto tuned and sorted ${state.images.length} images.`
      : "Auto tuned smooth transition settings.",
    "ok"
  );
  setPortalHelp("Auto Tune applied: smooth defaults, safer auto placement, and no old picked portals.", "ok");
  drawCurrentFrame();
}

function currentTransitionLabel(current) {
  return `${current.segment + 1} -> ${(current.segment + 1) % state.images.length + 1}`;
}

function setProgressToSegmentStart(segment) {
  const transitionCount = state.images.length;
  if (transitionCount < 2) return;
  state.progress = segment / transitionCount;
  timelineInput.value = String(Math.round(state.progress * 1000));
}

function togglePortalPickMode() {
  if (state.images.length < 2 || state.isRecording || state.isLoading) return;

  const current = getCurrentLoopSegment();
  if (!current) return;

  state.isPlaying = false;
  state.isPickingPortal = !state.isPickingPortal;

  if (state.isPickingPortal) {
    setProgressToSegmentStart(current.segment);
    setPortalHelp(`Click the preview to set the portal for transition ${currentTransitionLabel(current)}.`);
  } else {
    setPortalHelp("");
  }

  syncPortalPickingUi();
  syncPlaybackUi();
  drawCurrentFrame();
}

function clearCurrentPortalPick() {
  const current = getCurrentLoopSegment();
  if (!current) return;

  clearPortalOverride(current.from.id, current.to.id);
  setPortalHelp(`Cleared picked portal for transition ${currentTransitionLabel(current)}.`, "ok");
  drawCurrentFrame();
}

function handlePortalCanvasClick(event) {
  if (!state.isPickingPortal || state.images.length < 2) return;

  const current = getCurrentLoopSegment();
  if (!current) return;

  const settings = getSettings();
  const transition = getTransition(current.from, current.to, settings);
  const geometry = getTransitionGeometry(current.localT, transition.settings, previewCanvas.width);
  const rect = previewCanvas.getBoundingClientRect();
  const canvasX = (event.clientX - rect.left) * (previewCanvas.width / rect.width);
  const canvasY = (event.clientY - rect.top) * (previewCanvas.height / rect.height);
  const sourceX = clamp(geometry.viewX + canvasX / geometry.scale, 0, SOURCE_SIZE);
  const sourceY = clamp(geometry.viewY + canvasY / geometry.scale, 0, SOURCE_SIZE);

  setPortalOverride(current.from.id, current.to.id, sourceX / SOURCE_SIZE, sourceY / SOURCE_SIZE);
  state.isPickingPortal = false;
  setPortalHelp(`Portal set for transition ${currentTransitionLabel(current)}.`, "ok");
  syncPortalPickingUi();
  drawCurrentFrame();
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

function getImageSignature(image) {
  if (!image.signature) {
    image.signature = getCanvasSignature(image.canvas);
  }
  return image.signature;
}

function scoreImagePair(firstImage, secondImage) {
  return scorePatchSignature(getImageSignature(firstImage), getImageSignature(secondImage));
}

function sortImagesBySimilarity(images) {
  if (images.length < 3) return [...images];

  const remaining = [...images];
  let bestPair = [0, 1];
  let bestScore = Infinity;

  for (let i = 0; i < remaining.length; i++) {
    for (let j = i + 1; j < remaining.length; j++) {
      const score = scoreImagePair(remaining[i], remaining[j]);
      if (score < bestScore) {
        bestScore = score;
        bestPair = [i, j];
      }
    }
  }

  const order = [remaining[bestPair[0]], remaining[bestPair[1]]];
  remaining.splice(bestPair[1], 1);
  remaining.splice(bestPair[0], 1);

  while (remaining.length) {
    let bestImageIndex = 0;
    let bestInsertAfter = 0;
    let bestCost = Infinity;

    for (let imageIndex = 0; imageIndex < remaining.length; imageIndex++) {
      const image = remaining[imageIndex];
      for (let orderIndex = 0; orderIndex < order.length; orderIndex++) {
        const previous = order[orderIndex];
        const next = order[(orderIndex + 1) % order.length];
        const cost =
          scoreImagePair(previous, image) +
          scoreImagePair(image, next) -
          scoreImagePair(previous, next);

        if (cost < bestCost) {
          bestCost = cost;
          bestImageIndex = imageIndex;
          bestInsertAfter = orderIndex;
        }
      }
    }

    const [image] = remaining.splice(bestImageIndex, 1);
    order.splice(bestInsertAfter + 1, 0, image);
  }

  return order;
}

function autoSortImages() {
  if (state.images.length < 3 || state.isRecording || state.isLoading) return;
  state.isPickingPortal = false;
  state.images = sortImagesBySimilarity(state.images);
  state.progress = 0;
  timelineInput.value = "0";
  invalidateTransitions();
  renderImageList();
  updateStatus();
  setUploadHelp(`Auto sorted ${state.images.length} images by visual similarity.`, "ok");
  setPortalHelp("Transitions now follow the closest color and contrast matches.", "ok");
  drawCurrentFrame();
}

function getPatchSignature(ctx, x, y, size) {
  const data = ctx.getImageData(x, y, size, size).data;
  const step = Math.max(4, Math.floor(size / 24));
  return summarizePixels(data, size, size, step);
}

function getSurroundingSignature(ctx, x, y, size) {
  const ring = Math.max(12, Math.round(size * 0.34));
  const outerX = clamp(x - ring, 0, SOURCE_SIZE - 1);
  const outerY = clamp(y - ring, 0, SOURCE_SIZE - 1);
  const outerMaxX = clamp(x + size + ring, 1, SOURCE_SIZE);
  const outerMaxY = clamp(y + size + ring, 1, SOURCE_SIZE);
  const outerW = Math.max(1, outerMaxX - outerX);
  const outerH = Math.max(1, outerMaxY - outerY);
  const data = ctx.getImageData(outerX, outerY, outerW, outerH).data;
  const step = Math.max(4, Math.floor(Math.max(outerW, outerH) / 28));
  return summarizePixels(data, outerW, outerH, step);
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

function getAutoAnchorPenalty(anchorX, anchorY, patchRatio) {
  const edgeDistance = Math.min(anchorX, anchorY, 1 - anchorX, 1 - anchorY);
  const softSafeEdge = Math.max(0.18, patchRatio * 0.82);
  const hardSafeEdge = Math.max(0.1, patchRatio * 0.55);
  const edgePenalty = 1 - smoothstep(hardSafeEdge, softSafeEdge, edgeDistance);
  const dx = anchorX - 0.5;
  const dy = anchorY - 0.5;
  const centerDistance = Math.sqrt(dx * dx + dy * dy) / Math.SQRT1_2;
  const driftPenalty = smoothstep(0.38, 0.72, centerDistance);

  return edgePenalty * 0.74 + driftPenalty * 0.26;
}

function scoreAutoAnchorCandidate(parentCtx, x, y, patchSize, targetSignature, settings) {
  const patchSignature = getPatchSignature(parentCtx, x, y, patchSize);
  const surroundingSignature = getSurroundingSignature(parentCtx, x, y, patchSize);
  const anchorX = (x + patchSize / 2) / SOURCE_SIZE;
  const anchorY = (y + patchSize / 2) / SOURCE_SIZE;
  const patchRatio = patchSize / SOURCE_SIZE;
  const directMatch = scorePatchSignature(patchSignature, targetSignature);
  const surroundingMatch = scorePatchSignature(surroundingSignature, targetSignature);
  const localBlend = scorePatchSignature(patchSignature, surroundingSignature);
  const framingPenalty = getAutoAnchorPenalty(anchorX, anchorY, patchRatio);
  const contrastFloor = targetSignature.contrast * 0.38;
  const flatPenalty = patchSignature.contrast < contrastFloor
    ? (contrastFloor - patchSignature.contrast) / Math.max(12, contrastFloor)
    : 0;

  return (
    directMatch * 0.48 +
    surroundingMatch * 0.24 +
    localBlend * 0.1 +
    framingPenalty * 0.26 +
    flatPenalty * 0.1
  );
}

function findAutoAnchor(parentCanvas, childCanvas, settings) {
  const parentCtx = parentCanvas.getContext("2d", { willReadFrequently: true });
  const targetSignature = getCanvasSignature(childCanvas);
  const patchSize = Math.max(16, Math.round(SOURCE_SIZE * settings.patch));
  const patchRatio = patchSize / SOURCE_SIZE;
  const safeMargin = Math.max(0.2, patchRatio * 0.88);
  const minCenter = Math.max(patchSize / 2, SOURCE_SIZE * safeMargin);
  const maxCenter = Math.min(SOURCE_SIZE - patchSize / 2, SOURCE_SIZE * (1 - safeMargin));
  const scanMinCenter = minCenter < maxCenter ? minCenter : patchSize / 2;
  const scanMaxCenter = minCenter < maxCenter ? maxCenter : SOURCE_SIZE - patchSize / 2;
  const gridSize = 13;
  let best = {
    anchorX: settings.anchorX,
    anchorY: settings.anchorY,
    score: Infinity
  };

  for (let gridY = 0; gridY < gridSize; gridY++) {
    const centerY = lerp(scanMinCenter, scanMaxCenter, gridY / (gridSize - 1));
    for (let gridX = 0; gridX < gridSize; gridX++) {
      const centerX = lerp(scanMinCenter, scanMaxCenter, gridX / (gridSize - 1));
      const x = clamp(Math.round(centerX - patchSize / 2), 0, SOURCE_SIZE - patchSize);
      const y = clamp(Math.round(centerY - patchSize / 2), 0, SOURCE_SIZE - patchSize);
      const score = scoreAutoAnchorCandidate(parentCtx, x, y, patchSize, targetSignature, settings);

      if (score < best.score) {
        best = {
          anchorX: (x + patchSize / 2) / SOURCE_SIZE,
          anchorY: (y + patchSize / 2) / SOURCE_SIZE,
          score
        };
      }
    }
  }

  const refineStep = Math.max(4, Math.round(patchSize * 0.22));
  for (let pass = 0; pass < 2; pass++) {
    const step = Math.max(2, Math.round(refineStep / (pass + 1)));
    const baseX = best.anchorX * SOURCE_SIZE;
    const baseY = best.anchorY * SOURCE_SIZE;

    for (let offsetY = -1; offsetY <= 1; offsetY++) {
      for (let offsetX = -1; offsetX <= 1; offsetX++) {
        const centerX = clamp(baseX + offsetX * step, patchSize / 2, SOURCE_SIZE - patchSize / 2);
        const centerY = clamp(baseY + offsetY * step, patchSize / 2, SOURCE_SIZE - patchSize / 2);
        const x = clamp(Math.round(centerX - patchSize / 2), 0, SOURCE_SIZE - patchSize);
        const y = clamp(Math.round(centerY - patchSize / 2), 0, SOURCE_SIZE - patchSize);
        const score = scoreAutoAnchorCandidate(parentCtx, x, y, patchSize, targetSignature, settings);

        if (score < best.score) {
          best = {
            anchorX: (x + patchSize / 2) / SOURCE_SIZE,
            anchorY: (y + patchSize / 2) / SOURCE_SIZE,
            score
          };
        }
      }
    }
  }

  return best;
}

function resolvePortalSettings(parentCanvas, childCanvas, settings, override) {
  if (override) {
    return {
      ...settings,
      autoAnchor: false,
      anchorX: override.anchorX,
      anchorY: override.anchorY
    };
  }

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
    const directIndex = (sampleY * MICRO_SIZE + sampleX) * 4;
    const foldedIndex = getPortalSampleIndex(sampleX, sampleY, settings);
    const symmetryStrength = settings.smoothGuard
      ? clamp(0.42 + (settings.symmetry - 1) / 7 * 0.38, 0, 0.8)
      : 1;

    r += lerp(childData.data[directIndex], childData.data[foldedIndex], symmetryStrength) * sampleWeight;
    g += lerp(childData.data[directIndex + 1], childData.data[foldedIndex + 1], symmetryStrength) * sampleWeight;
    b += lerp(childData.data[directIndex + 2], childData.data[foldedIndex + 2], symmetryStrength) * sampleWeight;
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

  const distortionLoad = clamp(
    settings.grain * 0.45 +
      settings.sampleBlend * 0.22 +
      settings.edgeBlend * 0.16 +
      ((settings.symmetry - 1) / 7) * 0.17,
    0,
    1
  );
  const grainStrength = settings.smoothGuard
    ? settings.grain * lerp(1, 0.42, distortionLoad)
    : settings.grain;
  const bind = settings.smoothGuard
    ? clamp(settings.bind + distortionLoad * 0.08, 0, 0.92)
    : settings.bind;

  parentCtx.imageSmoothingEnabled = settings.smoothGuard;
  parentCtx.imageSmoothingQuality = "high";
  parentCtx.drawImage(parentCanvas, px, py, patch, patch, 0, 0, MICRO_SIZE, MICRO_SIZE);
  childCtx.imageSmoothingEnabled = true;
  childCtx.imageSmoothingQuality = "high";
  childCtx.drawImage(childCanvas, 0, 0, MICRO_SIZE, MICRO_SIZE);

  const parentData = parentCtx.getImageData(0, 0, MICRO_SIZE, MICRO_SIZE);
  const childData = childCtx.getImageData(0, 0, MICRO_SIZE, MICRO_SIZE);
  const result = outputCtx.createImageData(MICRO_SIZE, MICRO_SIZE);
  const block = Math.max(1, Math.round(1 + grainStrength * 18));
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
      const pr = lerp(localPr, parentData.data[sampleIndex], grainStrength);
      const pg = lerp(localPg, parentData.data[sampleIndex + 1], grainStrength);
      const pb = lerp(localPb, parentData.data[sampleIndex + 2], grainStrength);
      const luma = (cr * 0.2126 + cg * 0.7152 + cb * 0.0722) / 255;
      const tintBoost = 0.48 + luma * (0.88 + settings.sampleBlend * 0.22);
      const chroma = 0.18 * (1 - settings.bind) * (1 - settings.sampleBlend * 0.45);
      const neutral = luma * 255;
      const boundR = clamp(pr * tintBoost + baseColor.r * 0.08 + (cr - neutral) * chroma, 0, 255);
      const boundG = clamp(pg * tintBoost + baseColor.g * 0.08 + (cg - neutral) * chroma, 0, 255);
      const boundB = clamp(pb * tintBoost + baseColor.b * 0.08 + (cb - neutral) * chroma, 0, 255);
      const noise = ((x * 13 + y * 17) % 11) / 10 - 0.5;
      const dither = noise * grainStrength * (1 - settings.sampleBlend * 0.55) * 22;
      const edgeDistance = Math.min(x, y, MICRO_SIZE - 1 - x, MICRO_SIZE - 1 - y) / MICRO_SIZE;
      const edgeWidth = 0.012 + settings.sampleBlend * 0.12 + settings.edgeBlend * 0.18;
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

function getFeatherMask(layerSize, featherSize, roundness) {
  const safeLayerSize = Math.max(1, Math.round(layerSize));
  const safeFeatherSize = Math.max(1, Math.round(featherSize));
  const safeRoundness = Math.round(clamp(roundness, 0, 1) * 20) / 20;
  const key = `${safeLayerSize}:${safeFeatherSize}:${safeRoundness}`;

  if (featherMaskCache.has(key)) {
    return featherMaskCache.get(key);
  }

  if (featherMaskCache.size > 80) {
    featherMaskCache.clear();
  }

  const mask = makeCanvas(safeLayerSize, safeLayerSize);
  const maskCtx = mask.getContext("2d");
  const imageData = maskCtx.createImageData(safeLayerSize, safeLayerSize);
  const center = (safeLayerSize - 1) / 2;
  const radius = safeLayerSize / 2;

  for (let y = 0; y < safeLayerSize; y++) {
    for (let x = 0; x < safeLayerSize; x++) {
      const index = (y * safeLayerSize + x) * 4;
      const rectDistance = Math.min(x, y, safeLayerSize - 1 - x, safeLayerSize - 1 - y);
      const dx = x - center;
      const dy = y - center;
      const circleDistance = radius - Math.sqrt(dx * dx + dy * dy);
      const rectAlpha = smoothstep(0, safeFeatherSize, rectDistance);
      const circleAlpha = smoothstep(0, safeFeatherSize, circleDistance);
      const alpha = lerp(rectAlpha, circleAlpha, safeRoundness) * 255;

      imageData.data[index] = 255;
      imageData.data[index + 1] = 255;
      imageData.data[index + 2] = 255;
      imageData.data[index + 3] = alpha;
    }
  }

  maskCtx.putImageData(imageData, 0, 0);
  featherMaskCache.set(key, mask);
  return mask;
}

function getCenterMask(layerSize, inset, innerSize, fadeSize, roundness) {
  const safeLayerSize = Math.max(1, Math.round(layerSize));
  const safeInset = Math.round(inset);
  const safeInnerSize = Math.max(1, Math.round(innerSize));
  const safeFadeSize = Math.max(1, Math.round(fadeSize));
  const safeRoundness = Math.round(clamp(roundness, 0, 1) * 20) / 20;
  const key = `center:${safeLayerSize}:${safeInset}:${safeInnerSize}:${safeFadeSize}:${safeRoundness}`;

  if (featherMaskCache.has(key)) {
    return featherMaskCache.get(key);
  }

  if (featherMaskCache.size > 80) {
    featherMaskCache.clear();
  }

  const mask = makeCanvas(safeLayerSize, safeLayerSize);
  const maskCtx = mask.getContext("2d");
  const imageData = maskCtx.createImageData(safeLayerSize, safeLayerSize);
  const max = safeInset + safeInnerSize - 1;
  const center = safeInset + (safeInnerSize - 1) / 2;
  const radius = safeInnerSize / 2;

  for (let y = 0; y < safeLayerSize; y++) {
    for (let x = 0; x < safeLayerSize; x++) {
      const index = (y * safeLayerSize + x) * 4;
      let alpha = 0;

      if (x >= safeInset && x <= max && y >= safeInset && y <= max) {
        const rectDistance = Math.min(x - safeInset, y - safeInset, max - x, max - y);
        const dx = x - center;
        const dy = y - center;
        const circleDistance = radius - Math.sqrt(dx * dx + dy * dy);
        const rectAlpha = smoothstep(0, safeFadeSize, rectDistance);
        const circleAlpha = smoothstep(0, safeFadeSize, circleDistance);
        alpha = lerp(rectAlpha, circleAlpha, safeRoundness) * 255;
      }

      imageData.data[index] = 255;
      imageData.data[index + 1] = 255;
      imageData.data[index + 2] = 255;
      imageData.data[index + 3] = alpha;
    }
  }

  maskCtx.putImageData(imageData, 0, 0);
  featherMaskCache.set(key, mask);
  return mask;
}

function drawHardPortal(ctx, micro, childCanvas, patchX, patchY, patchSize, reveal) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(patchX, patchY, patchSize, patchSize);
  ctx.clip();
  ctx.drawImage(micro, patchX, patchY, patchSize, patchSize);
  if (reveal > 0) {
    ctx.globalAlpha = reveal;
    ctx.drawImage(childCanvas, patchX, patchY, patchSize, patchSize);
  }
  ctx.restore();
}

function drawFeatheredPortal(ctx, micro, childCanvas, patchX, patchY, patchSize, reveal, settings, portalCoverage) {
  const edgeStrength = settings.edgeBlend;
  const growth = smoothstep(0.28, 0.92, portalCoverage);
  const roundness = settings.shapeMorph * (1 - smoothstep(0.48, 0.98, portalCoverage));
  const feather = patchSize * edgeStrength * lerp(0.1, 0.78, growth);

  if (feather < 1) {
    drawHardPortal(ctx, micro, childCanvas, patchX, patchY, patchSize, reveal);
    return;
  }

  const layerSourceSize = patchSize + feather * 2;
  const layerSize = Math.max(8, Math.round(layerSourceSize));
  const innerSize = Math.max(2, (patchSize / layerSourceSize) * layerSize);
  const inset = (layerSize - innerSize) / 2;
  const layer = makeCanvas(layerSize, layerSize);
  const layerCtx = layer.getContext("2d");

  layerCtx.imageSmoothingEnabled = true;
  layerCtx.drawImage(micro, 0, 0, layerSize, layerSize);
  if (reveal > 0) {
    layerCtx.globalAlpha = reveal;
    layerCtx.drawImage(childCanvas, 0, 0, layerSize, layerSize);
    layerCtx.globalAlpha = 1;
  }

  layerCtx.globalCompositeOperation = "destination-in";
  layerCtx.drawImage(getFeatherMask(layerSize, inset, roundness), 0, 0);
  layerCtx.globalCompositeOperation = "source-over";

  const exactLayer = makeCanvas(layerSize, layerSize);
  const exactCtx = exactLayer.getContext("2d");
  const centerFade = innerSize * lerp(0.1, 0.28, edgeStrength);

  exactCtx.imageSmoothingEnabled = true;
  exactCtx.drawImage(micro, inset, inset, innerSize, innerSize);
  if (reveal > 0) {
    exactCtx.globalAlpha = reveal;
    exactCtx.drawImage(childCanvas, inset, inset, innerSize, innerSize);
    exactCtx.globalAlpha = 1;
  }
  exactCtx.globalCompositeOperation = "destination-in";
  exactCtx.drawImage(getCenterMask(layerSize, inset, innerSize, centerFade, roundness), 0, 0);
  exactCtx.globalCompositeOperation = "source-over";
  layerCtx.drawImage(exactLayer, 0, 0);

  ctx.drawImage(
    layer,
    patchX - feather,
    patchY - feather,
    layerSourceSize,
    layerSourceSize
  );
}

function getTransition(from, to, settings) {
  const override = getPortalOverride(from.id, to.id);
  const key = transitionKey(from.id, to.id, settings, override);
  if (!state.transitions.has(key)) {
    const portalSettings = resolvePortalSettings(from.canvas, to.canvas, settings, override);
    state.transitions.set(key, {
      canvas: buildMicroCanvas(from.canvas, to.canvas, portalSettings),
      settings: portalSettings
    });
  }
  return state.transitions.get(key);
}

function getCurrentLoopSegment(progress = state.progress) {
  const transitionCount = state.images.length;
  if (transitionCount < 2) return null;

  const loopProgress = ((progress % 1) + 1) % 1;
  const rawSegment = loopProgress * transitionCount;
  const segment = Math.min(transitionCount - 1, Math.floor(rawSegment));

  return {
    segment,
    localT: rawSegment - segment,
    from: state.images[segment],
    to: state.images[(segment + 1) % transitionCount]
  };
}

function getTransitionGeometry(t, portalSettings, targetSize = previewCanvas.width) {
  const sourceSize = SOURCE_SIZE;
  const eased = easeInOutCubic(t);
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
  const scale = targetSize / viewSize;

  return {
    patchSize,
    patchX,
    patchY,
    patchCenterX,
    patchCenterY,
    viewSize,
    viewX,
    viewY,
    scale
  };
}

function drawPortalPickMarker(ctx, geometry) {
  const x = (geometry.patchCenterX - geometry.viewX) * geometry.scale;
  const y = (geometry.patchCenterY - geometry.viewY) * geometry.scale;
  const radius = Math.max(11, previewCanvas.width * 0.018);

  ctx.save();
  ctx.lineWidth = Math.max(2, previewCanvas.width * 0.003);
  ctx.strokeStyle = "rgba(55, 192, 170, 0.95)";
  ctx.fillStyle = "rgba(55, 192, 170, 0.14)";
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - radius * 1.6, y);
  ctx.lineTo(x + radius * 1.6, y);
  ctx.moveTo(x, y - radius * 1.6);
  ctx.lineTo(x, y + radius * 1.6);
  ctx.stroke();
  ctx.restore();
}

function drawTransition(from, to, t, settings) {
  const ctx = previewCtx;
  const size = previewCanvas.width;
  const transition = getTransition(from, to, settings);
  const portalSettings = transition.settings;
  const geometry = getTransitionGeometry(t, portalSettings, size);
  const micro = transition.canvas;
  const portalCoverage = clamp(geometry.patchSize / geometry.viewSize, 0, 1);
  const revealStart = lerp(0.58, 0.42, portalSettings.edgeBlend);
  const revealEnd = lerp(0.96, 0.84, portalSettings.edgeBlend);
  const reveal = smoothstep(revealStart, revealEnd, t);
  const glow = (1 - portalSettings.edgeBlend * 0.75) * (1 - smoothstep(0.2, 0.72, t));

  ctx.save();
  ctx.fillStyle = "#050607";
  ctx.fillRect(0, 0, size, size);
  ctx.scale(geometry.scale, geometry.scale);
  ctx.translate(-geometry.viewX, -geometry.viewY);

  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(from.canvas, 0, 0, SOURCE_SIZE, SOURCE_SIZE);

  drawFeatheredPortal(
    ctx,
    micro,
    to.canvas,
    geometry.patchX,
    geometry.patchY,
    geometry.patchSize,
    reveal,
    portalSettings,
    portalCoverage
  );

  if (glow > 0.01) {
    ctx.strokeStyle = `rgba(55, 192, 170, ${0.24 * glow})`;
    ctx.lineWidth = Math.max(1, geometry.viewSize / size * 2);
    ctx.strokeRect(geometry.patchX, geometry.patchY, geometry.patchSize, geometry.patchSize);
  }

  ctx.restore();

  if (state.isPickingPortal && !state.isRecording) {
    drawPortalPickMarker(ctx, geometry);
  }
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

  const current = getCurrentLoopSegment(progress);
  if (!current) return;

  drawTransition(current.from, current.to, current.localT, settings);
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
      id: createId(),
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

function dataUrlToBlob(dataUrl) {
  const [header, data] = dataUrl.split(",");
  const mimeMatch = header.match(/data:(.*?);base64/);
  const mimeType = mimeMatch ? mimeMatch[1] : "application/octet-stream";
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

function canvasToBlob(type = "image/png", quality = 0.95) {
  return new Promise((resolve) => {
    if (!previewCanvas.toBlob) {
      resolve(dataUrlToBlob(previewCanvas.toDataURL(type, quality)));
      return;
    }

    previewCanvas.toBlob((blob) => {
      resolve(blob || dataUrlToBlob(previewCanvas.toDataURL(type, quality)));
    }, type, quality);
  });
}

function downloadBlob(blob, fileName) {
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

async function shareBlob(blob, fileName, title) {
  if (!navigator.share || !window.File) return "unsupported";

  const file = new File([blob], fileName, {
    type: blob.type || "application/octet-stream"
  });
  const payload = {
    files: [file],
    text: "Made with Zoom Loop",
    title
  };

  if (navigator.canShare && !navigator.canShare({ files: [file] })) {
    return "unsupported";
  }

  try {
    await navigator.share(payload);
    return "shared";
  } catch (error) {
    return error.name === "AbortError" ? "cancelled" : "unsupported";
  }
}

async function shareOrDownloadBlob(blob, fileName, title) {
  const result = await shareBlob(blob, fileName, title);

  if (result === "shared") {
    statusText.textContent = "Shared";
    return;
  }

  if (result === "cancelled") {
    statusText.textContent = "Share canceled";
    return;
  }

  downloadBlob(blob, fileName);
}

async function downloadCanvasPng() {
  const blob = await canvasToBlob("image/png");
  downloadBlob(blob, "zoom-loop-frame.png");
}

async function shareCurrentFrame() {
  const blob = await canvasToBlob("image/png");
  await shareOrDownloadBlob(blob, "zoom-loop-frame.png", "Zoom Loop frame");
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

  const blob = new Blob(chunks, {
    type: recorder.mimeType || mimeType || "video/webm"
  });
  const fileName = `zoom-loop.${getVideoExtension(blob.type)}`;
  await shareOrDownloadBlob(blob, fileName, "Zoom Loop video");

  state.isRecording = false;
  webmButton.textContent = "Video";
  updateStatus();
}

function getRecorderMimeType() {
  const options = [
    "video/mp4;codecs=h264",
    "video/mp4;codecs=avc1.42E01E",
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm"
  ];
  return options.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function getVideoExtension(mimeType) {
  return mimeType.includes("mp4") ? "mp4" : "webm";
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

installButton.addEventListener("click", promptInstall);
playButton.addEventListener("click", togglePlayback);
stagePlayButton.addEventListener("click", togglePlayback);

pngButton.addEventListener("click", downloadCanvasPng);
shareButton.addEventListener("click", shareCurrentFrame);
webmButton.addEventListener("click", recordWebm);
sampleButton.addEventListener("click", createSampleSet);
autoSortButton.addEventListener("click", autoSortImages);
clearButton.addEventListener("click", clearImages);
autoTuneButton.addEventListener("click", autoTuneLoop);
smoothDefaultsButton.addEventListener("click", applySmoothDefaults);
portalPickButton.addEventListener("click", togglePortalPickMode);
portalClearButton.addEventListener("click", clearCurrentPortalPick);
previewCanvas.addEventListener("click", handlePortalCanvasClick);

timelineInput.addEventListener("input", () => {
  state.isPickingPortal = false;
  state.progress = Number(timelineInput.value) / 1000;
  syncPortalPickingUi();
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

registerServiceWorker();
setupInstallPrompt();
setCanvasSize(Number(sizeInput.value));
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get("auto") === "1") {
  autoAnchorInput.checked = true;
}
if (urlParams.has("progress")) {
  const initialProgress = Number(urlParams.get("progress"));
  if (Number.isFinite(initialProgress)) {
    state.progress = clamp(initialProgress, 0, 1);
    timelineInput.value = String(Math.round(state.progress * 1000));
  }
}
syncAnchorMode();
updateStatus();
drawCurrentFrame();
if (urlParams.get("sample") === "1") {
  createSampleSet();
}
requestAnimationFrame(tick);
