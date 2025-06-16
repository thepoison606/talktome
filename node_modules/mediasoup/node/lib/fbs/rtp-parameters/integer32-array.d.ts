import * as flatbuffers from 'flatbuffers';
export declare class Integer32Array implements flatbuffers.IUnpackableObject<Integer32ArrayT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): Integer32Array;
    static getRootAsInteger32Array(bb: flatbuffers.ByteBuffer, obj?: Integer32Array): Integer32Array;
    static getSizePrefixedRootAsInteger32Array(bb: flatbuffers.ByteBuffer, obj?: Integer32Array): Integer32Array;
    value(index: number): number | null;
    valueLength(): number;
    valueArray(): Int32Array | null;
    static startInteger32Array(builder: flatbuffers.Builder): void;
    static addValue(builder: flatbuffers.Builder, valueOffset: flatbuffers.Offset): void;
    static createValueVector(builder: flatbuffers.Builder, data: number[] | Int32Array): flatbuffers.Offset;
    /**
     * @deprecated This Uint8Array overload will be removed in the future.
     */
    static createValueVector(builder: flatbuffers.Builder, data: number[] | Uint8Array): flatbuffers.Offset;
    static startValueVector(builder: flatbuffers.Builder, numElems: number): void;
    static endInteger32Array(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createInteger32Array(builder: flatbuffers.Builder, valueOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): Integer32ArrayT;
    unpackTo(_o: Integer32ArrayT): void;
}
export declare class Integer32ArrayT implements flatbuffers.IGeneratedObject {
    value: (number)[];
    constructor(value?: (number)[]);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=integer32-array.d.ts.map