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
const saveProjectButton = document.querySelector("#saveProjectButton");
const openProjectButton = document.querySelector("#openProjectButton");
const projectFileInput = document.querySelector("#projectFileInput");
const projectHelp = document.querySelector("#projectHelp");
const frameDialog = document.querySelector("#frameDialog");
const frameCanvas = document.querySelector("#frameCanvas");
const frameHelp = document.querySelector("#frameHelp");
const frameXInput = document.querySelector("#frameXInput");
const frameYInput = document.querySelector("#frameYInput");
const frameZoomInput = document.querySelector("#frameZoomInput");
const frameZoomReadout = document.querySelector("#frameZoomReadout");
const frameRotateButton = document.querySelector("#frameRotateButton");
const frameResetButton = document.querySelector("#frameResetButton");
const frameCancelButton = document.querySelector("#frameCancelButton");
const frameApplyButton = document.querySelector("#frameApplyButton");
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
const MAX_PROJECT_BYTES = 200 * 1024 * 1024;
const TAU = Math.PI * 2;
const ASSET_VERSION = "v11";
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
  isFraming: false,
  exportController: null,
  isPickingPortal: false,
  lastTime: 0,
  dragDepth: 0
};

let deferredInstallPrompt = null;
let heicConverterPromise = null;
let frameSession = null;

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
  return state.isLoading || state.isRecording || state.isPreparing || state.isFraming;
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
      sourceBlob: file,
      converted: false
    };
  } catch (nativeError) {
    if (!isHeicFile(file)) throw nativeError;

    const convertedFile = await convertHeicFile(file);
    return {
      ...(await decodeNatively(convertedFile)),
      sourceBlob: convertedFile,
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
          canvas: decoded.canvas,
          sourceBlob: decoded.sourceBlob
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

    const frame = document.createElement("button");
    frame.type = "button";
    frame.className = "frame-button";
    frame.textContent = "Frame";
    frame.setAttribute("aria-label", `Frame ${image.name}`);
    frame.addEventListener("click", () => openPhotoFrame(image.id));

    actions.append(up, down, remove, frame);
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

async function loadPhotoSource(blob) {
  if (window.createImageBitmap) {
    try {
      let bitmap;
      try { bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" }); }
      catch { bitmap = await createImageBitmap(blob); }
      return { image: bitmap, width: bitmap.width, height: bitmap.height, dispose: () => bitmap.close() };
    } catch { /* Try the image-element decoder as on upload. */ }
  }
  const url = URL.createObjectURL(blob);
  const image = new Image();
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("Could not read the original photo"));
      image.src = url;
    });
    return { image, width: image.naturalWidth, height: image.naturalHeight, dispose: () => URL.revokeObjectURL(url) };
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}

function drawPhotoFrame(ctx, source, width, height, framing) {
  const turned = framing.rotation % 180 !== 0;
  const sourceW = turned ? source.height : source.width;
  const sourceH = turned ? source.width : source.height;
  const side = Math.min(sourceW, sourceH) / framing.zoom;
  const x = (sourceW - side) * framing.x;
  const y = (sourceH - side) * framing.y;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.scale(width / side, height / side);
  ctx.translate(-x, -y);
  if (framing.rotation === 90) { ctx.translate(source.height, 0); ctx.rotate(Math.PI / 2); }
  if (framing.rotation === 180) { ctx.translate(source.width, source.height); ctx.rotate(Math.PI); }
  if (framing.rotation === 270) { ctx.translate(0, source.width); ctx.rotate(-Math.PI / 2); }
  ctx.drawImage(source.image, 0, 0);
  ctx.restore();
}

function getPhotoFraming() {
  return { x: Number(frameXInput.value) / 100, y: Number(frameYInput.value) / 100,
    zoom: Number(frameZoomInput.value) / 100, rotation: frameSession.rotation };
}

