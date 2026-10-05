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
const cancelExportButton = document.querySelector("#cancelExportButton");
const renderModeInput = document.querySelector("#renderModeInput");
const renderModeHelp = document.querySelector("#renderModeHelp");
const sampleButton = document.querySelector("#sampleButton");
const autoSortButton = document.querySelector("#autoSortButton");
const clearButton = document.querySelector("#clearButton");
const timelineInput = document.querySelector("#timelineInput");
const timeReadout = document.querySelector("#timeReadout");
const autoCinematicButton = document.querySelector("#autoCinematicButton");
const autoTuneButton = document.querySelector("#autoTuneButton");
const smoothDefaultsButton = document.querySelector("#smoothDefaultsButton");
const portalPickButton = document.querySelector("#portalPickButton");
const portalClearButton = document.querySelector("#portalClearButton");
const portalHelp = document.querySelector("#portalHelp");
const placementStatus = document.querySelector("#placementStatus");

const sizeInput = document.querySelector("#sizeInput");
const framesInput = document.querySelector("#framesInput");
const fpsInput = document.querySelector("#fpsInput");
const zoomRateInput = document.querySelector("#zoomRateInput");
const smoothGuardInput = document.querySelector("#smoothGuardInput");
const cinematicModeInput = document.querySelector("#cinematicModeInput");
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
const TAU = Math.PI * 2;
const ASSET_VERSION = "v9";
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
  isPreparing: false,
  exportController: null,
  isPickingPortal: false,
  lastTime: 0,
  dragDepth: 0
};

let deferredInstallPrompt = null;
let heicConverterPromise = null;

