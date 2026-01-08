/**
 * Formats a tree or a WAT (WebAssembly Text) string into a readable format.
 *
 * @param {string | Array} tree - The code to print. If a string is provided, it will be parsed into a tree structure first.
 * @param {Object} [options={}] - Optional settings for printing.
 * @param {string} [options.indent='  '] - The string used for one level of indentation. Defaults to two spaces.
 * @param {string} [options.newline='\n'] - The string used for line breaks. Defaults to a newline character.
 * @param {boolean} [options.comments=false] - Whether to include comments in the output. Defaults to false.
 * @returns {string} The formatted WAT string.
 */
export default function print(tree: string | any[], options?: {
    indent?: string;
    newline?: string;
    comments?: boolean;
}): string;
//# sourceMappingURL=print.d.ts.map