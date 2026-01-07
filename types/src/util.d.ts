/**
 * Throw an error with the given message.
 * @param text - The error message.
 * @throws Error with the given message.
 */
export function err(text: string): never;

/**
 * Deep clone an array structure.
 * @param items - The array to clone.
 * @returns A deep copy of the array.
 */
export function clone(items: any[]): any[];

/** Regex to detect invalid separator placement in numbers */
export const sepRE: RegExp;

/** Regex to match valid integer literals */
export const intRE: RegExp;

/**
 * Build string binary - convert WAT string(s) to byte array.
 * @param parts - String parts to convert (with or without quotes).
 * @returns Array of bytes.
 */
export function str(...parts: string[]): number[];

/**
 * Unescapes a WAT string literal by parsing escapes to bytes, then UTF-8 decoding.
 * @param s - String with quotes and escapes, e.g. '"hello\\nworld"'
 * @returns Unescaped string without quotes, e.g. 'hello\nworld'
 */
export function unescape(s: string): string;
