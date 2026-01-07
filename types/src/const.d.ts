export const INSTR: string[];
export namespace SECTION {
    export let custom: number;
    export let type: number;
    let _import: number;
    export { _import as import };
    export let func: number;
    export let table: number;
    export let memory: number;
    export let global: number;
    export let tag: number;
    let _export: number;
    export { _export as export };
    export let start: number;
    export let elem: number;
    export let datacount: number;
    export let code: number;
    export let data: number;
}
export namespace RECTYPE {
    let sub: number;
    let subfinal: number;
    let rec: number;
}
export namespace DEFTYPE {
    let func_1: number;
    export { func_1 as func };
    export let struct: number;
    export let array: number;
}
export namespace HEAPTYPE {
    export let nofunc: number;
    export let noextern: number;
    export let noexn: number;
    export let none: number;
    let func_2: number;
    export { func_2 as func };
    export let extern: number;
    export let exn: number;
    export let any: number;
    export let eq: number;
    export let i31: number;
    let struct_1: number;
    export { struct_1 as struct };
    let array_1: number;
    export { array_1 as array };
}
export namespace REFTYPE {
    import nullfuncref = HEAPTYPE.nofunc;
    export { nullfuncref };
    import nullexternref = HEAPTYPE.noextern;
    export { nullexternref };
    import nullexnref = HEAPTYPE.noexn;
    export { nullexnref };
    import nullref = HEAPTYPE.none;
    export { nullref };
    import funcref = HEAPTYPE.func;
    export { funcref };
    import externref = HEAPTYPE.extern;
    export { externref };
    import exnref = HEAPTYPE.exn;
    export { exnref };
    import anyref = HEAPTYPE.any;
    export { anyref };
    import eqref = HEAPTYPE.eq;
    export { eqref };
    import i31ref = HEAPTYPE.i31;
    export { i31ref };
    import structref = HEAPTYPE.struct;
    export { structref };
    import arrayref = HEAPTYPE.array;
    export { arrayref };
    export let ref: number;
    export let refnull: number;
}
export namespace TYPE {
    export let i8: number;
    export let i16: number;
    export let i32: number;
    export let i64: number;
    export let f32: number;
    export let f64: number;
    let _void: number;
    export { _void as void };
    export let v128: number;
}
export namespace KIND {
    let func_3: number;
    export { func_3 as func };
    let table_1: number;
    export { table_1 as table };
    let memory_1: number;
    export { memory_1 as memory };
    let global_1: number;
    export { global_1 as global };
    let tag_1: number;
    export { tag_1 as tag };
}
//# sourceMappingURL=const.d.ts.map
