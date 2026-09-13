/**
 * Demo composition root: wires the scanner package to the page. All logic lives in the
 * package and the small single-purpose modules imported below.
 */
import {
  Code39Scanner,
  Code39ScannerError,
  ErrorCode,
  InsecureContextError,
  ScannerEvent,
  ScannerState,
  UnsupportedBrowserError,
} from 'code39-scanner';
import { ResultsStore } from './results-store.js';
import { CameraControls } from './ui/camera-controls.js';
import { byId } from './ui/dom.js';
import { ResultsList } from './ui/results-list.js';
import { StatusBanner, StatusTone } from './ui/status-banner.js';

const DETECTED_HIGHLIGHT_MS = 400;

/**
 * User-facing explanation per error code; other errors show their own message.
 *
 * @type {Readonly<Partial<Record<import('code39-scanner').ErrorCode, (error: Error) => string>>>}
 */
const ERROR_MESSAGES = Object.freeze({
  [ErrorCode.PermissionDenied]: () =>
    'Camera permission was denied. Allow camera access in your browser settings, then try again.',
  [ErrorCode.InsecureContext]: () =>
    'The camera is only available over HTTPS. Open this page using an https:// address.',
  [ErrorCode.UnsupportedBrowser]: () =>
    'This browser does not support camera access. Try a recent Chrome, Safari, Firefox or Edge.',
  [ErrorCode.CameraUnavailable]: (error) =>
    `${error.message} Check that a camera is connected and not in use by another app.`,
});

/** @param {unknown} error @returns {string} */
function describeError(error) {
  if (error instanceof Code39ScannerError) {
    const describe = ERROR_MESSAGES[error.code];
    if (describe) return describe(error);
  }
  return error instanceof Error ? error.message : 'Something went wrong.';
}

const viewer = byId('viewer', HTMLElement);
const status = new StatusBanner(byId('status', HTMLElement));
const store = new ResultsStore();
const scanner = new Code39Scanner({ video: byId('preview', HTMLVideoElement) });

const resultsList = new ResultsList({
  list: byId('results-list', HTMLOListElement),
  empty: byId('results-empty', HTMLElement),
  count: byId('results-count', HTMLElement),
  clearButton: byId('clear', HTMLButtonElement),
  template: byId('result-template', HTMLTemplateElement),
  onClear: () => store.clear(),
});

const controls = new CameraControls({
  toggle: byId('toggle', HTMLButtonElement),
  select: byId('camera-select', HTMLSelectElement),
  viewer,
  onToggle: () => void (scanner.state === ScannerState.Idle ? start() : scanner.stop()),
  onCameraChange: (deviceId) => void start(deviceId),
});

/** @param {string} [deviceId] */
async function start(deviceId) {
  status.hide();
  try {
    await scanner.start({ deviceId });
  } catch (error) {
    controls.resetCameras();
    status.show(describeError(error), StatusTone.Error);
    return;
  }
  await refreshCameraList();
}

/** The camera is already running; if listing fails, the picker just shows the default entry. */
async function refreshCameraList() {
  try {
    controls.setCameras(await Code39Scanner.listCameras(), scanner.activeDeviceId);
  } catch (error) {
    console.warn('Unable to list cameras.', error);
    controls.setCameras([], scanner.activeDeviceId);
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
scanner.on(ScannerEvent.StateChange, (state) => controls.setState(state));
scanner.on(ScannerEvent.Error, (error) => status.show(describeError(error), StatusTone.Error));
scanner.on(ScannerEvent.Detect, (result) => {
  store.add(result);
  highlightDetection();
});

controls.setState(scanner.state);
const environmentError = !window.isSecureContext
  ? new InsecureContextError('Insecure context.')
  : !Code39Scanner.isSupported()
    ? new UnsupportedBrowserError('Camera API unavailable.')
    : null;
if (environmentError) {
  status.show(describeError(environmentError), StatusTone.Error);
  controls.disable();
}

// Release the camera when the page is hidden for good (tab closed, navigation, bfcache).
window.addEventListener('pagehide', () => void scanner.stop());
