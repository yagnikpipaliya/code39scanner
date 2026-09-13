/** Inline status/error message area. */
export class StatusBanner {
  /** @type {HTMLElement} */
  #element;

  /** @param {HTMLElement} element */
  constructor(element) {
    this.#element = element;
  }

  /** @param {string} message @param {'info' | 'error'} [tone] */
  show(message, tone = 'info') {
    this.#element.textContent = message;
    this.#element.classList.toggle('status--error', tone === 'error');
    this.#element.hidden = false;
  }

  hide() {
    this.#element.hidden = true;
    this.#element.textContent = '';
  }
}
