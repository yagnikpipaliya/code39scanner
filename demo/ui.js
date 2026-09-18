/**
 * Demo view components. Each one is a pure view: it reports user intent through callbacks and
 * renders whatever state it is given.
 *
 * @typedef {import('../src/camera/scanner.js').ScannerStateValue} ScannerStateValue
 * @typedef {import('../src/camera/camera-frame-source.js').CameraDevice} CameraDevice
 * @typedef {import('./results-store.js').StoredResult} StoredResult
 */
import { ScannerState } from 'code39-scanner';

/**
 * Returns the first element matching `selector`, verifying its type at runtime (not just casting).
 *
 * @template {Element} T
 * @param {string} selector
 * @param {new () => T} type
 * @param {ParentNode} [root]
 * @returns {T}
 */
export function requireElement(selector, type, root = document) {
  const element = root.querySelector(selector);
  if (!(element instanceof type)) throw new Error(`Expected "${selector}" to be a ${type.name}.`);
  return element;
}

/**
 * Copies text to the clipboard. Uses the async Clipboard API, falling back to a hidden
 * textarea for browsers/contexts where it is unavailable.
 *
 * @param {string} text
 * @returns {Promise<void>}
 */
async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Permission denied or unsupported context — use the fallback below.
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  try {
    if (!document.execCommand('copy')) throw new Error('Copy command was rejected.');
  } finally {
    textarea.remove();
  }
}

/** Visual tone of a status message. */
export const StatusTone = Object.freeze(
  /** @type {const} */ ({ Info: 'info', Warning: 'warning', Error: 'error' }),
);

/** @typedef {typeof StatusTone[keyof typeof StatusTone]} StatusToneValue */

/** Inline status/error message area. */
export class StatusBanner {
  /** @type {HTMLElement} */
  #element;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  #hideTimer;

  /** @param {HTMLElement} element */
  constructor(element) {
    this.#element = element;
  }

  /** Shows a message until it is replaced or hidden. */
  /** @param {string} message @param {StatusToneValue} [tone] */
  show(message, tone = StatusTone.Info) {
    clearTimeout(this.#hideTimer);
    this.#element.textContent = message;
    for (const value of Object.values(StatusTone)) {
      this.#element.classList.toggle(`status--${value}`, value === tone);
    }
    this.#element.hidden = false;
  }

  /** Shows a message that hides itself after `durationMs`. */
  /** @param {string} message @param {StatusToneValue} tone @param {number} durationMs */
  flash(message, tone, durationMs) {
    this.show(message, tone);
    this.#hideTimer = setTimeout(() => this.hide(), durationMs);
  }

  hide() {
    clearTimeout(this.#hideTimer);
    this.#element.hidden = true;
    this.#element.textContent = '';
  }
}

const TOGGLE_LABELS = Object.freeze({
  [ScannerState.Idle]: 'Start scanning',
  [ScannerState.Starting]: 'Starting camera…',
  [ScannerState.Scanning]: 'Stop scanning',
});
const PICKER_PLACEHOLDER = 'Start scanning to choose';
const DEFAULT_CAMERA_LABEL = 'Default camera';

/** Start/stop button and camera picker. */
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

const COPY_LABEL = 'Copy';
const CopyFeedback = Object.freeze(
  /** @type {const} */ ({ Success: 'Copied', Failure: 'Copy failed' }),
);
const COPY_FEEDBACK_MS = 1500;
const NEW_ITEM_CLASS = 'result--new';

const timeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'medium',
});

/**
 * Renders the scan history with per-item copy and a clear-all action. Rendering is keyed by
 * result id: existing rows are reused and only new rows are created, so a new scan costs one
 * element rather than rebuilding the whole list.
 */
export class ResultsList {
  /** @type {HTMLOListElement} */
  #list;
  /** @type {HTMLElement} */
  #empty;
  /** @type {HTMLElement} */
  #count;
  /** @type {HTMLButtonElement} */
  #clearButton;
  /** @type {HTMLTemplateElement} */
  #template;
  /** @type {Map<string, HTMLLIElement>} */
  #items = new Map();
  /** The first render shows persisted history, which is not highlighted as new. */
  #hasRendered = false;
  /** @type {WeakMap<HTMLButtonElement, ReturnType<typeof setTimeout>>} */
  #feedbackTimers = new WeakMap();

  /**
   * @param {{
   *   list: HTMLOListElement,
   *   empty: HTMLElement,
   *   count: HTMLElement,
   *   clearButton: HTMLButtonElement,
   *   template: HTMLTemplateElement,
   *   onClear: () => void,
   * }} options
   */
  constructor({ list, empty, count, clearButton, template, onClear }) {
    this.#list = list;
    this.#empty = empty;
    this.#count = count;
    this.#clearButton = clearButton;
    this.#template = template;
    clearButton.addEventListener('click', () => onClear());
    list.addEventListener('click', (event) => void this.#handleCopy(event));
    list.addEventListener('animationend', (event) => {
      if (event.target instanceof Element) event.target.classList.remove(NEW_ITEM_CLASS);
    });
  }

  /** @param {readonly StoredResult[]} results Newest first. */
  render(results) {
    /** @type {Map<string, HTMLLIElement>} */
    const items = new Map();
    for (const result of results) {
      items.set(result.id, this.#items.get(result.id) ?? this.#createItem(result));
    }
    this.#items = items;
    this.#reconcile([...items.values()]);
    this.#hasRendered = true;

    this.#count.textContent = String(results.length);
    this.#empty.hidden = results.length > 0;
    this.#clearButton.disabled = results.length === 0;
  }

  /** Inserts or moves only rows that are out of place and removes the rest. */
  /** @param {readonly HTMLLIElement[]} items */
  #reconcile(items) {
    items.forEach((item, index) => {
      const current = this.#list.children[index];
      if (current !== item) this.#list.insertBefore(item, current ?? null);
    });
    while (this.#list.children.length > items.length) this.#list.lastElementChild?.remove();
  }

  /** @param {StoredResult} result @returns {HTMLLIElement} */
  #createItem(result) {
    const fragment = /** @type {DocumentFragment} */ (this.#template.content.cloneNode(true));
    const item = requireElement('.result', HTMLLIElement, fragment);
    const date = new Date(result.timestamp);

    requireElement('.result__text', HTMLElement, item).textContent = result.text;
    const time = requireElement('.result__time', HTMLTimeElement, item);
    time.dateTime = date.toISOString();
    time.textContent = timeFormat.format(date);
    const copy = requireElement('.result__copy', HTMLButtonElement, item);
    copy.dataset.text = result.text;
    copy.setAttribute('aria-label', `Copy ${result.text}`);

    if (this.#hasRendered) item.classList.add(NEW_ITEM_CLASS);
    return item;
  }

  /** @param {MouseEvent} event */
  async #handleCopy(event) {
    const button = event.target instanceof Element ? event.target.closest('.result__copy') : null;
    if (!(button instanceof HTMLButtonElement)) return;
    try {
      await copyText(button.dataset.text ?? '');
      this.#flashLabel(button, CopyFeedback.Success);
    } catch {
      this.#flashLabel(button, CopyFeedback.Failure);
    }
  }

  /** @param {HTMLButtonElement} button @param {string} label */
  #flashLabel(button, label) {
    clearTimeout(this.#feedbackTimers.get(button));
    button.textContent = label;
    this.#feedbackTimers.set(
      button,
      setTimeout(() => {
        button.textContent = COPY_LABEL;
      }, COPY_FEEDBACK_MS),
    );
  }
}
