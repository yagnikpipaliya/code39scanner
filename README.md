# code39-scanner

Zero-dependency **Code 39** barcode scanner for the browser, written in TypeScript and shipped as
plain ES modules. It opens the device camera, decodes frames in real time and emits each barcode
as it comes into view. The decoding pipeline is also usable on its own for any image source.

- **No runtime dependencies**: the decoder, image processing and camera handling are all implemented here.
- **Standard Code 39** (43 characters) plus optional **Full ASCII** (all 128 ASCII characters).
- **Robust decoding**: local adaptive thresholding for uneven lighting, sub-pixel edge detection,
  tolerance for blur, print gain and perspective. It reads in both directions (upside-down) and in
  both orientations (horizontal/vertical), and requires agreement across multiple scanlines to
  suppress false positives.
- **Camera lifecycle handled**: rear-camera preference, camera switching, serialized start/stop,
  a paused loop in background tabs, and typed errors for every failure mode.
- Fully typed (`.d.ts`), tree-shakeable (`sideEffects: false`), unit tested.

**Live demo:** deploy with the steps in [Deploying to Vercel](#deploying-to-vercel).

---

## Quick start

```html
<video id="preview" playsinline muted></video>
<ul id="results"></ul>
```

```js
import { Code39Scanner } from 'code39-scanner';

const scanner = new Code39Scanner({ video: document.getElementById('preview') });

scanner.on('detect', ({ text, timestamp }) => {
  const item = document.createElement('li');
  item.textContent = `${text} (${new Date(timestamp).toLocaleTimeString()})`;
  document.getElementById('results').prepend(item);
});

scanner.on('error', (error) => console.error(error));

// Must be called from a user gesture (e.g. a click) on iOS.
await scanner.start();
```

Camera access requires a **secure context**: `https://` or `http://localhost`.

## Installation

The package is not published to npm yet. Install it from a local checkout or a Git URL:

```bash
npm install ../path/to/code39-scanner     # local folder
npm install github:<user>/<repo>          # Git repository (the "prepare" script builds dist/)
```

For local folders, run `npm run build:lib` in this repository first so `dist/` exists.

## API

### `new Code39Scanner(options)`

| Option              | Type                             | Default | Description                                                                    |
| ------------------- | -------------------------------- | ------- | ------------------------------------------------------------------------------ |
| `video`             | `HTMLVideoElement`               | —       | Element that shows the camera preview. Required unless `frameSource` is given. |
| `frameSource`       | `FrameSource`                    | camera  | Custom frame provider (tests, canvas, video files, …).                         |
| `fullAscii`         | `boolean`                        | `false` | Expand Full ASCII shift sequences (`+A` → `a`, `%U` → NUL, …).                 |
| `minLength`         | `number`                         | `1`     | Minimum number of data characters.                                             |
| `minQuietZone`      | `number`                         | `5`     | Required blank margin on each side, in narrow-element widths (spec: 10).       |
| `scanLines`         | `number`                         | `24`    | Scanlines sampled per orientation per frame.                                   |
| `orientations`      | `('horizontal' \| 'vertical')[]` | both    | Scan directions.                                                               |
| `minConfirmations`  | `number`                         | `2`     | Scanlines that must agree before a value is reported.                          |
| `scanIntervalMs`    | `number`                         | `100`   | Minimum delay between frame decodes.                                           |
| `presenceTimeoutMs` | `number`                         | `1500`  | A barcode is reported again only after being out of view this long.            |
| `maxFrameSize`      | `number`                         | `1920`  | Frames are downscaled so their longest side is at most this many pixels.       |

Invalid options throw `InvalidOptionsError` immediately.

| Member                                     | Description                                                                                    |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `start({ deviceId? }): Promise<void>`      | Starts the camera (rear camera preferred) and scanning. No-op if already scanning that device. |
| `switchCamera(deviceId): Promise<void>`    | Restarts on another camera.                                                                    |
| `stop(): Promise<void>`                    | Stops scanning and releases the camera.                                                        |
| `dispose(): Promise<void>`                 | `stop()` and remove all listeners.                                                             |
| `on(type, listener): () => void` / `off()` | Subscribe to events; `on` returns an unsubscribe function.                                     |
| `state`                                    | `'idle' \| 'starting' \| 'scanning'`.                                                          |
| `activeDeviceId`                           | Device id of the camera in use.                                                                |
| `Code39Scanner.isSupported()`              | Whether the browser supports camera access.                                                    |
| `Code39Scanner.listCameras()`              | Video input devices. Labels and ids are available only after permission was granted.           |

Lifecycle calls are serialized, so overlapping calls (double clicks, rapid camera switches) are safe.

**Events**

| Event         | Payload                                                         |
| ------------- | --------------------------------------------------------------- |
| `detect`      | `ScanResult`: `{ text, rawText, format: 'CODE_39', timestamp }` |
| `error`       | `Error` raised while scanning (e.g. camera disconnected)        |
| `statechange` | `ScannerState`                                                  |

A barcode that stays in view is reported **once**. It is reported again after it has been out of
view for `presenceTimeoutMs`, so re-scanning the same item logs it again.

### Decoding without the camera

```js
import { decodeImage, Code39ImageDecoder } from 'code39-scanner';

const imageData = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
decodeImage(imageData); // → { text, rawText, format } | null

const decoder = new Code39ImageDecoder({ fullAscii: true }); // reuse for many images
decoder.decodeAll(imageData); // all barcodes in the image
```

Lower-level building blocks are exported for custom pipelines: `binarizeLine` (luminance line →
run-lengths), `Code39WidthDecoder` (run-lengths → text), `expandFullAscii`, `toGrayscale`,
`PresenceTracker` and `CameraFrameSource`.

### Errors

All errors extend `Code39ScannerError`:

| Error                     | When                                               |
| ------------------------- | -------------------------------------------------- |
| `InvalidOptionsError`     | Invalid configuration.                             |
| `InsecureContextError`    | Page not served over HTTPS/localhost.              |
| `UnsupportedBrowserError` | No `getUserMedia` / canvas support.                |
| `PermissionDeniedError`   | The user or browser policy denied camera access.   |
| `CameraUnavailableError`  | No camera found, camera busy, or the stream ended. |

## How it works

```
camera frame ─► scanlines (center-out, both orientations) ─► luminance of that line only
   ─► binarize: smoothing + local min/max threshold + sub-pixel edges ─► bar/space run-lengths
   ─► width decoder: 9-element windows → 3 widest = wide → pattern lookup,
      start/stop "*", quiet zones, gap and width-consistency checks, both directions
   ─► vote across scanlines (minConfirmations) ─► presence tracker ─► "detect" event
```

- `src/core`: symbology table (single source of truth), width decoder, Full ASCII.
- `src/image`: luminance sources, scanline binarizer, image decoder.
- `src/camera`: `FrameSource` abstraction, camera implementation, presence tracker, scanner facade.

**Limits.** Narrow bars should be at least about **1.5 px** wide in the camera frame. Below that,
the pixels can't resolve a narrow space between two bars. Move closer for small or dense
barcodes. Mod 43 check characters are not validated; they are returned as part of the data.

## Demo site

`demo/` is a framework-free page (HTML/CSS/vanilla JS) built on this package. It has start/stop,
a camera picker, a live list of scans with copy and clear actions, and history kept in
`localStorage`.

## Development

Requires Node.js 20.19+ (for Vite).

| Script                  | Purpose                                                 |
| ----------------------- | ------------------------------------------------------- |
| `npm run dev`           | Demo dev server (uses the TypeScript sources directly). |
| `npm test`              | Unit tests (Vitest).                                    |
| `npm run test:coverage` | Tests with coverage thresholds.                         |
| `npm run lint`          | ESLint.                                                 |
| `npm run typecheck`     | TypeScript, no emit.                                    |
| `npm run build`         | Library → `dist/`, then demo → `dist-demo/`.            |
| `npm run preview`       | Serve the built demo.                                   |

The production demo build imports the **compiled** `dist/` output, just as an npm consumer would.

To test on a phone during development, the page must be served over HTTPS (for example through a
tunnel), because mobile browsers block the camera on plain-HTTP LAN addresses.

## Deploying to Vercel

`vercel.json` already sets the install command, build command, output directory (`dist-demo`) and
security headers (including `Permissions-Policy: camera=(self)`).

**Option A: Git import (recommended)**

1. Push this repository to GitHub, GitLab or Bitbucket.
2. In Vercel, choose **Add New… → Project** and import the repository.
3. Keep the detected settings (they come from `vercel.json`) and click **Deploy**.

**Option B: CLI**

```bash
npx vercel login
npx vercel          # preview deployment
npx vercel --prod   # production deployment
```

Vercel serves over HTTPS, so the camera works on desktop and mobile.

## Project structure

```
src/            library (TypeScript)
  core/         symbology, width decoder, Full ASCII
  image/        luminance, binarizer, image decoder
  camera/       frame source, camera source, presence tracker, scanner
demo/           Vercel demo site (vanilla JS)
tests/          Vitest unit tests + synthetic barcode renderer
```
