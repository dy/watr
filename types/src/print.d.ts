/**
 * Formats a tree or a WAT (WebAssembly Text) string into a readable format.
 *
 * @param tree - The code to print. If a string is provided, it will be parsed into a tree structure first.
 * @param options - Optional settings for printing.
 * @returns The formatted WAT string.
 */
export default function print(tree: string | any[], options?: {
    /** The string used for one level of indentation. Defaults to two spaces. */
    indent?: string;
    /** The string used for line breaks. Defaults to a newline character. */
    newline?: string;
}): string;
