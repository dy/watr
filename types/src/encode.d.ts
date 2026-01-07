/**
 * Encode an unsigned LEB128 integer (handles both 32-bit and 64-bit values).
 * @param n - The number to encode (can be number, bigint, or string).
 * @param buffer - Optional buffer to append to.
 * @returns The encoded bytes.
 */
export function uleb(n: number | bigint | string | null, buffer?: number[]): number[];

/**
 * Encode a signed 32-bit LEB128 integer.
 * @param n - The number to encode.
 * @param buffer - Optional buffer to append to.
 * @returns The encoded bytes.
 */
export function i32(n: number | string, buffer?: number[]): number[];
export namespace i32 {
    /**
     * Parse a string to a 32-bit integer.
     * @param n - The string to parse.
     * @returns The parsed integer.
     */
    function parse(n: string): number;
}

/**
 * Alias for i32 - encode a signed 8-bit LEB128 integer.
 */
export const i8: typeof i32;

/**
 * Alias for i32 - encode a signed 16-bit LEB128 integer.
 */
export const i16: typeof i32;

/**
 * Encode a signed 64-bit LEB128 integer (bigint).
 * @param n - The bigint to encode.
 * @param buffer - Optional buffer to append to.
 * @returns The encoded bytes.
 */
export function i64(n: bigint | string, buffer?: number[]): number[];
export namespace i64 {
    /**
     * Parse a string to a 64-bit bigint.
     * @param n - The string to parse.
     * @returns The parsed bigint.
     */
    function parse(n: string): bigint;
}

/**
 * Encode a 32-bit floating point number.
 * @param input - The input value (number or string like "nan:0x123").
 * @param value - Optional pre-computed value.
 * @param idx - Optional index for nan parsing.
 * @returns The encoded bytes (4 bytes, little-endian).
 */
export function f32(input: number | string, value?: number, idx?: number): number[];
export namespace f32 {
    /**
     * Parse a string to a 32-bit float.
     * @param input - The string to parse.
     * @returns The parsed float.
     */
    function parse(input: string): number;
}

/**
 * Encode a 64-bit floating point number.
 * @param input - The input value (number or string like "nan:0x123").
 * @param value - Optional pre-computed value.
 * @param idx - Optional index for nan parsing.
 * @returns The encoded bytes (8 bytes, little-endian).
 */
export function f64(input: number | string, value?: bigint, idx?: number): number[];
export namespace f64 {
    /**
     * Parse a string to a 64-bit float.
     * @param input - The string to parse.
     * @param max - Optional maximum value (defaults to Number.MAX_VALUE).
     * @returns The parsed float.
     */
    function parse(input: string, max?: number): number;
}
