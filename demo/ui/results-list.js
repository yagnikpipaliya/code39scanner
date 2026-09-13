import { copyText } from './clipboard.js';
import { requireElement } from './dom.js';

/** @typedef {import('../results-store.js').StoredResult} StoredResult */

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
    const item = requireElement(fragment, '.result', HTMLLIElement);
    const date = new Date(result.timestamp);

    requireElement(item, '.result__text', HTMLElement).textContent = result.text;
    const time = requireElement(item, '.result__time', HTMLTimeElement);
    time.dateTime = date.toISOString();
    time.textContent = timeFormat.format(date);
    const copy = requireElement(item, '.result__copy', HTMLButtonElement);
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
