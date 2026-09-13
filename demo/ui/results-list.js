import { copyText } from './clipboard.js';

/** @typedef {import('../results-store.js').StoredResult} StoredResult */

const COPY_FEEDBACK_MS = 1500;

const timeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'medium',
});

/** Renders the scan history with per-item copy and a clear-all action. */
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
  /** @type {string | undefined} */
  #newestId;

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
    list.addEventListener('click', (event) => this.#handleCopy(event));
  }

  /** @param {readonly StoredResult[]} results */
  render(results) {
    const previousNewest = this.#newestId;
    this.#newestId = results[0]?.id;
    this.#list.replaceChildren(
      ...results.map((result) =>
        this.#renderItem(result, previousNewest !== undefined && result.id === this.#newestId),
      ),
    );
    this.#count.textContent = String(results.length);
    this.#empty.hidden = results.length > 0;
    this.#clearButton.disabled = results.length === 0;
  }

  /** @param {StoredResult} result @param {boolean} isNew */
  #renderItem(result, isNew) {
    const item = /** @type {HTMLLIElement} */ (
      this.#template.content.firstElementChild.cloneNode(true)
    );
    const date = new Date(result.timestamp);
    item.querySelector('.result__text').textContent = result.text;
    const time = item.querySelector('.result__time');
    time.dateTime = date.toISOString();
    time.textContent = timeFormat.format(date);
    const copy = item.querySelector('.result__copy');
    copy.dataset.text = result.text;
    copy.setAttribute('aria-label', `Copy ${result.text}`);
    item.classList.toggle('result--new', isNew);
    return item;
  }

  /** @param {MouseEvent} event */
  async #handleCopy(event) {
    const button = /** @type {HTMLElement} */ (event.target).closest('.result__copy');
    if (!(button instanceof HTMLButtonElement)) return;
    try {
      await copyText(button.dataset.text ?? '');
      this.#flashLabel(button, 'Copied');
    } catch {
      this.#flashLabel(button, 'Copy failed');
    }
  }

  /** @param {HTMLButtonElement} button @param {string} label */
  #flashLabel(button, label) {
    button.textContent = label;
    setTimeout(() => {
      button.textContent = 'Copy';
    }, COPY_FEEDBACK_MS);
  }
}
