/** WebAssembly instruction names indexed by opcode */
export const INSTR: string[];

/** Section type identifiers */
export const SECTION: {
    custom: number;
    type: number;
    import: number;
    func: number;
    table: number;
    memory: number;
    global: number;
    tag: number;
    export: number;
    start: number;
    elem: number;
    datacount: number;
    code: number;
    data: number;
};

/** Recursive type identifiers */
export const RECTYPE: {
    sub: number;
    subfinal: number;
    rec: number;
};

/** Definition type identifiers */
export const DEFTYPE: {
    func: number;
    struct: number;
    array: number;
    sub: number;
    subfinal: number;
    rec: number;
};

/** Heap type identifiers */
export const HEAPTYPE: {
    nofunc: number;
    noextern: number;
    noexn: number;
    none: number;
    func: number;
    extern: number;
    exn: number;
    any: number;
    eq: number;
    i31: number;
    struct: number;
    array: number;
};

/** Reference type identifiers */
export const REFTYPE: {
    nullfuncref: number;
    nullexternref: number;
    nullexnref: number;
    nullref: number;
    funcref: number;
    externref: number;
    exnref: number;
    anyref: number;
    eqref: number;
    i31ref: number;
    structref: number;
    arrayref: number;
    ref: number;
    refnull: number;
};

/** Value type identifiers */
export const TYPE: {
    i8: number;
    i16: number;
    i32: number;
    i64: number;
    f32: number;
    f64: number;
    void: number;
    v128: number;
    [key: string]: number;
};

/** External kind identifiers */
export const KIND: {
    func: number;
    table: number;
    memory: number;
    global: number;
    tag: number;
};

/** WAT escape codes */
export const ESCAPE: {
    n: number;
    r: number;
    t: number;
    v: number;
    '"': number;
    "'": number;
    '\\': number;
};
