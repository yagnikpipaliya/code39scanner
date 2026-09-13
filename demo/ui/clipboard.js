/**
 * Copies text to the clipboard. Uses the async Clipboard API, falling back to a hidden
 * textarea for browsers/contexts where it is unavailable.
 *
 * @param {string} text
 * @returns {Promise<void>}
 */
export async function copyText(text) {
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
