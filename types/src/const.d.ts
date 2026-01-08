export const INSTR: (string | string[])[];
export namespace SECTION {
    export let custom: number;
    export let type: number;
    let _import: number;
    export { _import as import };
    export let func: number;
    export let table: number;
    export let memory: number;
    export let tag: number;
    export let global: number;
    let _export: number;
    export { _export as export };
    export let start: number;
    export let elem: number;
    export let datacount: number;
    export let code: number;
    export let data: number;
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
    export let exn: number;
    export let noexn: number;
    export let nofunc: number;
    export let noextern: number;
    export let none: number;
    let func_1: number;
    export { func_1 as func };
    export let extern: number;
    export let any: number;
    export let eq: number;
    export let i31: number;
    export let struct: number;
    export let array: number;
    export let nullfuncref: number;
    export let nullexternref: number;
    export let nullexnref: number;
    export let nullref: number;
    export let funcref: number;
    export let externref: number;
    export let exnref: number;
    export let anyref: number;
    export let eqref: number;
    export let i31ref: number;
    export let structref: number;
    export let arrayref: number;
    export let ref: number;
    export let refnull: number;
    export let sub: number;
    export let subfinal: number;
    export let rec: number;
}
export namespace DEFTYPE {
    let func_2: number;
    export { func_2 as func };
    let struct_1: number;
    export { struct_1 as struct };
    let array_1: number;
    export { array_1 as array };
    let sub_1: number;
    export { sub_1 as sub };
    let subfinal_1: number;
    export { subfinal_1 as subfinal };
    let rec_1: number;
    export { rec_1 as rec };
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