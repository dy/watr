export function uleb5(value: any): number[];
export function i32(n: any, buffer?: any[]): any[];
export namespace i32 {
    function parse(n: any): number;
}
export function i64(n: any, buffer?: any[]): any[];
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
export function uleb(n: any, buffer?: any[]): any;
export function i8(n: any, buffer?: any[]): any[];
export namespace i8 { }
export function i16(n: any, buffer?: any[]): any[];
export namespace i16 { }
//# sourceMappingURL=encode.d.ts.map