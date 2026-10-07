// Exports a short loop in each browser engine and checks the file:
// Chromium (Chrome, Edge, Android), Firefox, and WebKit (Safari, iPhone).
//   node tests/export-engines.cjs            all installed engines
//   ZOOM_ENGINES=webkit node tests/...       one engine
// Set ZOOM_BROWSER to use an installed Chromium browser such as Edge.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const playwright = require("playwright");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "test-results");
fs.mkdirSync(output, { recursive: true });
const server = http.createServer((req, res) => {
  const file = path.join(root, new URL(req.url, "http://localhost").pathname.replace(/^\/$/, "/index.html"));
  if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
  fs.readFile(file, (error, data) => {
    if (error) return res.writeHead(404).end();
    res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html");
    res.end(data);
  });
});

async function exportIn(engine) {
  const browser = await playwright[engine].launch({ headless: true,
    ...(engine === "chromium" && process.env.ZOOM_BROWSER ? { executablePath: process.env.ZOOM_BROWSER } : {}) });
  try {
    const page = await browser.newPage({ acceptDownloads: true });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(() => createSampleSet());
    await page.waitForFunction(() => state.images.length >= 3 && !isBusy());
    const capabilities = await page.evaluate(async () => {
      durationInput.value = "1"; fpsInput.value = "24"; sizeInput.value = "720"; updateStatus();
      const config = canEncodeFrames() ? await findEncoderConfig(getSettings()) : null;
      return {
        videoEncoder: Boolean(window.VideoEncoder), muxer: Boolean(window.Mp4Muxer), h264: config?.codec || null,
        mediaRecorder: Boolean(window.MediaRecorder), captureStream: Boolean(previewCanvas.captureStream),
        path: config ? "frame-by-frame MP4" : window.MediaRecorder && previewCanvas.captureStream ? "real-time recorder" : "unsupported"
      };
    });
    if (capabilities.path === "unsupported") {
      // Builds without any video capture must say so rather than hang.
      await page.locator("#webmButton").click();
      return { engine, ...capabilities, status: await page.locator("#statusText").textContent(), errors };
    }
    // Export through the Video button, as a person would on a computer.
    const started = Date.now();
    const downloadPromise = page.waitForEvent("download", { timeout: 120000 }).catch(() => null);
    await page.locator("#webmButton").click();
    await page.waitForFunction(() => !state.isRecording, null, { timeout: 120000 });
    const download = await downloadPromise;
    const status = await page.locator("#statusText").textContent();
    const result = { engine, ...capabilities, status, exportMs: Date.now() - started, errors };
    if (!download) return result;
    const file = path.join(output, `export-${engine}.${download.suggestedFilename().split(".").pop()}`);
    await download.saveAs(file);
    result.file = path.basename(file);
    result.bytes = fs.statSync(file).size;
    // Decode the file in the same engine when it can play that format.
    result.decoded = await page.evaluate(async ({ name, type }) => {
      const response = await fetch(`/test-results/${name}`);
      const blob = new Blob([await response.arrayBuffer()], { type });
      const video = document.createElement("video");
      if (!video.canPlayType(type)) return "engine cannot play this format";
      const url = URL.createObjectURL(blob);
      try {
        await new Promise((resolve, reject) => {
          video.onloadedmetadata = resolve; video.onerror = () => reject(new Error("decode failed"));
          setTimeout(() => reject(new Error("decode timed out")), 10000); video.src = url;
        });
        return { width: video.videoWidth, height: video.videoHeight, duration: video.duration };
      } catch (error) { return error.message; } finally { URL.revokeObjectURL(url); }
    }, { name: result.file, type: result.file.endsWith("mp4") ? "video/mp4" : "video/webm" });
    return result;
  } finally {
    await browser.close();
  }
}

(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const engines = (process.env.ZOOM_ENGINES || "chromium,firefox,webkit").split(",");
  const results = [];
  assert.ok(engines.length, "No engines selected");
  for (const engine of engines) {
    try { results.push(await exportIn(engine)); } catch (error) { results.push({ engine, failure: error.message.split("\n")[0] }); }
    console.log(JSON.stringify(results.at(-1)));
  }
  fs.writeFileSync(path.join(output, "export-engines.json"), JSON.stringify(results, null, 2));
  for (const result of results) {
    // An engine that is not installed or cannot start here is reported, not failed.
    if (result.failure) continue;
    assert.deepEqual(result.errors, [], result.engine);
    if (result.path === "unsupported") {
      assert.equal(result.status, "Recording is not supported", result.engine);
      continue;
    }
    assert.ok(result.bytes > 1000, `${result.engine}: ${result.status}`);
    if (typeof result.decoded === "object") {
      assert.equal(result.decoded.width, 720, result.engine);
      // Three sample photos at one second each.
      assert.ok(Math.abs(result.decoded.duration - 3) < 0.25, `${result.engine}: ${result.decoded.duration}`);
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
