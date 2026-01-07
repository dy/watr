/**
 * Converts a WebAssembly Text Format (WAT) tree to a WebAssembly binary format (WASM).
 *
 * @param nodes - The WAT tree or string to be compiled to WASM binary.
 * @returns The compiled WASM binary data.
 */
export default function compile(nodes: string | any[]): Uint8Array;
