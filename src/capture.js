#!/usr/bin/env node
const { DEFAULT_DURATION_SECONDS, DEFAULT_URL, runCapture } = require("./capture-core");

function parseArgs(argv) {
  const options = {
    url: DEFAULT_URL,
    durationSeconds: DEFAULT_DURATION_SECONDS
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--url") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("Missing value for --url");
      }
      options.url = value;
      i += 1;
      continue;
    }
    if (arg === "--duration") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("Missing value for --duration");
      }
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("--duration must be a positive number.");
      }
      options.durationSeconds = parsed;
      i += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log("Usage:");
  console.log("  npm run capture -- --url <URL> --duration <seconds>");
  console.log("");
  console.log(`Defaults:`);
  console.log(`  --url ${DEFAULT_URL}`);
  console.log(`  --duration ${DEFAULT_DURATION_SECONDS}`);
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printHelp();
      return;
    }
    await runCapture(options);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}

main();
