/** Union of the member values of an enum defined with {@link defineEnum}. */
/**
 * @template {Record<string, string>} T
 * @typedef {T[keyof T]} EnumValue
 */

/**
 * Defines a string enum as a frozen const object; pair it with a same-named
 * `type X = EnumValue<typeof X>`.
 *
 * Preferred over the TypeScript `enum` keyword: it is plain, erasable JavaScript (no generated
 * runtime code or reverse mappings), tree-shakeable, and its values are ordinary string literals,
 * so JavaScript callers may pass either `ScannerState.Idle` or `'idle'`.
 * @template {Record<string, string>} T
 * @param {T} members
 * @returns {T}
 */
export function defineEnum(members) {
  return Object.freeze(members);
}

/** Type guard: whether `value` is one of the enum's member values. */
export function isEnumValue(enumObject, value) {
  return typeof value === 'string' && Object.values(enumObject).includes(value);
}

/** Milliseconds from an arbitrary, fixed origin. */
/**
 * @typedef {() => number} Clock
 */

/**
 * Monotonic clock for measuring durations. Unlike `Date.now()`, it never jumps when the system
 * time changes (NTP sync, manual edits, DST), so elapsed times are always correct.
 * @type {Clock}
 */
export const monotonicClock = () => performance.now();

/**
 * The value stored under `key`; if there is none, `create()` is stored first and returned.
 * @template K, V
 * @param {Map<K, V>} map
 * @param {K} key
 * @param {() => V} create
 * @returns {V}
 */
export function getOrInsert(map, key, create) {
  let value = map.get(key);
  if (value === undefined) {
    value = create();
    map.set(key, value);
  }
  return value;
}