const fs = require("fs");
const path = require("path");
const { execFileSync, spawn, spawnSync } = require("child_process");

const DEFAULT_URL = "https://www.udio.com/songs/qiexJ1taRtshxBfgtVUNtG";
const DEFAULT_DURATION_SECONDS = 45;
const OUTPUTS_DIR = path.resolve(__dirname, "..", "outputs");
const SILENCE_MAX_DB_THRESHOLD = -80;
const SILENCE_MEAN_DB_THRESHOLD = -55;

function getPlaywrightChromium() {
  try {
    return require("playwright").chromium;
  } catch (error) {
    throw new Error(
      "Playwright is missing. Run `npm install` and then `npm run install`."
    );
  }
}

function ensureMacOSOnly() {
  if (process.platform !== "darwin") {
    throw new Error("This app is macOS-only and requires AVFoundation.");
  }
}

function ensureOutputsDir(outputDir = OUTPUTS_DIR) {
  fs.mkdirSync(outputDir, { recursive: true });
}

function ensureBinaryInstalled(binary, installHint) {
  const result = spawnSync(binary, ["-version"], { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(`${binary} is missing. ${installHint}`);
  }
}

function detectBlackHoleDevice() {
  const result = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", ":"],
    { encoding: "utf8", timeout: 10000 }
  );

  if (result.error && result.error.code === "ETIMEDOUT") {
    throw new Error(
      "Timed out while listing AVFoundation devices with ffmpeg. Check your audio device setup."
    );
  }

  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  if (!output.includes("AVFoundation audio devices")) {
    throw new Error(
      "Unable to list AVFoundation audio devices. Check ffmpeg installation."
    );
  }

  let inAudioSection = false;
  const lines = output.split(/\r?\n/);
  for (const line of lines) {
    if (line.includes("AVFoundation video devices")) {
      inAudioSection = false;
      continue;
    }
    if (line.includes("AVFoundation audio devices")) {
      inAudioSection = true;
      continue;
    }
    if (!inAudioSection) {
      continue;
    }

    const match = line.match(/\[(\d+)\]\s+(.+)$/);
    if (!match) {
      continue;
    }

    const index = Number(match[1]);
    const name = match[2].trim();
    if (Number.isInteger(index) && /blackhole 2ch/i.test(name)) {
      return { index, name };
    }
  }

  throw new Error(
    "BlackHole 2ch not found in AVFoundation devices. Install BlackHole 2ch and set macOS output to a Multi-Output Device (Speakers + BlackHole 2ch)."
  );
}

function buildOutputPath(outputDir = OUTPUTS_DIR) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(outputDir, `udio_${timestamp}.wav`);
}

function getDefaultSystemOutputDeviceName() {
  const result = spawnSync("system_profiler", ["SPAudioDataType"], {
    encoding: "utf8"
  });
  if (result.error || result.status !== 0) {
    return null;
  }

  let currentDevice = null;
  const lines = (result.stdout || "").split(/\r?\n/);
  for (const line of lines) {
    const deviceMatch = line.match(/^\s{8}(.+):\s*$/);
    if (deviceMatch) {
      currentDevice = deviceMatch[1].trim();
      continue;
    }

    const isDefaultSystemOutput = /^\s{10}Default System Output Device:\s+Yes/.test(
      line
    );
    const isDefaultOutput = /^\s{10}Default Output Device:\s+Yes/.test(line);
    if ((isDefaultSystemOutput || isDefaultOutput) && currentDevice) {
      return currentDevice;
    }
  }

  return null;
}

async function waitForPlayerControl(page, keyword, timeoutMs = 30000) {
  const lowerKeyword = keyword.toLowerCase();
  await page.waitForFunction(
    (kw) => {
      const nodes = Array.from(
        document.querySelectorAll("button, [role='button']")
      );
      return nodes.some((node) => {
        const aria = (node.getAttribute("aria-label") || "").toLowerCase();
        const title = (node.getAttribute("title") || "").toLowerCase();
        const text = (node.textContent || "").toLowerCase();
        return aria.includes(kw) || title.includes(kw) || text.includes(kw);
      });
    },
    lowerKeyword,
    { timeout: timeoutMs }
  );
}

async function assertUdioBrowserSupported(page) {
  const unsupported = await page.evaluate(() => {
    const text = document.body ? document.body.innerText || "" : "";
    return /Audio playback is unsupported in this browser/i.test(text);
  });
  if (unsupported) {
    throw new Error(
      'Udio reports this browser as unsupported for audio playback. Install/use regular Google Chrome and retry.'
    );
  }
}

