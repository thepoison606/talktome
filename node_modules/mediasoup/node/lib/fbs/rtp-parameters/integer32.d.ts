import * as flatbuffers from 'flatbuffers';
export declare class Integer32 implements flatbuffers.IUnpackableObject<Integer32T> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): Integer32;
    static getRootAsInteger32(bb: flatbuffers.ByteBuffer, obj?: Integer32): Integer32;
    static getSizePrefixedRootAsInteger32(bb: flatbuffers.ByteBuffer, obj?: Integer32): Integer32;
    value(): number;
    static startInteger32(builder: flatbuffers.Builder): void;
    static addValue(builder: flatbuffers.Builder, value: number): void;
    static endInteger32(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createInteger32(builder: flatbuffers.Builder, value: number): flatbuffers.Offset;
    unpack(): Integer32T;
    unpackTo(_o: Integer32T): void;
}
export declare class Integer32T implements flatbuffers.IGeneratedObject {
    value: number;
    constructor(value?: number);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=integer32.d.ts.map