const assert = require("node:assert/strict");

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 15; SM-S938U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";

// Emulates a touch phone with a recording share sheet. iPhone saves to Photos
// only through the share sheet and only from a tap; Android's Gallery lists
// downloads, so Android downloads first and offers sharing as an extra.
async function openPhone(browser, url, fixtures, userAgent) {
  const context = await browser.newContext({
    serviceWorkers: "block", hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 }, userAgent, acceptDownloads: true
  });
  await context.addInitScript(() => {
    window.shareCalls = [];
    window.shareMode = "ok";
    navigator.canShare = data => Boolean(data?.files?.length);
    navigator.share = async data => {
      // Browsers reject a share that does not come from a recent tap.
      if (!navigator.userActivation.isActive) throw new DOMException("No user activation", "NotAllowedError");
      window.shareCalls.push({ keys: Object.keys(data).sort(), files: data.files.map(file => ({ name: file.name, type: file.type, size: file.size })) });
      if (window.shareMode === "cancel") throw new DOMException("Cancelled", "AbortError");
    };
  });
  const page = await context.newPage();
  const errors = [];
  const downloads = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("download", download => downloads.push(download.suggestedFilename()));
  await page.goto(url);
  await page.locator("#fileInput").setInputFiles(fixtures.slice(0, 2));
  await page.waitForFunction(() => !state.isLoading && state.images.length === 2);
  await page.locator("#durationInput").fill("1");
  await page.locator("#fpsInput").selectOption("24");
  return { context, page, errors, downloads };
}

async function testIphone(browser, url, fixtures) {
  const { context, page, errors, downloads } = await openPhone(browser, url, fixtures, IPHONE);
  try {
    await page.locator("#pngButton").tap();
    await page.waitForFunction(() => shareCalls.length === 1);
    const png = await page.evaluate(() => shareCalls[0]);
    assert.deepEqual(png.keys, ["files"], "Captions remove Save Image from the iPhone share sheet");
    assert.deepEqual([png.files[0].name, png.files[0].type], ["zoom-loop-frame.png", "image/png"]);
    assert.equal(await page.locator("#statusText").textContent(), "Saved");

    // The recording outlasts the tap that started it.
    await page.locator("#webmButton").tap();
    await page.waitForFunction(() => !state.isRecording && !state.exportController);
    assert.equal(await page.evaluate(() => shareCalls.length), 1);
    assert.equal(await page.locator("#saveExportButton").isVisible(), true);
    assert.equal(await page.locator("#saveExportButton").textContent(), "Save video");
    assert.match(await page.locator("#statusText").textContent(), /Video ready\. Tap Save video/);

    await page.evaluate(() => { shareMode = "cancel"; });
    await page.locator("#saveExportButton").tap();
    await page.waitForFunction(() => shareCalls.length === 2);
    assert.equal(await page.locator("#saveExportButton").isVisible(), true, "A cancelled save can be retried");
    assert.match(await page.locator("#statusText").textContent(), /Not saved/);

    await page.evaluate(() => { shareMode = "ok"; });
    await page.locator("#saveExportButton").tap();
    await page.waitForFunction(() => shareCalls.length === 3);
    const video = await page.evaluate(() => shareCalls[2]);
    assert.deepEqual(video.keys, ["files"]);
    assert.match(video.files[0].name, /^zoom-loop\.(mp4|webm)$/);
    assert.match(video.files[0].type, /^video\/(mp4|webm)$/, "Codec parameters hide Save Video on iPhone");
    assert.ok(video.files[0].size > 1000);
    assert.equal(await page.locator("#saveExportButton").isVisible(), false);
    assert.equal(await page.locator("#statusText").textContent(), "Saved");
    assert.deepEqual(downloads, [], "iPhone must save through the share sheet, not to Files");
    assert.deepEqual(errors, []);
    return { png: png.files[0].type, video: video.files[0].type, videoBytes: video.files[0].size };
  } finally {
    await context.close();
  }
}

async function testAndroid(browser, url, fixtures) {
  const { context, page, errors, downloads } = await openPhone(browser, url, fixtures, ANDROID);
  try {
    await page.locator("#pngButton").tap();
    await page.waitForFunction(() => statusText.textContent.includes("Gallery"));
    assert.match(await page.locator("#statusText").textContent(), /Saved zoom-loop-frame\.png to Downloads\. Find it in your Gallery's Download album\./);

    await page.locator("#webmButton").tap();
    await page.waitForFunction(() => !state.isRecording && !state.exportController);
    await page.waitForTimeout(200);
    assert.deepEqual(downloads, ["zoom-loop-frame.png", "zoom-loop.mp4"]);
    assert.equal(await page.evaluate(() => shareCalls.length), 0, "Android saves without opening the share sheet");
    assert.equal(await page.locator("#saveExportButton").textContent(), "Share video");
    assert.match(await page.locator("#statusText").textContent(), /Saved zoom-loop\.mp4 to Downloads.*Tap Share video to send it to an app\./);

    await page.locator("#saveExportButton").tap();
    await page.waitForFunction(() => shareCalls.length === 1);
    const shared = await page.evaluate(() => shareCalls[0]);
    assert.deepEqual(shared.keys, ["files"]);
    assert.deepEqual([shared.files[0].name, shared.files[0].type], ["zoom-loop.mp4", "video/mp4"]);
    assert.equal(await page.locator("#statusText").textContent(), "Shared");
    assert.equal(await page.locator("#saveExportButton").isVisible(), false);
    assert.deepEqual(errors, []);
    return { downloads, shared: shared.files[0].type };
  } finally {
    await context.close();
  }
}

module.exports = async function testMobileExport(browser, url, fixtures) {
  return { iphone: await testIphone(browser, url, fixtures), android: await testAndroid(browser, url, fixtures) };
};