async function dismissCommonOverlays(page) {
  await page.evaluate(() => {
    const candidates = Array.from(
      document.querySelectorAll("button, [role='button']")
    );
    const patterns = [/accept all/i, /decline all/i, /close/i];
    const isVisible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none"
      );
    };

    for (const node of candidates) {
      if (!isVisible(node)) {
        continue;
      }
      const label = [
        node.getAttribute("aria-label") || "",
        node.getAttribute("title") || "",
        node.textContent || ""
      ].join(" ");
      if (patterns.some((re) => re.test(label))) {
        node.click();
      }
    }
  });
}

async function waitForPlaybackStart(page, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await page.evaluate(() => {
      const text = document.body ? document.body.innerText || "" : "";
      const unsupported = /Audio playback is unsupported in this browser/i.test(
        text
      );
      const audios = Array.from(document.querySelectorAll("audio")).map(
        (audio) => ({
          paused: audio.paused,
          currentTime: audio.currentTime,
          readyState: audio.readyState,
          hasSrc: Boolean(audio.currentSrc || audio.src)
        })
      );
      const hasProgressingAudio = audios.some(
        (audio) => !audio.paused && audio.currentTime > 0.3
      );
      return { unsupported, hasProgressingAudio, audios };
    });

    if (state.unsupported) {
      throw new Error(
        "Udio reports this browser as unsupported for audio playback."
      );
    }
    if (state.hasProgressingAudio) {
      return;
    }
    await page.waitForTimeout(500);
  }

  throw new Error(
    "Playback did not start (audio never advanced). Ensure the song is playable in Chrome and retry."
  );
}

async function clickPlayerControl(page, keyword) {
  const lowerKeyword = keyword.toLowerCase();
  const clicked = await page.evaluate((kw) => {
    const nodes = Array.from(
      document.querySelectorAll("button, [role='button']")
    );
    const isVisible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none"
      );
    };
    const isDisabled = (el) =>
      Boolean(el.disabled) || el.getAttribute("aria-disabled") === "true";

    for (const node of nodes) {
      const aria = (node.getAttribute("aria-label") || "").toLowerCase();
      const title = (node.getAttribute("title") || "").toLowerCase();
      const text = (node.textContent || "").toLowerCase();
      const matches =
        aria.includes(kw) || title.includes(kw) || text.includes(kw);
      if (matches && isVisible(node) && !isDisabled(node)) {
        node.click();
        return true;
      }
    }
    return false;
  }, lowerKeyword);

  if (!clicked) {
    throw new Error(`Could not click "${keyword}" control.`);
  }
}

async function startPlaybackWithRetries(page, logger, attempts = 3) {
  const actions = [
    { label: 'click "Play"', run: () => clickPlayerControl(page, "play") },
    {
      label: 'click "Play/Pause"',
      run: () => clickPlayerControl(page, "play/pause")
    },
    { label: "press Space", run: () => page.keyboard.press("Space") }
  ];

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    for (const action of actions) {
      try {
        await dismissCommonOverlays(page);
        await action.run();
        await waitForPlaybackStart(page, 6000);
        return;
      } catch (error) {
        lastError = error;
        logger(
          `Playback start retry ${attempt}/${attempts} failed (${action.label}).`
        );
        await page.waitForTimeout(500);
      }
    }
  }

  throw new Error(
    `Playback did not start after retries. ${lastError ? lastError.message : ""}`.trim()
  );
}

function recordWithFfmpeg({ audioIndex, durationSeconds, outputPath }) {
  return new Promise((resolve, reject) => {
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-use_wallclock_as_timestamps",
      "1",
      "-f",
      "avfoundation",
      "-i",
      `:${audioIndex}`,
      "-t",
      String(durationSeconds),
      "-af",
      "aresample=async=1:first_pts=0",
      "-ac",
      "2",
      "-ar",
      "44100",
      "-c:a",
      "pcm_s16le",
      outputPath
    ];

    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", (error) => {
      reject(new Error(`Failed to start ffmpeg: ${error.message}`));
    });
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `ffmpeg recording failed with exit code ${code}. ${stderr.trim()}`
        )
      );
    });
  });
}

