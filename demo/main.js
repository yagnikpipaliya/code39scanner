/**
 * Demo composition root: wires the camera scanner to the page. All logic lives in the decoder,
 * the camera module, the results store and the view components imported below.
 */
import { Code39Scanner, ScannerState } from './camera.js';
import { ResultsStore } from './results-store.js';
import { CameraControls, requireElement, ResultsList, StatusBanner, StatusTone } from './ui.js';

const DETECTED_HIGHLIGHT_MS = 400;

const PERMISSION_MESSAGE =
  'Camera permission was denied. Allow camera access in your browser settings, then try again.';
const NO_CAMERA_MESSAGE = 'No camera was found. Connect a camera and try again.';
const CAMERA_BUSY_MESSAGE =
  'The camera is in use by another application. Close it and try again.';
const INSECURE_MESSAGE =
  'The camera is only available over HTTPS. Open this page using an https:// address.';
const UNSUPPORTED_MESSAGE =
  'This browser does not support camera access. Try a recent Chrome, Safari, Firefox or Edge.';

/**
 * User-facing explanation per camera failure. Browsers report these as a DOMException whose
 * `name` says what went wrong; anything else falls back to the error's own message.
 *
 * @type {Readonly<Record<string, string>>}
 */
const ERROR_MESSAGES = Object.freeze({
  NotAllowedError: PERMISSION_MESSAGE,
  SecurityError: PERMISSION_MESSAGE,
  NotFoundError: NO_CAMERA_MESSAGE,
  OverconstrainedError: NO_CAMERA_MESSAGE,
  NotReadableError: CAMERA_BUSY_MESSAGE,
  AbortError: CAMERA_BUSY_MESSAGE,
});

/** @param {unknown} error @returns {string} */
function describeError(error) {
  const { name, message } = /** @type {{ name?: string, message?: string }} */ (error ?? {});
  return (name && ERROR_MESSAGES[name]) || message || 'Something went wrong.';
}

const viewer = requireElement('#viewer', HTMLElement);
const status = new StatusBanner(requireElement('#status', HTMLElement));
const store = new ResultsStore();

const resultsList = new ResultsList({
  list: requireElement('#results-list', HTMLOListElement),
  empty: requireElement('#results-empty', HTMLElement),
  count: requireElement('#results-count', HTMLElement),
  clearButton: requireElement('#clear', HTMLButtonElement),
  template: requireElement('#result-template', HTMLTemplateElement),
  onClear: () => store.clear(),
});

const controls = new CameraControls({
  toggle: requireElement('#toggle', HTMLButtonElement),
  select: requireElement('#camera-select', HTMLSelectElement),
  viewer,
  onToggle: () => void (scanner.state === ScannerState.Idle ? start() : scanner.stop()),
  onCameraChange: (deviceId) => void start(deviceId),
});

const scanner = new Code39Scanner({
  video: requireElement('#preview', HTMLVideoElement),
  onDetect: (result) => {
    store.add(result);
    highlightDetection();
  },
  onChange: (state) => controls.setState(state),
  onError: (error) => {
    controls.resetCameras();
    status.show(describeError(error), StatusTone.Error);
  },
});

/** @param {string} [deviceId] */
async function start(deviceId) {
  status.hide();
  await scanner.start(deviceId);
  // A start that failed or was cancelled has already reset the controls.
  if (scanner.state === ScannerState.Scanning) await refreshCameraList();
}

/** The camera is already running; if listing fails, the picker just shows the default entry. */
async function refreshCameraList() {
  try {
    controls.setCameras(await Code39Scanner.listCameras(), scanner.deviceId);
  } catch (error) {
    console.warn('Unable to list cameras.', error);
    controls.setCameras([], scanner.deviceId);
  }
}

/** @type {ReturnType<typeof setTimeout> | undefined} */
let highlightTimer;
function highlightDetection() {
  viewer.classList.add('viewer--detected');
  clearTimeout(highlightTimer);
  highlightTimer = setTimeout(
    () => viewer.classList.remove('viewer--detected'),
    DETECTED_HIGHLIGHT_MS,
  );
}

store.subscribe((results) => resultsList.render(results));
controls.setState(scanner.state);

const environmentError = !window.isSecureContext
  ? INSECURE_MESSAGE
  : !Code39Scanner.isSupported()
    ? UNSUPPORTED_MESSAGE
    : null;
if (environmentError) {
  status.show(environmentError, StatusTone.Error);
  controls.disable();
}

// Release the camera when the page is hidden or closed (tab switch, navigation, bfcache).
window.addEventListener('pagehide', () => scanner.stop());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) scanner.stop();
});