function drawPhotoFramingPreview() {
  if (!frameSession) return;
  const framing = getPhotoFraming();
  const { source } = frameSession;
  const turned = framing.rotation % 180 !== 0;
  const width = turned ? source.height : source.width;
  const height = turned ? source.width : source.height;
  const side = Math.min(width, height) / framing.zoom;
  frameXInput.disabled = width - side < 0.01;
  frameYInput.disabled = height - side < 0.01;
  frameZoomReadout.value = `${framing.zoom.toFixed(2).replace(/\.?0+$/, "")}×`;
  const ctx = frameCanvas.getContext("2d", { alpha: false });
  drawPhotoFrame(ctx, source, frameCanvas.width, frameCanvas.height, framing);
  if (state.images.length > 1) {
    const size = frameCanvas.width, inset = size * 0.1;
    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
    ctx.fillRect(0, 0, size, inset); ctx.fillRect(0, size - inset, size, inset);
    ctx.fillRect(0, inset, inset, size - inset * 2); ctx.fillRect(size - inset, inset, inset, size - inset * 2);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
    ctx.lineWidth = 2; ctx.setLineDash([8, 6]);
    ctx.strokeRect(inset, inset, size - inset * 2, size - inset * 2);
    ctx.restore();
  }
}

async function openPhotoFrame(imageId) {
  if (isBusy()) return;
  const photo = state.images.find(image => image.id === imageId);
  if (!photo) return;
  const previousPlaying = state.isPlaying;
  let source;
  state.isPreparing = true;
  updateStatus();
  statusText.textContent = "Preparing photo framing";
  try {
    if (!photo.sourceBlob) photo.sourceBlob = dataUrlToBlob(photo.canvas.toDataURL("image/png"));
    source = await loadPhotoSource(photo.sourceBlob);
    const squareOnly = source.width === source.height && photo.width !== photo.height;
    const framing = photo.framing || { x: 0.5, y: 0.5, zoom: 1, rotation: 0 };
    frameSession = { photo, source, previousPlaying, rotation: framing.rotation };
    frameXInput.value = String(framing.x * 100);
    frameYInput.value = String(framing.y * 100);
    frameZoomInput.value = String(framing.zoom * 100);
    document.querySelector("#frameTitle").textContent = `Frame ${photo.name}`;
    frameHelp.textContent = squareOnly
      ? "This older project has only the square photo. Add the original to recover its edges."
      : "Choose the part of this photo that appears in the loop. Changes apply only when you press Apply frame.";
    if (state.images.length > 1) frameHelp.textContent += " The outline marks the area visible at each loop handoff.";
    state.isFraming = true;
    drawPhotoFramingPreview();
    frameDialog.showModal();
  } catch (error) {
    source?.dispose();
    frameSession = null;
    state.isFraming = false;
    state.isPlaying = previousPlaying;
    setUploadHelp(`Could not frame photo: ${error.message}`, "error");
  } finally {
    state.isPreparing = false;
    state.lastTime = 0;
    updateStatus();
  }
}

function finishPhotoFraming() {
  if (!frameSession) return;
  const { previousPlaying, source } = frameSession;
  frameSession = null;
  source.dispose();
  state.isFraming = false;
  state.isPlaying = previousPlaying;
  state.lastTime = 0;
  updateStatus();
}

function closePhotoFraming() {
  frameDialog.close();
  finishPhotoFraming();
}