function probeDurationSeconds(filePath) {
  const output = execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath
    ],
    { encoding: "utf8" }
  ).trim();
  const duration = Number(output);
  if (!Number.isFinite(duration)) {
    throw new Error(`Unable to parse ffprobe duration: "${output}"`);
  }
  return duration;
}

function probeAudioLevels(filePath) {
  const result = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-i", filePath, "-af", "volumedetect", "-f", "null", "-"],
    { encoding: "utf8" }
  );
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  const maxMatch = output.match(/max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/i);
  const meanMatch = output.match(/mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/i);
  if (!maxMatch || !meanMatch) {
    throw new Error("Unable to determine max volume from recorded file.");
  }

  const maxVolumeDb = Number(maxMatch[1]);
  const meanVolumeDb = Number(meanMatch[1]);
  if (!Number.isFinite(maxVolumeDb) || !Number.isFinite(meanVolumeDb)) {
    throw new Error(
      `Unable to parse volume metrics (mean="${meanMatch[1]}", max="${maxMatch[1]}").`
    );
  }
  return { meanVolumeDb, maxVolumeDb };
}

function isLikelySilent({ meanVolumeDb, maxVolumeDb }) {
  return (
    maxVolumeDb <= SILENCE_MAX_DB_THRESHOLD ||
    meanVolumeDb <= SILENCE_MEAN_DB_THRESHOLD
  );
}

async function runCapture({
  url = DEFAULT_URL,
  durationSeconds = DEFAULT_DURATION_SECONDS,
  outputDir = OUTPUTS_DIR,
  logger = console.log
} = {}) {
  ensureMacOSOnly();
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("Duration must be a positive number of seconds.");
  }

  ensureOutputsDir(outputDir);
  ensureBinaryInstalled("ffmpeg", "Install with: brew install ffmpeg");

  const device = detectBlackHoleDevice();
  const outputPath = buildOutputPath(outputDir);
  const chromium = getPlaywrightChromium();

  logger("Launching browser (Google Chrome)...");
  let browser;
  let page;

  try {
    try {
      browser = await chromium.launch({
        channel: "chrome",
        headless: false,
        ignoreDefaultArgs: [
          "--disable-background-networking",
          "--disable-component-update"
        ],
        args: ["--autoplay-policy=no-user-gesture-required"]
      });
    } catch (error) {
      throw new Error(
        `Playwright failed to launch Google Chrome. Install Chrome, then retry. ${error.message}`
      );
    }

    const context = await browser.newContext();
    page = await context.newPage();

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    } catch (error) {
      throw new Error(`Udio page didn't load: ${error.message}`);
    }
    await assertUdioBrowserSupported(page);

    try {
      await waitForPlayerControl(page, "play", 30000);
    } catch (error) {
      throw new Error(
        "Play button not found. Ensure the URL is valid and the Udio player is visible."
      );
    }

    logger("Starting playback...");
    await startPlaybackWithRetries(page, logger);

    logger(`Recording from device: ${device.name} (index ${device.index})`);
    await recordWithFfmpeg({
      audioIndex: device.index,
      durationSeconds,
      outputPath
    });

    const levels = probeAudioLevels(outputPath);
    if (isLikelySilent(levels)) {
      const defaultOutput = getDefaultSystemOutputDeviceName();
      try {
        fs.unlinkSync(outputPath);
      } catch (error) {
        // Ignore cleanup failures.
      }
      const outputHint = defaultOutput
        ? ` Current default system output device is "${defaultOutput}".`
        : "";
      throw new Error(
        `Recorded output is silent/near-silent (mean ${levels.meanVolumeDb.toFixed(
          1
        )} dB, max ${levels.maxVolumeDb.toFixed(
          1
        )} dB).${outputHint} Set macOS output to a Multi-Output Device that includes BlackHole 2ch and retry.`
      );
    }

    logger(`Saved: ${outputPath}`);
    return outputPath;
  } finally {
    if (page) {
      try {
        await clickPlayerControl(page, "pause");
      } catch (error) {
        // Ignore pause failures during cleanup.
      }
    }
    if (browser) {
      await browser.close();
    }
  }
}

module.exports = {
  DEFAULT_DURATION_SECONDS,
  DEFAULT_URL,
  OUTPUTS_DIR,
  ensureBinaryInstalled,
  ensureOutputsDir,
  probeDurationSeconds,
  probeAudioLevels,
  isLikelySilent,
  runCapture
};
