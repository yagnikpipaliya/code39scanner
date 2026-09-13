import { ScannerState } from 'code39-scanner';

/**
 * Start/stop button and camera picker. Pure view: reports user intent through callbacks and
 * renders whatever state it is given.
 *
 * @typedef {import('code39-scanner').ScannerState} ScannerStateValue
 * @typedef {import('code39-scanner').CameraDevice} CameraDevice
 */

const TOGGLE_LABELS = Object.freeze({
  [ScannerState.Idle]: 'Start scanning',
  [ScannerState.Starting]: 'Starting camera…',
  [ScannerState.Scanning]: 'Stop scanning',
});
const PICKER_PLACEHOLDER = 'Start scanning to choose';
const DEFAULT_CAMERA_LABEL = 'Default camera';

export class CameraControls {
  /** @type {HTMLButtonElement} */
  #toggle;
  /** @type {HTMLSelectElement} */
  #select;
  /** @type {HTMLElement} */
  #viewer;

  /**
   * @param {{
   *   toggle: HTMLButtonElement,
   *   select: HTMLSelectElement,
   *   viewer: HTMLElement,
   *   onToggle: () => void,
   *   onCameraChange: (deviceId: string) => void,
   * }} options
   */
  constructor({ toggle, select, viewer, onToggle, onCameraChange }) {
    this.#toggle = toggle;
    this.#select = select;
    this.#viewer = viewer;
    toggle.addEventListener('click', () => onToggle());
    select.addEventListener('change', () => {
      if (select.value) onCameraChange(select.value);
    });
  }

  /** @param {ScannerStateValue} state */
  setState(state) {
    this.#toggle.textContent = TOGGLE_LABELS[state];
    this.#toggle.disabled = state === ScannerState.Starting;
    this.#toggle.setAttribute('aria-pressed', String(state === ScannerState.Scanning));
    this.#select.disabled = state !== ScannerState.Scanning || this.#select.options.length < 2;
    this.#viewer.dataset.state = state;
  }

  /** @param {readonly CameraDevice[]} cameras @param {string | undefined} activeDeviceId */
  setCameras(cameras, activeDeviceId) {
    // Some browsers withhold device ids; show the camera in use rather than an empty picker.
    this.#showOptions(
      cameras.length
        ? cameras.map(({ deviceId, label }) => new Option(label, deviceId))
        : [new Option(DEFAULT_CAMERA_LABEL, '')],
    );
    if (activeDeviceId && cameras.some((camera) => camera.deviceId === activeDeviceId)) {
      this.#select.value = activeDeviceId;
    }
  }

  /** Back to the pre-start placeholder, e.g. after a failed start or camera switch. */
  resetCameras() {
    this.#showOptions([new Option(PICKER_PLACEHOLDER, '')]);
  }

  disable() {
    this.#toggle.disabled = true;
    this.#select.disabled = true;
  }

  /** @param {HTMLOptionElement[]} options */
  #showOptions(options) {
    this.#select.replaceChildren(...options);
    this.#select.disabled = options.length < 2;
  }
}
