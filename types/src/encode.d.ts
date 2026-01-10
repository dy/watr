/**
 * Encode as fixed-width 5-byte ULEB128 (canonical form).
 * Used by some tools for predictable binary layout.
 *
 * @param {number} value - 32-bit unsigned value
 * @returns {number[]} 5-byte array
 */
export function uleb5(value: number): number[];
/**
 * Encode signed LEB128 for i32 values.
 *
 * @param {number|string} n - Signed 32-bit value
 * @param {number[]} [buffer=[]] - Output buffer
 * @returns {number[]} Encoded bytes
 */
export function i32(n: number | string, buffer?: number[]): number[];
export namespace i32 {
    function parse(n: any): any;
}
/**
 * Encode signed LEB128 for i64 values (BigInt).
 *
 * @param {bigint|string} n - Signed 64-bit value
 * @param {number[]} [buffer=[]] - Output buffer
 * @returns {number[]} Encoded bytes
 */
export function i64(n: bigint | string, buffer?: number[]): number[];
export namespace i64 {
    function parse(n: any): any;
}
export function f32(input: any, value: any, idx: any): number[];
export namespace f32 {
    function parse(input: any): number;
}
export function f64(input: any, value: any, idx: any): number[];
export namespace f64 {
    function parse(input: any, max?: number): number;
}
export function uleb(n: number | bigint | string | null, buffer?: number[]): number[];
/**
 * Encode signed LEB128 for i32 values.
 *
 * @param {number|string} n - Signed 32-bit value
 * @param {number[]} [buffer=[]] - Output buffer
 * @returns {number[]} Encoded bytes
 */
export function i8(n: number | string, buffer?: number[]): number[];
export namespace i8 { }
/**
 * Encode signed LEB128 for i32 values.
 *
 * @param {number|string} n - Signed 32-bit value
 * @param {number[]} [buffer=[]] - Output buffer
 * @returns {number[]} Encoded bytes
 */
export function i16(n: number | string, buffer?: number[]): number[];
export namespace i16 { }
//# sourceMappingURL=encode.d.ts.map