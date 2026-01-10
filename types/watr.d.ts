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

/** WAT AST node: instruction/section name or nested expression */
type WATNode = string | number | bigint | WATNode[];

/**
 * Parse WAT text into syntax tree.
 * Returns array of nodes where each node is either a primitive (string, number, bigint)
 * or a nested array representing an S-expression like ['func', ['param', 'i32'], ...].
 */
declare function parse(source: string, options?: {
  comments?: boolean;
  annotations?: boolean;
}): WATNode[];

/**
 * Format WAT text or syntax tree.
 */
declare function print(source: string | WATNode[], options?: {
  indent?: string | false;
  newline?: string | false;
  comments?: boolean;
}): string;

export default watr;
export { watr, compile, parse, print };
//# sourceMappingURL=watr.d.ts.map
