/**
 * Compile and instantiate WAT, returning exports.
 * Supports template literals with value interpolation.
 *
 * @example
 * const { add } = watr`(func (export "add") (param i32 i32) (result i32)
 *   (i32.add (local.get 0) (local.get 1))
 * )`
 *
 * // Interpolate values (preserves float precision)
 * const { pi } = watr`(global (export "pi") f64 (f64.const ${Math.PI}))`
 */
declare function watr(
  strings: TemplateStringsArray,
  ...values: (number | bigint | string | Uint8Array | number[])[]
): WebAssembly.Exports;

/**
 * Compile WAT to binary. Supports both string and template literal.
 *
 * @example
 * compile('(func (export "f") (result i32) (i32.const 42))')
 * compile`(func (export "f") (result f64) (f64.const ${Math.PI}))`
 */
declare function compile(source: string): Uint8Array;
declare function compile(
  strings: TemplateStringsArray,
  ...values: (number | bigint | string | Uint8Array | number[])[]
): Uint8Array;

/**
 * Parse WAT text into syntax tree.
 */
declare function parse(source: string, options?: {
  comments?: boolean;
  annotations?: boolean;
}): any[];

/**
 * Format WAT text or syntax tree.
 */
declare function print(source: string | any[], options?: {
  indent?: string | false;
  newline?: string | false;
}): string;

export default watr;
export { watr, compile, parse, print };
//# sourceMappingURL=watr.d.ts.map