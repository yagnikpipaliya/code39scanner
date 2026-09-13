/**
 * Demo composition root: wires the scanner package to the page. All logic lives in the
 * package and the small single-purpose modules imported below.
 */
import {
  CameraUnavailableError,
  Code39Scanner,
  InsecureContextError,
  PermissionDeniedError,
  UnsupportedBrowserError,
} from 'code39-scanner';
import { ResultsStore } from './results-store.js';
import { CameraControls } from './ui/camera-controls.js';
import { ResultsList } from './ui/results-list.js';
import { StatusBanner } from './ui/status-banner.js';

const DETECTED_HIGHLIGHT_MS = 400;

/** @template {Element} T @param {string} id @returns {T} */
function byId(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return /** @type {T} */ (/** @type {unknown} */ (element));
}

/** @param {unknown} error @returns {string} */
function describeError(error) {
  if (error instanceof PermissionDeniedError) {
    return 'Camera permission was denied. Allow camera access in your browser settings, then try again.';
  }
  if (error instanceof InsecureContextError) {
    return 'The camera is only available over HTTPS. Open this page using an https:// address.';
  }
  if (error instanceof UnsupportedBrowserError) {
    return 'This browser does not support camera access. Try a recent Chrome, Safari, Firefox or Edge.';
  }
  if (error instanceof CameraUnavailableError) {
    return `${error.message} Check that a camera is connected and not used by another app.`;
  }
  return error instanceof Error ? error.message : 'Something went wrong.';
}

const viewer = byId('viewer');
const status = new StatusBanner(byId('status'));
const store = new ResultsStore();
const scanner = new Code39Scanner({ video: byId('preview') });

const resultsList = new ResultsList({
  list: byId('results-list'),
  empty: byId('results-empty'),
  count: byId('results-count'),
  clearButton: byId('clear'),
  template: byId('result-template'),
  onClear: () => store.clear(),
});

const controls = new CameraControls({
  toggle: byId('toggle'),
  select: byId('camera-select'),
  viewer,
  onToggle: () => (scanner.state === 'idle' ? start() : scanner.stop()),
  onCameraChange: (deviceId) => start(deviceId),
});

/** @param {string} [deviceId] */
async function start(deviceId) {
  status.hide();
  try {
    await scanner.start({ deviceId });
    controls.setCameras(await Code39Scanner.listCameras(), scanner.activeDeviceId);
  } catch (error) {
    status.show(describeError(error), 'error');
  }
}

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
scanner.on('statechange', (state) => controls.setState(state));
scanner.on('error', (error) => status.show(describeError(error), 'error'));
scanner.on('detect', (result) => {
  store.add(result);
  highlightDetection();
});

controls.setState(scanner.state);
if (!window.isSecureContext) {
  status.show(describeError(new InsecureContextError('')), 'error');
  controls.disable();
} else if (!Code39Scanner.isSupported()) {
  status.show(describeError(new UnsupportedBrowserError('')), 'error');
  controls.disable();
}

// Release the camera when the page is hidden for good (tab closed, navigation, bfcache).
window.addEventListener('pagehide', () => void scanner.stop());
