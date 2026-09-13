/**
 * Start/stop button and camera picker. Pure view: reports user intent through callbacks and
 * renders whatever state it is given.
 *
 * @typedef {'idle' | 'starting' | 'scanning'} ScannerState
 * @typedef {{ deviceId: string, label: string }} CameraDevice
 */

const TOGGLE_LABELS = /** @type {const} */ ({
  idle: 'Start scanning',
  starting: 'Starting camera…',
  scanning: 'Stop scanning',
});

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

  /** @param {ScannerState} state */
  setState(state) {
    this.#toggle.textContent = TOGGLE_LABELS[state];
    this.#toggle.disabled = state === 'starting';
    this.#toggle.setAttribute('aria-pressed', String(state === 'scanning'));
    this.#select.disabled = state !== 'scanning' || this.#select.options.length < 2;
    this.#viewer.dataset.state = state;
  }

  /** @param {readonly CameraDevice[]} cameras @param {string | undefined} activeDeviceId */
  setCameras(cameras, activeDeviceId) {
    // Some browsers withhold device ids; show the camera in use rather than an empty picker.
    const options = cameras.length
      ? cameras.map(({ deviceId, label }) => new Option(label, deviceId))
      : [new Option('Default camera', '')];
    this.#select.replaceChildren(...options);
    if (activeDeviceId && cameras.some((camera) => camera.deviceId === activeDeviceId)) {
      this.#select.value = activeDeviceId;
    }
    this.#select.disabled = cameras.length < 2;
  }

  disable() {
    this.#toggle.disabled = true;
    this.#select.disabled = true;
  }
}
