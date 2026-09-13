/** Visual tone of a status message. */
export const StatusTone = Object.freeze(/** @type {const} */ ({ Info: 'info', Error: 'error' }));

/** @typedef {typeof StatusTone[keyof typeof StatusTone]} StatusToneValue */

/** Inline status/error message area. */
export class StatusBanner {
  /** @type {HTMLElement} */
  #element;

  /** @param {HTMLElement} element */
  constructor(element) {
    this.#element = element;
  }

  /** @param {string} message @param {StatusToneValue} [tone] */
  show(message, tone = StatusTone.Info) {
    this.#element.textContent = message;
    this.#element.classList.toggle('status--error', tone === StatusTone.Error);
    this.#element.hidden = false;
  }

  hide() {
    this.#element.hidden = true;
    this.#element.textContent = '';
  }
}
