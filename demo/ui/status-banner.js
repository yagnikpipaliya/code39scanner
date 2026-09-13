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
