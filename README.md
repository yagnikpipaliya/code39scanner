# code39-scanner

Zero-dependency **Code 39** barcode scanning for the browser: live camera scanning and still-image
decoding, written in TypeScript and shipped as standard ES modules with type definitions.

**[Live demo](https://code39scanner.vercel.app/)** · [Quick start](#quick-start) ·
[API reference](#api-reference) · [How it works](#how-it-works) · [Development](#development)

## Table of contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Usage](#usage)
- [API reference](#api-reference)
- [How it works](#how-it-works)
- [Limitations](#limitations)
- [Development](#development)
- [Deployment](#deployment)
- [License](#license)

## Features

- **Zero runtime dependencies.** Image processing, decoding and camera handling are implemented
  in this package.
- **Standard Code 39** (43 characters) and optional **Full ASCII** (all 128 ASCII characters).
- **Robust decoding.** Local adaptive thresholding (uneven lighting, shadows), sub-pixel edge
  detection (low resolution, blur), tolerance for print gain and perspective. It reads barcodes
  upside-down and in either orientation, and finds several barcodes per frame.
- **No false positives from look-alike patterns.** A value is reported only when independent
  scanlines, spaced according to the Code 39 minimum bar height, agree on it.
- **Efficient.** Each camera frame is drawn once and only the sampled scanlines are read back.
- **Production-grade lifecycle.** Rear-camera preference, camera switching, serialized and
  cancellable start/stop, pausing in background tabs, and automatic shutdown on unrecoverable
  errors.
- **Typed errors.** Every error carries a stable, machine-readable `code`.
- Fully typed, tree-shakeable (`sideEffects: false`), and covered by unit tests.

## Requirements

- A **secure context**: `https://` or `http://localhost`. Browsers only allow camera access
  there.
- A browser with `getUserMedia` and Canvas 2D. The library targets ES2022 and uses private
  class methods, which means Chrome/Edge 84+, Firefox 90+ or Safari 15+.
- Node.js 20.19+ for development only.

## Installation

The package is not yet published to npm. Install it from Git or a local checkout:

```bash
npm install github:yagnikpipaliya/code39scanner   # builds dist/ through the "prepare" script
npm install ../path/to/code39scanner              # local folder; run `npm run build:lib` there first
```

## Quick start

```html
<video id="preview" playsinline muted></video>
<button id="start">Start scanning</button>
<ul id="results"></ul>
```

```js
import { Code39Scanner, ScannerEvent } from 'code39-scanner';

const scanner = new Code39Scanner({ video: document.getElementById('preview') });

scanner.on(ScannerEvent.Detect, ({ text }) => {
  const item = document.createElement('li');
  item.textContent = text;
  document.getElementById('results').prepend(item);
});

// Camera access must start from a user gesture on iOS.
document.getElementById('start').addEventListener('click', () => scanner.start());
```

## Usage

### Live camera scanning

Each barcode is reported **once per appearance**. A barcode that stays in view is not repeated.
If it leaves the view for longer than `presenceTimeoutMs` and returns, it is reported again.

```js
const scanner = new Code39Scanner({
  video: document.getElementById('preview'),
  fullAscii: true, // expand +A → a, %U → NUL, …
  minLength: 4, // ignore very short payloads
});

scanner.on(ScannerEvent.Detect, ({ text, rawText, timestamp }) => {
  console.log(text, new Date(timestamp));
});
scanner.on(ScannerEvent.StateChange, (state) => {
  console.log('Scanner is', state); // 'idle' | 'starting' | 'scanning'
});
```

When the owning view goes away (for example when a component unmounts), call `dispose()`. It
detaches all listeners immediately, releases the camera, and cancels a `start()` still waiting
on the permission prompt:

```js
const scanner = new Code39Scanner({ video });
scanner.start().catch(handleStartError);
// …later
await scanner.dispose();
```

### Choosing a camera

Browsers reveal camera ids and labels only after permission has been granted, so list cameras
after the first successful `start()`:

```js
await scanner.start(); // rear camera preferred
const cameras = await Code39Scanner.listCameras(); // [{ deviceId, label }]
await scanner.switchCamera(cameras[1].deviceId);
```

### Decoding still images

```js
import { Code39ImageDecoder, decodeImage } from 'code39-scanner';

const imageData = context.getImageData(0, 0, canvas.width, canvas.height);

decodeImage(imageData); // → { text, rawText, format } | null

const decoder = new Code39ImageDecoder({ fullAscii: true }); // reuse for many images
decoder.decodeAll(imageData); // → every barcode in the image
```

### Handling errors

Every error thrown or emitted by the package extends `Code39ScannerError` and has a stable
`code`. Branch on the code, not on the message or the class name:

```js
import { Code39ScannerError, ErrorCode, ScannerEvent } from 'code39-scanner';

try {
  await scanner.start();
} catch (error) {
  if (!(error instanceof Code39ScannerError)) throw error;
  switch (error.code) {
    case ErrorCode.OperationCancelled:
      break; // stop() or dispose() was called while starting; nothing to report
    case ErrorCode.PermissionDenied:
      showMessage('Please allow camera access.');
      break;
    default:
      showMessage(error.message);
  }
}

// Failures while scanning (e.g. the camera was unplugged).
scanner.on(ScannerEvent.Error, (error) => showMessage(`${error.code}: ${error.message}`));
```

## API reference

### `Code39Scanner`

```ts
new Code39Scanner(options: Code39ScannerOptions)
```

| Option              | Type                | Default | Description                                                                      |
| ------------------- | ------------------- | ------- | -------------------------------------------------------------------------------- |
| `video`             | `HTMLVideoElement`  | —       | Element showing the camera preview. Required unless `frameSource` is given.      |
| `frameSource`       | `FrameSource`       | camera  | Custom frame provider that replaces the built-in camera.                         |
| `fullAscii`         | `boolean`           | `false` | Expand Full ASCII shift sequences. See [Full ASCII](#full-ascii).                |
| `minLength`         | `number`            | `1`     | Minimum number of data characters.                                               |
| `minQuietZone`      | `number`            | `5`     | Required blank margin on each side, in narrow-bar widths (the spec requires 10). |
| `scanLines`         | `number`            | `24`    | Primary scanlines sampled per orientation per frame.                             |
| `orientations`      | `ScanOrientation[]` | both    | Scan directions.                                                                 |
| `minConfirmations`  | `number`            | `2`     | Independent scanlines that must agree before a value is reported.                |
| `scanIntervalMs`    | `number`            | `100`   | Minimum delay between frame decodes.                                             |
| `presenceTimeoutMs` | `number`            | `1500`  | Time a barcode must be out of view before it is reported again.                  |
| `maxFrameSize`      | `number`            | `1920`  | Frames are downscaled so their longest side is at most this many pixels.         |

Invalid options throw `InvalidOptionsError` from the constructor.

| Member                                  | Description                                                                                                |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `start({ deviceId? }): Promise<void>`   | Opens the camera (rear preferred) and starts scanning. No-op when already scanning that camera.            |
| `switchCamera(deviceId): Promise<void>` | Restarts on another camera. The state goes `scanning → starting → scanning`.                               |
| `stop(): Promise<void>`                 | Stops scanning and releases the camera immediately. A pending `start()` rejects with `OperationCancelled`. |
| `dispose(): Promise<void>`              | Detaches all listeners, then stops.                                                                        |
| `on(event, listener): () => void`       | Subscribes to an event and returns an unsubscribe function. `off(event, listener)` also unsubscribes.      |
| `state: ScannerState`                   | `'idle'`, `'starting'` or `'scanning'`.                                                                    |
| `activeDeviceId: string \| undefined`   | Device id of the camera in use.                                                                            |
| `Code39Scanner.isSupported()`           | Whether the browser supports camera scanning (camera API and Canvas 2D).                                   |
| `Code39Scanner.listCameras()`           | Available cameras as `{ deviceId, label }`.                                                                |

Lifecycle calls are serialized, so overlapping calls such as double clicks are safe.

| Event                      | Payload                                              |
| -------------------------- | ---------------------------------------------------- |
| `ScannerEvent.Detect`      | `ScanResult`: `{ text, rawText, format, timestamp }` |
| `ScannerEvent.Error`       | `Code39ScannerError` raised while scanning           |
| `ScannerEvent.StateChange` | `ScannerState`                                       |

**Failure policy.** A frame that fails for an unexpected reason is reported as a
`FrameProcessingError` (the original error is its `cause`), and scanning continues. Scanning stops
automatically in two cases: the error cannot be fixed by retrying (unsupported browser, camera
unavailable or disconnected), or 5 frames in a row fail. The failure is reported once in either
case. Timing uses a monotonic clock, so changes to the system time cannot cause duplicate or
missed reports.

### `Code39ImageDecoder` and `decodeImage`

```ts
new Code39ImageDecoder(options?: ImageDecodeOptions)
decoder.decode(input: ImageInput, pass?: ScanPassOptions): DecodedBarcode | null
decoder.decodeAll(input: ImageInput, pass?: ScanPassOptions): DecodedBarcode[]
decodeImage(input: ImageInput, options?: ImageDecodeOptions): DecodedBarcode | null
```

`ImageDecodeOptions` is the decoding subset of the scanner options: `fullAscii`, `minLength`,
`minQuietZone`, `scanLines`, `orientations` and `minConfirmations`. `ScanPassOptions.linePhase`
(0–1, default `0.5`) shifts the sampled lines within their band. Varying it between calls sweeps
the whole image, which is what the live scanner does.

`DecodedBarcode` is `{ text, rawText, format }`: `text` is the decoded payload, `rawText` the
payload as encoded (without the `*` start/stop characters), and `format` is `'CODE_39'`.

#### Full ASCII

With `fullAscii: true`, shift pairs such as `+A` (`a`), `$M` (carriage return) and `%U` (NUL) are
expanded. Expansion applies to the payload as a whole. If any shift sequence in the payload is
invalid, the payload is not Full ASCII, and `text` is the unmodified `rawText`. For example,
`12/34-A` stays `12/34-A`.

### Image input

`ImageInput` is either an RGBA image (`{ width, height, data }` with 4 bytes per pixel, such as
`ImageData`) or a `LuminanceSource`:

```ts
interface LuminanceSource {
  readonly width: number;
  readonly height: number;
  row(y: number): Uint8Array; // luminance of one row
  column(x: number): Uint8Array; // luminance of one column
}
```

A `LuminanceSource` lets the decoder read only the lines it samples, without copying whole
frames. `luminanceFromRgba(image)` and `luminanceFromGray(image)` adapt in-memory images. Use
`luminanceFromGray` for single-channel images. Invalid input throws `InvalidArgumentError`
immediately.

### Enums

Enums are frozen objects paired with a union type of the same name, not TypeScript `enum`s.
They compile to plain JavaScript, are tree-shakeable, and their values are ordinary strings
(`ScannerState.Idle === 'idle'`).

| Enum              | Members                          |
| ----------------- | -------------------------------- |
| `ScannerState`    | `Idle`, `Starting`, `Scanning`   |
| `ScannerEvent`    | `Detect`, `Error`, `StateChange` |
| `ScanOrientation` | `Horizontal`, `Vertical`         |
| `BarcodeFormat`   | `Code39`                         |
| `ErrorCode`       | See [Errors](#errors)            |

### Errors

| Class                     | `code`                    | Raised when                                                      |
| ------------------------- | ------------------------- | ---------------------------------------------------------------- |
| `InvalidOptionsError`     | `INVALID_OPTIONS`         | A constructor receives invalid options.                          |
| `InvalidArgumentError`    | `INVALID_ARGUMENT`        | A method receives invalid input (image, listener, device id).    |
| `InsecureContextError`    | `INSECURE_CONTEXT`        | The page is not served over HTTPS or localhost.                  |
| `UnsupportedBrowserError` | `UNSUPPORTED_BROWSER`     | The camera API or Canvas 2D is unavailable.                      |
| `PermissionDeniedError`   | `PERMISSION_DENIED`       | The user or a browser policy denied camera access.               |
| `CameraUnavailableError`  | `CAMERA_UNAVAILABLE`      | No camera was found, the camera is busy, or the stream ended.    |
| `OperationCancelledError` | `OPERATION_CANCELLED`     | A start was cancelled by a later `stop()`, `dispose()` or start. |
| `FrameProcessingError`    | `FRAME_PROCESSING_FAILED` | A camera frame could not be processed (see `cause`).             |

All of them extend `Code39ScannerError`, and every `name` is a string literal, so it is not
changed by minification.

### Building blocks

For custom pipelines the package also exports:

- `binarizeLine`: turns a luminance line into bar/space widths.
- `Code39WidthDecoder`: turns bar/space widths into text; `decodeSymbols` also returns each symbol's position on the line.
- `expandFullAscii`, `toGrayscale` and `toLuminanceSource`.
- `PresenceTracker`: the once-per-appearance logic.
- `CameraFrameSource`: the camera implementation of `FrameSource`.

## How it works

```
camera frame ──► drawn once to a canvas
             ──► primary scanlines, center-out, in both orientations
                 (their position shifts every frame, sweeping the whole image)
             ──► per line: luminance ─► adaptive threshold ─► sub-pixel bar/space widths
             ──► width decoder: characters, start/stop "*", quiet zones, both directions
             ──► confirmation by independent scanlines ─► presence tracker ─► Detect event
```

**Confirmation.** ISO/IEC 16388 requires Code 39 bars to be at least 15% of the symbol length
tall. Two scanlines count as independent confirmations only when they are at least a third of
that distance apart. When a line decodes a value, the decoder probes lines at that distance, so
a short barcode crossed by a single sampled line still confirms. A pattern that decodes only on
a few adjacent pixel rows, such as text or a texture, never does.

**Source layout.** `src/core` holds the symbology table, width decoder and Full ASCII.
`src/image` holds luminance sources, the binarizer and the image decoder. `src/camera` holds the
frame source abstraction, camera implementation, presence tracker and scanner.

## Limitations

- Narrow bars must be at least about **1.5 px** wide in the camera frame. Move closer for small or
  dense barcodes.
- Bars shorter than about 5% of the symbol length (a third of the spec minimum) are not
  confirmed.
- Mod 43 check characters are not validated; they are returned as part of the data.
- Only Code 39 is supported.

## Development

```bash
npm install
npm run dev        # demo at http://localhost:5173 (uses the TypeScript sources)
```

| Script                  | Purpose                                            |
| ----------------------- | -------------------------------------------------- |
| `npm test`              | Unit tests (Vitest)                                |
| `npm run test:coverage` | Tests with coverage thresholds                     |
| `npm run typecheck`     | Type-check the library, tests and the demo's JSDoc |
| `npm run lint`          | ESLint                                             |
| `npm run format`        | Prettier                                           |
| `npm run build`         | Library to `dist/`, then the demo to `dist-demo/`  |
| `npm run preview`       | Serve the production demo build                    |

The production demo imports the compiled `dist/` output, the same way an npm consumer does.
Mobile browsers block the camera on plain-HTTP LAN addresses, so to test on a phone during
development, serve the page over HTTPS (for example through a tunnel).

```
src/        library
  core/     symbology, width decoder, Full ASCII
  image/    luminance sources, binarizer, image decoder
  camera/   frame source, camera source, presence tracker, scanner
  utils/    enum helpers
demo/       demo site (vanilla JavaScript, type-checked through JSDoc)
tests/      unit tests and a synthetic barcode renderer
```

## Deployment

The demo is deployed on Vercel at **https://code39scanner.vercel.app/**. `vercel.json` defines
the build (`npm run build`), the output directory (`dist-demo`) and security headers, including
`Permissions-Policy: camera=(self)`.

To deploy your own copy, import the repository in Vercel (**Add New → Project**) and keep the
detected settings, or run:

```bash
npx vercel --prod
```

## License

MIT
