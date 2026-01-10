/**
 * Throws an error with optional source position.
 * Uses err.src for source and err.i for default position.
 * If pos provided or err.i set, appends "at line:col".
 *
 * @param {string} text - Error message
 * @param {number} [pos] - Byte offset in source (defaults to err.i)
 * @throws {Error}
 */
export const err: (text: string, pos?: number) => never;
export function clone(items: any[]): any[];
/** Regex to detect invalid underscore placement in numbers */
export const sepRE: RegExp;
/** Regex to match valid integer literals (decimal or hex) */
export const intRE: RegExp;
export function str(s: string): number[];
export function unescape(s: string): string;
//# sourceMappingURL=util.d.ts.map