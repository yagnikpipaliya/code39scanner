/**
 * Returns the element with the given id, verifying its type at runtime (not just casting).
 *
 * @template {Element} T
 * @param {string} id
 * @param {new () => T} type
 * @returns {T}
 */
export function byId(id, type) {
  const element = document.getElementById(id);
  if (!(element instanceof type)) throw new Error(`Expected #${id} to be a ${type.name}.`);
  return element;
}

/**
 * Returns the first descendant matching `selector`, verifying its type at runtime.
 *
 * @template {Element} T
 * @param {ParentNode} root
 * @param {string} selector
 * @param {new () => T} type
 * @returns {T}
 */
export function requireElement(root, selector, type) {
  const element = root.querySelector(selector);
  if (!(element instanceof type)) throw new Error(`Expected "${selector}" to be a ${type.name}.`);
  return element;
}
