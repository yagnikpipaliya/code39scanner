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
