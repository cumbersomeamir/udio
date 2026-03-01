#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const {
  DEFAULT_URL,
  OUTPUTS_DIR,
  ensureBinaryInstalled,
  ensureOutputsDir,
  isLikelySilent,
  probeAudioLevels,
  probeDurationSeconds,
  runCapture
} = require("./capture-core");

async function main() {
  try {
    ensureOutputsDir(OUTPUTS_DIR);
    ensureBinaryInstalled("ffprobe", "Install with: brew install ffmpeg");

    const outputPath = await runCapture({
      url: DEFAULT_URL,
      durationSeconds: 6
    });

    if (!fs.existsSync(outputPath)) {
      throw new Error(`Output file was not created: ${outputPath}`);
    }

    const stats = fs.statSync(outputPath);
    if (stats.size <= 0) {
      throw new Error(`Output file is empty: ${outputPath}`);
    }

    const duration = probeDurationSeconds(outputPath);
    if (duration < 4.5) {
      throw new Error(
        `Recorded duration too short (${duration.toFixed(3)}s). Expected at least 4.5s.`
      );
    }

    const levels = probeAudioLevels(outputPath);
    if (isLikelySilent(levels)) {
      throw new Error(
        `Recorded file is silent/near-silent (mean ${levels.meanVolumeDb.toFixed(
          1
        )} dB, max ${levels.maxVolumeDb.toFixed(1)} dB).`
      );
    }

    console.log(
      `PASS (${path.basename(outputPath)}, ${duration.toFixed(
        2
      )}s, mean ${levels.meanVolumeDb.toFixed(1)} dB, max ${levels.maxVolumeDb.toFixed(1)} dB)`
    );
  } catch (error) {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}

main();
