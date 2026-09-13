/** Union of the member values of an enum defined with {@link defineEnum}. */
export type EnumValue<T extends Readonly<Record<string, string>>> = T[keyof T];

/**
 * Defines a string enum as a frozen const object; pair it with a same-named
 * `type X = EnumValue<typeof X>`.
 *
 * Preferred over the TypeScript `enum` keyword: it is plain, erasable JavaScript (no generated
 * runtime code or reverse mappings), tree-shakeable, and its values are ordinary string literals,
 * so JavaScript callers may pass either `ScannerState.Idle` or `'idle'`.
 */
export function defineEnum<const T extends Readonly<Record<string, string>>>(members: T): T {
  return Object.freeze(members);
}

/** Type guard: whether `value` is one of the enum's member values. */
export function isEnumValue<T extends Readonly<Record<string, string>>>(
  enumObject: T,
  value: unknown,
): value is EnumValue<T> {
  return typeof value === 'string' && Object.values(enumObject).includes(value);
}

/** Milliseconds from an arbitrary, fixed origin. */
export type Clock = () => number;

/**
 * Monotonic clock for measuring durations. Unlike `Date.now()`, it never jumps when the system
 * time changes (NTP sync, manual edits, DST), so elapsed times are always correct.
 */
export const monotonicClock: Clock = () => performance.now();

/** The value stored under `key`; if there is none, `create()` is stored first and returned. */
export function getOrInsert<K, V>(map: Map<K, V>, key: K, create: () => NoInfer<V>): V {
  let value = map.get(key);
  if (value === undefined) {
    value = create();
    map.set(key, value);
  }
  return value;
}