const controls = [
  renderModeInput,
  sizeInput,
  framesInput,
  fpsInput,
  zoomRateInput,
  smoothGuardInput,
  cinematicModeInput,
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
    mode: renderModeInput.value === "stitched" ? "stitched" : "blend",
    size: [720, 1080, 1440, 2160].includes(Number(sizeInput.value)) ? Number(sizeInput.value) : 1080,
    frames: readNumber(framesInput, 120, 24, 240),
    fps: readNumber(fpsInput, 30, 12, 60),
    zoomRate: Number(zoomRateInput.value) / 100,
    smoothGuard: smoothGuardInput.checked,
    cinematicMode: cinematicModeInput.checked,
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

function readNumber(input, fallback, min, max) {
  const value = input.value.trim() === "" ? NaN : Number(input.value);
  return Number.isFinite(value) ? clamp(Math.round(value), min, max) : fallback;
}

function isBusy() {
  return state.isLoading || state.isRecording || state.isPreparing;
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
    settings.mode,
    settings.smoothGuard ? "guard" : "raw",
    settings.cinematicMode ? "cinema" : "plain",
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
    navigator.serviceWorker.register(`./sw.js?${ASSET_VERSION}`).catch(() => {
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
  if (isBusy) {
    state.isPlaying = false;
    state.isPickingPortal = false;
  }
  dropZone.classList.toggle("is-loading", isBusy);
  updateStatus();
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
    const timeout = setTimeout(() => fail(), 20000);
    function fail() {
      clearTimeout(timeout);
      script.remove();
      reject(new Error("HEIC converter could not be loaded. Try again when online."));
    }
    script.addEventListener("load", () => {
      clearTimeout(timeout);
      script.dataset.ready = "true";
      resolve();
    }, { once: true });
    script.addEventListener("error", fail, { once: true });
    document.head.append(script);
  });
}

async function getHeicConverter() {
  if (window.heic2any) return window.heic2any;

  if (!heicConverterPromise) {
    heicConverterPromise = loadScript(HEIC_CONVERTER_URL).then(() => {
      if (!window.heic2any) {
        document.querySelector(`script[src="${HEIC_CONVERTER_URL}"]`)?.remove();
        throw new Error("HEIC converter is unavailable");
      }
    }).catch((error) => {
      heicConverterPromise = null;
      throw error;
    });
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
  if (isBusy()) return;

  const selectedFiles = [...files];
  const imageFiles = selectedFiles.filter(isLikelyImageFile);
  const skippedCount = selectedFiles.length - imageFiles.length;

  if (!selectedFiles.length) return;

  if (!imageFiles.length) {
    setUploadHelp("Try JPG, PNG, WebP, GIF, BMP, AVIF, HEIC, or HEIF.", "error");
    return;
  }

  const failed = [];
  const loadedImages = [];
  let loadedCount = 0;
  let convertedCount = 0;

  setUploadBusy(true);
  setUploadHelp("Preparing images");

  try {
    for (const [index, file] of imageFiles.entries()) {
      statusText.textContent = `Loading ${index + 1} of ${imageFiles.length}`;

      try {
        const decoded = await decodePhotoFile(file);
        loadedImages.push({
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
    state.images.push(...loadedImages);
    setUploadBusy(false);
  }

  if (loadedCount > 0) {
    invalidateTransitions();
    renderImageList();
    drawCurrentFrame();
  }

  updateStatus();

  if (!loadedCount && state.images.length === 0) {
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
  if (isBusy()) return;
  const next = index + direction;
  if (next < 0 || next >= state.images.length) return;
  const [image] = state.images.splice(index, 1);
  state.images.splice(next, 0, image);
  invalidateTransitions();
  renderImageList();
  drawCurrentFrame();
}

function removeImage(index) {
  if (isBusy()) return;
  const [image] = state.images.splice(index, 1);
  if (image?.url?.startsWith("blob:")) URL.revokeObjectURL(image.url);
  purgePortalOverrides();
  invalidateTransitions();
  renderImageList();
  updateStatus();
  drawCurrentFrame();
}

function clearImages() {
  if (isBusy()) return;
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
  const busy = isBusy();
  if (count === 0) statusText.textContent = "Empty stack";
  else if (count === 1) statusText.textContent = "Add one more image";
  else statusText.textContent = `${count} images in loop`;
  if (count < 2 || busy) {
    state.isPlaying = false;
  }
  playButton.disabled = count < 2 || busy;
  stagePlayButton.disabled = count < 2 || busy;
  shareButton.disabled = count === 0 || busy;
  pngButton.disabled = count === 0 || busy;
  webmButton.disabled = count < 2 || busy;
  autoSortButton.disabled = count < 3 || busy;
  autoCinematicButton.disabled = busy || renderModeInput.value === "stitched";
  autoTuneButton.disabled = busy;
  portalPickButton.disabled = count < 2 || busy;
  portalClearButton.disabled = count < 2 || busy;
  controls.forEach((control) => { control.disabled = busy; });
  for (const control of [timelineInput, clearButton, sampleButton, smoothDefaultsButton]) {
    control.disabled = busy;
  }
  fileInput.disabled = busy;
  cancelExportButton.classList.toggle("is-hidden", !state.isRecording);
  cancelExportButton.disabled = Boolean(state.exportController?.signal.aborted);
  imageList.querySelectorAll("li").forEach((item, index) => {
    const [up, down, remove] = item.querySelectorAll("button");
    up.disabled = busy || index === 0;
    down.disabled = busy || index === count - 1;
    remove.disabled = busy;
  });
  syncRenderMode();
  syncAnchorMode();
  syncPortalPickingUi();
  syncPlaybackUi();
}

function syncPortalPickingUi() {
  const canPick = state.images.length >= 2 && !isBusy();
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

async function prepareTransitions(settings, signal) {
  for (let index = 0; index < state.images.length; index++) {
    if (signal?.aborted) return;
    statusText.textContent = `Preparing ${settings.mode === "stitched" ? "stitches" : "photos"} ${index + 1} of ${state.images.length}`;
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (signal?.aborted) return;
    getTransition(state.images[index], state.images[(index + 1) % state.images.length], settings);
  }
}

async function togglePlayback() {
  if (state.images.length < 2 || isBusy()) return;
  state.isPickingPortal = false;
  if (state.isPlaying) {
    state.isPlaying = false;
  } else {
    state.isPreparing = true;
    updateStatus();
    let error;
    try { await prepareTransitions(getSettings()); } catch (failure) { error = failure; }
    state.isPreparing = false;
    updateStatus();
    if (error) {
      statusText.textContent = `Could not prepare the loop: ${error.message}`;
      return;
    }
    state.isPlaying = true;
  }
  state.lastTime = 0;
  syncPortalPickingUi();
  syncPlaybackUi();
}

function syncAnchorMode() {
  const isAuto = autoAnchorInput.checked;
  anchorXInput.disabled = isAuto || isBusy();
  anchorYInput.disabled = isAuto || isBusy();
}

function syncRenderMode() {
  const stitched = renderModeInput.value === "stitched";
  renderModeHelp.textContent = stitched
    ? "Photos are stitched into a fixed nested scene before playback. No fade-in reveal; only your photos are used."
    : "Hidden photo detail gradually emerges as you zoom.";
  for (const control of [cinematicModeInput, grainInput, symmetryInput, alignmentInput]) control.disabled = isBusy() || stitched;
}

function applySmoothDefaults() {
  if (isBusy()) return;
  framesInput.value = "120";
  fpsInput.value = "30";
  zoomRateInput.value = "82";
  smoothGuardInput.checked = true;
  patchInput.value = "8";
  autoAnchorInput.checked = true;
  anchorXInput.value = "50";
  anchorYInput.value = "50";
  bindInput.value = "100";
  sampleBlendInput.value = "78";
  edgeBlendInput.value = "86";
  shapeMorphInput.value = "72";
  grainInput.value = "0";
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
  if (isBusy()) return;

  state.portalOverrides.clear();
  cinematicModeInput.checked = false;
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

function applyAutoCinematic() {
  if (isBusy() || renderModeInput.value === "stitched") return;

  autoTuneLoop();
  cinematicModeInput.checked = true;
  framesInput.value = "138";
  zoomRateInput.value = "76";
  bindInput.value = "100";
  sampleBlendInput.value = "74";
  edgeBlendInput.value = "82";
  shapeMorphInput.value = "80";
  grainInput.value = "0";

  invalidateTransitions();
  updateStatus();
  setUploadHelp(
    state.images.length >= 3
      ? `Auto cinematic tuned and sorted ${state.images.length} images.`
      : "Auto cinematic transition settings loaded.",
    "ok"
  );
  setPortalHelp("Auto Cinematic applied: deeper texture blending and a gradual detail reveal.", "ok");
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
  if (state.images.length < 2 || isBusy()) return;

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
  if (isBusy()) return;
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

function getCanvasSignatureCached(canvas) {
  if (!canvas._zoomLoopSignature) {
    canvas._zoomLoopSignature = getCanvasSignature(canvas);
  }
  return canvas._zoomLoopSignature;
}

function getImageSignature(image) {
  if (!image.signature) {
    image.signature = getCanvasSignatureCached(image.canvas);
  }
  return image.signature;
}

function scoreImagePair(firstImage, secondImage) {
  const first = getImageSignature(firstImage);
  const second = getImageSignature(secondImage);
  const red = (first.r - second.r) / 255;
  const green = (first.g - second.g) / 255;
  const blue = (first.b - second.b) / 255;
  const colorDistance = Math.sqrt(red * red + green * green + blue * blue) / Math.sqrt(3);
  const lumaDistance = Math.abs(first.luma - second.luma) / 255;
  const contrastDistance = Math.abs(first.contrast - second.contrast) / 128;
  const saturationDistance = Math.abs(first.saturation - second.saturation);
  return colorDistance * 0.52 + lumaDistance * 0.22 + contrastDistance * 0.18 + saturationDistance * 0.08;
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
  if (state.images.length < 3 || isBusy()) return;
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

function getTransition(from, to, settings) {
  const override = getPortalOverride(from.id, to.id);
  const key = transitionKey(from.id, to.id, settings, override);
  if (!state.transitions.has(key)) {
    state.transitions.set(key, PhotoZoom.createTransition(from.canvas, to.canvas, settings, override));
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
  return PhotoZoom.geometry(t, portalSettings, targetSize, SOURCE_SIZE);
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
  const segment = state.images.indexOf(from);
  const geometry = PhotoZoom.render(previewCtx, state.images, segment, t, settings, getTransition);
  if (state.isPickingPortal && !state.isRecording) drawPortalPickMarker(previewCtx, geometry);
}

function updatePlacementStatus(current, settings) {
  let message = "Add two photos to see the placement decision.";
  if (current) {
    const transition = getTransition(current.from, current.to, settings);
    const { placement, settings: selected } = transition;
    const position = `${Math.round(selected.anchorX * 100)}% across, ${Math.round(selected.anchorY * 100)}% down`;
    const reason = placement.mode === "picked" ? "Your picked point" :
      placement.mode === "manual" ? "Manual anchor" :
      placement.reason === "stronger-match" ? "Auto: off-center for a substantially stronger visual match" :
      "Auto: balanced in-frame match";
    message = `Transition ${currentTransitionLabel(current)}. ${reason} (${position}).`;
  }
  if (placementStatus.textContent !== message) placementStatus.textContent = message;
}

function drawLoopFrame(progress) {
  const settings = getSettings();
  setCanvasSize(settings.size);
  const current = getCurrentLoopSegment(progress);
  updatePlacementStatus(current, settings);

  if (state.images.length === 0) {
    drawEmpty();
    return;
  }

  if (state.images.length === 1) {
    drawSingleImage();
    return;
  }

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
  const delta = Math.min(100, timestamp - state.lastTime);
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
  if (isBusy()) return;
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
  if (state.images.length < 2 || isBusy()) return;
  if (!previewCanvas.captureStream || !window.MediaRecorder) {
    statusText.textContent = "Recording is not supported";
    return;
  }

  const previousProgress = state.progress;
  const previousPlaying = state.isPlaying;
  const controller = new AbortController();
  state.exportController = controller;
  state.isRecording = true;
  state.isPlaying = false;
  state.isPickingPortal = false;
  updateStatus();
  webmButton.textContent = "Recording";
  let stream;
  let recorder;
  let recordingError;
  let completed = false;
  try {
    const settings = getSettings();
    await prepareTransitions(settings, controller.signal);
    if (controller.signal.aborted) return;
    state.progress = 0;
    timelineInput.value = "0";
    drawCurrentFrame();
    const chunks = [];
    stream = previewCanvas.captureStream(settings.fps);
    const mimeType = getRecorderMimeType();
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    let captureError;
    const finished = new Promise((resolve) => {
      recorder.onstop = resolve;
      recorder.onerror = (event) => { captureError = event.error || new Error("Video capture failed"); resolve(); };
    });
    recorder.start();
    const totalFrames = getTransitionFrames(settings) * state.images.length;
    const started = performance.now();
    for (let frame = 0; frame < totalFrames; frame++) {
      if (captureError) throw captureError;
      if (controller.signal.aborted) break;
      if (recorder.state === "inactive") throw new Error("Video capture stopped early");
      state.progress = frame / totalFrames;
      timelineInput.value = String(Math.round(state.progress * 1000));
      drawCurrentFrame();
      statusText.textContent = `Exporting video ${Math.round((frame + 1) / totalFrames * 100)}%`;
      const nextFrameAt = started + (frame + 1) * 1000 / settings.fps;
      await waitForExportFrame(Math.max(0, nextFrameAt - performance.now()), controller.signal);
    }
    if (recorder.state !== "inactive") recorder.stop();
    let stopTimer;
    try {
      await Promise.race([finished, new Promise((_, reject) => {
        stopTimer = setTimeout(() => reject(new Error("Video capture did not finish")), 5000);
      })]);
    } finally { clearTimeout(stopTimer); }
    if (captureError) throw captureError;
    if (controller.signal.aborted) return;
    const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || "video/webm" });
    if (!blob.size) throw new Error("No video frames were captured");
    const fileName = `zoom-loop.${getVideoExtension(blob.type)}`;
    await shareOrDownloadBlob(blob, fileName, "Zoom Loop video");
    completed = true;
  } catch (error) {
    recordingError = error;
  } finally {
    if (recorder && recorder.state !== "inactive") {
      try { recorder.stop(); } catch { /* Tracks are released below, too. */ }
    }
    stream?.getTracks().forEach((track) => track.stop());
    state.isRecording = false;
    state.exportController = null;
    state.progress = previousProgress;
    state.isPlaying = previousPlaying;
    state.lastTime = 0;
    timelineInput.value = String(Math.round(previousProgress * 1000));
    webmButton.textContent = "Video";
    renderImageList();
    updateStatus();
    drawCurrentFrame();
    if (recordingError) statusText.textContent = `Recording failed: ${recordingError.message}`;
    else if (controller.signal.aborted) statusText.textContent = "Export cancelled";
    else if (completed) statusText.textContent = "Video ready";
  }
}

function waitForExportFrame(ms, signal) {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  });
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
cancelExportButton.addEventListener("click", () => {
  state.exportController?.abort();
  cancelExportButton.disabled = true;
  statusText.textContent = "Cancelling export…";
});
sampleButton.addEventListener("click", createSampleSet);
autoSortButton.addEventListener("click", autoSortImages);
clearButton.addEventListener("click", clearImages);
autoCinematicButton.addEventListener("click", applyAutoCinematic);
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
    if (control === renderModeInput) {
      state.isPlaying = false;
      state.isPickingPortal = false;
    }
    updateStatus();
    if (control === sizeInput) setCanvasSize(getSettings().size);
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

for (const control of [framesInput, fpsInput]) {
  control.addEventListener("change", () => {
    control.value = String(control === framesInput ? getSettings().frames : getSettings().fps);
  });
}

registerServiceWorker();
setupInstallPrompt();
setCanvasSize(Number(sizeInput.value));
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get("mode") === "stitched") renderModeInput.value = "stitched";
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
