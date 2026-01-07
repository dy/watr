/**
 * Parses a wasm text string and constructs a nested array structure (AST).
 *
 * @param str - The input string with WAT code to parse.
 * @param options - Parse options.
 * @returns An array representing the nested syntax tree (AST).
 */
declare function parse(str: string, options?: {
    /** Include comments in AST */
    comments?: boolean;
}): any[];
export default parse;