function applyPhotoFraming() {
  if (!frameSession) return;
  try {
    const { photo, source } = frameSession;
    const framing = getPhotoFraming();
    const canvas = makeCanvas(SOURCE_SIZE, SOURCE_SIZE);
    drawPhotoFrame(canvas.getContext("2d", { alpha: false }), source, SOURCE_SIZE, SOURCE_SIZE, framing);
    const url = createThumbnailUrl(canvas);
    if (photo.url.startsWith("blob:")) URL.revokeObjectURL(photo.url);
    photo.canvas = canvas;
    photo.url = url;
    photo.framing = framing;
    invalidateTransitions();
    closePhotoFraming();
    renderImageList();
    updateStatus();
    drawCurrentFrame();
    setUploadHelp("Photo frame updated. Joins use the new framing.", "ok");
  } catch (error) {
    frameHelp.textContent = `Could not apply frame: ${error.message}`;
    setUploadHelp(frameHelp.textContent, "error");
  }
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
  saveProjectButton.disabled = busy || count === 0;
  openProjectButton.disabled = busy;
  projectFileInput.disabled = busy;
  cancelExportButton.classList.toggle("is-hidden", !state.isRecording);
  cancelExportButton.disabled = Boolean(state.exportController?.signal.aborted);
  imageList.querySelectorAll("li").forEach((item, index) => {
    const [up, down, remove, frame] = item.querySelectorAll("button");
    up.disabled = busy || index === 0;
    down.disabled = busy || index === count - 1;
    remove.disabled = busy;
    frame.disabled = busy;
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
    ? "Fixed photo joins follow matching texture and lighting. Prepared locally before playback; only your photos are used."
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
    try { drawCurrentFrame(); } catch (error) {
      state.isPlaying = false;
      syncPlaybackUi();
      statusText.textContent = `Preview failed: ${error.message}. Try a lower canvas size.`;
    }
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

async function saveProject() {
  if (isBusy() || !state.images.length) return;
  const previousPlaying = state.isPlaying;
  state.isPreparing = true;
  updateStatus();
  let message;
  try {
    const project = {
      format: "zoom-loop", version: 1, progress: state.progress,
      settings: Object.fromEntries(controls.map(control => [control.id,
        control.type === "checkbox" ? control.checked : control.value])),
      images: [], portals: []
    };
    project.settings.framesInput = String(getSettings().frames);
    project.settings.fpsInput = String(getSettings().fps);
    if (state.images.length > 200) throw new Error("Projects support up to 200 photos");
    let photoBytes = 0;
    for (const [index, image] of state.images.entries()) {
      projectHelp.textContent = `Saving photo ${index + 1} of ${state.images.length}…`;
      await new Promise(resolve => setTimeout(resolve, 0));
      const savedPhoto = { name: image.name, width: image.width, height: image.height,
        data: image.canvas.toDataURL("image/png"), framing: image.framing,
        source: image.sourceBlob ? await encodeProjectPhotoSource(image.sourceBlob) : undefined };
      photoBytes += savedPhoto.data.length + (savedPhoto.source?.length || 0);
      if (photoBytes > MAX_PROJECT_BYTES) throw new Error("Project is too large; use fewer photos (200 MB maximum)");
      project.images.push(savedPhoto);
    }
    const indices = new Map(state.images.map((image, index) => [image.id, index]));
    for (const [pair, point] of state.portalOverrides) {
      const [from, to] = pair.split("->").map(id => indices.get(id));
      if (from !== undefined && to !== undefined) project.portals.push({ from, to, ...point });
    }
    const blob = new Blob([JSON.stringify(project)], { type: "application/json" });
    if (blob.size > MAX_PROJECT_BYTES) throw new Error("Project is too large; use fewer photos (200 MB maximum)");
    downloadBlob(blob, "zoom-loop.zoomloop");
    message = "Project saved. Photos, framing, settings, and picked portals are included.";
  } catch (error) {
    message = `Could not save project: ${error.message}`;
  } finally {
    state.isPreparing = false;
    state.isPlaying = previousPlaying;
    state.lastTime = 0;
    updateStatus();
    projectHelp.textContent = message;
  }
}

async function encodeProjectPhotoSource(blob) {
  const source = await loadPhotoSource(blob);
  try {
    const scale = Math.min(1, 2048 / Math.max(source.width, source.height));
    const canvas = makeCanvas(Math.max(1, Math.round(source.width * scale)), Math.max(1, Math.round(source.height * scale)));
    canvas.getContext("2d", { alpha: false }).drawImage(source.image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } finally { source.dispose(); }
}

function validFraming(framing) {
  return framing && Number.isFinite(framing.x) && framing.x >= 0 && framing.x <= 1 &&
    Number.isFinite(framing.y) && framing.y >= 0 && framing.y <= 1 &&
    Number.isFinite(framing.zoom) && framing.zoom >= 1 && framing.zoom <= 3 &&
    [0, 90, 180, 270].includes(framing.rotation);
}

function readProjectPhoto(data, square = true) {
  const blob = dataUrlToBlob(data);
  return blob.slice(0, 24).arrayBuffer().then(buffer => {
    const view = new DataView(buffer);
    if (buffer.byteLength !== 24 || view.getUint32(0) !== 0x89504e47 ||
        view.getUint32(4) !== 0x0d0a1a0a || view.getUint32(12) !== 0x49484452) throw new Error("Invalid saved photo");
    const width = view.getUint32(16), height = view.getUint32(20);
    if (square ? width !== SOURCE_SIZE || height !== SOURCE_SIZE : width < 1 || height < 1 || width > 2048 || height > 2048) {
      throw new Error("Invalid saved photo dimensions");
    }
    return blob;
  });
}

function validateProject(project) {
  const invalid = () => { throw new Error("Invalid project file"); };
  if (!project || project.format !== "zoom-loop") invalid();
  if (project.version !== 1) throw new Error("This project version is not supported");
  if (!Array.isArray(project.images) || !project.images.length || project.images.length > 200 ||
      !Number.isFinite(project.progress) || project.progress < 0 || project.progress > 1 ||
      !project.settings || !Array.isArray(project.portals) || project.portals.length > project.images.length ** 2) invalid();
  for (const control of controls) {
    const value = project.settings[control.id];
    if (control.type === "checkbox") {
      if (typeof value !== "boolean") invalid();
    } else {
      if (typeof value !== "string" || value.trim() === "") invalid();
      if (control.tagName === "SELECT") {
        if (![...control.options].some(option => option.value === value)) invalid();
      } else if (!Number.isFinite(Number(value)) || Number(value) < Number(control.min) || Number(value) > Number(control.max)) invalid();
    }
  }
  for (const image of project.images) {
    if (!image || typeof image.name !== "string" || image.name.length > 1024 ||
        !Number.isInteger(image.width) || !Number.isInteger(image.height) ||
        image.width < 1 || image.height < 1 || image.width > 100000 || image.height > 100000 ||
        typeof image.data !== "string" || image.data.length > 8 * 1024 * 1024 ||
        !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(image.data)) invalid();
    if (image.framing !== undefined && (!validFraming(image.framing) || image.source === undefined)) invalid();
    if (image.source !== undefined && (typeof image.source !== "string" || image.source.length > 24 * 1024 * 1024 ||
        !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(image.source))) invalid();
  }
  for (const point of project.portals) {
    if (!point || !Number.isInteger(point.from) || !Number.isInteger(point.to) ||
        point.from < 0 || point.to < 0 || point.from >= project.images.length || point.to >= project.images.length ||
        !Number.isFinite(point.anchorX) || !Number.isFinite(point.anchorY) ||
        point.anchorX < 0.08 || point.anchorX > 0.92 || point.anchorY < 0.08 || point.anchorY > 0.92) invalid();
  }
  return project;
}

async function openProject(file) {
  if (!file || isBusy()) return;
  const previousPlaying = state.isPlaying;
  const loaded = [];
  let committed = false;
  let message;
  setUploadBusy(true);
  try {
    if (file.size > MAX_PROJECT_BYTES) throw new Error("Project exceeds the 200 MB limit");
    const project = validateProject(JSON.parse(await file.text()));
    for (const [index, image] of project.images.entries()) {
      projectHelp.textContent = `Opening photo ${index + 1} of ${project.images.length}…`;
      // Check normalized and framing-copy dimensions before allocating decoded pixels.
      const blob = await readProjectPhoto(image.data);
      const decoded = await decodeNatively(blob);
      const sourceBlob = image.source ? await readProjectPhoto(image.source, false) : undefined;
      if (sourceBlob) {
        const verified = await loadPhotoSource(sourceBlob);
        verified.dispose();
      }
      loaded.push({ id: createId(), name: image.name, width: image.width, height: image.height,
        canvas: decoded.canvas, url: createThumbnailUrl(decoded.canvas), sourceBlob, framing: image.framing });
    }
    const portals = new Map(project.portals.map(point => [getPairKey(loaded[point.from].id, loaded[point.to].id),
      { anchorX: point.anchorX, anchorY: point.anchorY }]));
    state.images.forEach(image => { if (image.url.startsWith("blob:")) URL.revokeObjectURL(image.url); });
    state.images = loaded;
    state.portalOverrides = portals;
    state.progress = project.progress;
    timelineInput.value = String(Math.round(state.progress * 1000));
    controls.forEach(control => {
      if (control.type === "checkbox") control.checked = project.settings[control.id];
      else control.value = project.settings[control.id];
    });
    invalidateTransitions();
    committed = true;
    renderImageList();
    message = `Opened ${loaded.length} ${plural(loaded.length, "photo")}. Settings and picked portals restored.`;
  } catch (error) {
    message = `Could not open project: ${error.message}`;
  } finally {
    setUploadBusy(false);
    state.isPlaying = !committed && previousPlaying;
    state.lastTime = 0;
    syncPlaybackUi();
    try { drawCurrentFrame(); } catch (error) {
      state.isPlaying = false;
      syncPlaybackUi();
      message = `Project preview failed: ${error.message}`;
    }
    projectHelp.textContent = message;
  }
}

function canvasToBlob(type = "image/png", quality = 0.95) {
  return new Promise((resolve, reject) => {
    if (!previewCanvas.toBlob) {
      resolve(dataUrlToBlob(previewCanvas.toDataURL(type, quality)));
      return;
    }

    previewCanvas.toBlob((blob) => {
      try { resolve(blob || dataUrlToBlob(previewCanvas.toDataURL(type, quality))); }
      catch (error) { reject(error); }
    }, type, quality);
  });
}

function downloadBlob(blob, fileName) {
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Give the browser time to consume the download before releasing its URL.
  setTimeout(() => URL.revokeObjectURL(url), 30000);
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
  if (isBusy() || !state.images.length) return;
  try {
    const blob = await canvasToBlob("image/png");
    downloadBlob(blob, "zoom-loop-frame.png");
  } catch (error) { statusText.textContent = `PNG export failed: ${error.message}`; }
}

async function shareCurrentFrame() {
  if (isBusy() || !state.images.length) return;
  try {
    const blob = await canvasToBlob("image/png");
    await shareOrDownloadBlob(blob, "zoom-loop-frame.png", "Zoom Loop frame");
  } catch (error) { statusText.textContent = `Frame sharing failed: ${error.message}`; }
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
    try { drawCurrentFrame(); } catch (error) {
      recordingError ||= error;
      state.isPlaying = false;
      syncPlaybackUi();
    }
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
saveProjectButton.addEventListener("click", saveProject);
openProjectButton.addEventListener("click", () => { if (!isBusy()) projectFileInput.click(); });
projectFileInput.addEventListener("change", (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  openProject(file);
});
for (const input of [frameXInput, frameYInput, frameZoomInput]) input.addEventListener("input", drawPhotoFramingPreview);
frameRotateButton.addEventListener("click", () => {
  if (!frameSession) return;
  frameSession.rotation = (frameSession.rotation + 90) % 360;
  drawPhotoFramingPreview();
});
frameResetButton.addEventListener("click", () => {
  if (!frameSession) return;
  frameSession.rotation = 0;
  frameXInput.value = "50"; frameYInput.value = "50"; frameZoomInput.value = "100";
  drawPhotoFramingPreview();
});
frameCancelButton.addEventListener("click", closePhotoFraming);
frameApplyButton.addEventListener("click", applyPhotoFraming);
frameDialog.addEventListener("close", () => { if (!frameDialog.open) finishPhotoFraming(); });
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
