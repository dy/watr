declare module 'watr' {
  export const compile: {
    (nodes: string | Array): Uint8Array;
  };
  export const parse: {
    (wat: string): any;
  };
  export const print: {
    (tree: string | Array, options?: Object): string;
  };
}