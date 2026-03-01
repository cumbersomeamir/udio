# Udio System Audio Capture (macOS)

Small macOS-only CLI app that captures audio of your **own** Udio song by recording system output through `BlackHole 2ch`.

## Requirements

- macOS
- Node.js 18+
- Google Chrome installed
- Homebrew `ffmpeg` (includes `ffprobe`)
- `BlackHole 2ch` installed
- macOS Sound Output set to a **Multi-Output Device** that includes:
  - your speakers/headphones
  - `BlackHole 2ch`

## Setup

1. Install ffmpeg:

```bash
brew install ffmpeg
```

2. Install BlackHole 2ch:
   - Install from [Existential Audio](https://existential.audio/blackhole/) or Homebrew cask.

3. In macOS Audio MIDI Setup:
   - Create/select a Multi-Output Device with Speakers + BlackHole 2ch.
   - Set macOS output to that Multi-Output Device.

4. Install Node dependencies and Playwright Chromium:

```bash
npm install
npm run install
```

## Capture command

Default URL:

`https://www.udio.com/songs/qiexJ1taRtshxBfgtVUNtG`

Run capture:

```bash
npm run capture -- --url https://www.udio.com/songs/qiexJ1taRtshxBfgtVUNtG --duration 45
```

- Creates `outputs/` automatically if missing.
- Writes WAV file as `outputs/udio_<timestamp>.wav`.
- Format: stereo, 44.1kHz, PCM (`pcm_s16le`).

## Self-test

```bash
npm test
```

The test will:
1. Create `outputs/` if missing
2. Run a short 6-second capture against the default URL
3. Verify output file exists and is non-empty
4. Verify duration with `ffprobe` is at least 4.5 seconds
5. Verify the capture is not silent/near-silent (mean + max level check)
6. Print `PASS` or a failure reason

## Expected logs

- `Launching browser (Google Chrome)...`
- `Starting playback...`
- `Recording from device: BlackHole 2ch (...)`
- `Saved: ...`

## Troubleshooting

- `ffmpeg is missing`: run `brew install ffmpeg`
- `BlackHole 2ch not found`: install BlackHole 2ch and ensure it appears in AVFoundation devices
- `Playwright is missing` or launch error: run `npm install` and `npm run install`
- `Udio reports unsupported browser`: use regular Google Chrome (not Chrome for Testing)
- `Udio page didn't load`: check URL/network and retry
- `Play button not found`: ensure the page/player loaded fully and content is playable
- `Playback did not start after retries`: confirm the song plays in your regular Chrome window first, then rerun
- `Recorded output is silent/near-silent`: make sure macOS output is the Multi-Output Device (Speakers + BlackHole 2ch), not only MacBook Speakers

## Notes

- This tool records system output only.
- It does not scrape Udio stream URLs, tokens, blobs, or bypass playback.
# udio
