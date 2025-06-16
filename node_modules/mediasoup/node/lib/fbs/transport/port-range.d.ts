import * as flatbuffers from 'flatbuffers';
export declare class PortRange implements flatbuffers.IUnpackableObject<PortRangeT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): PortRange;
    static getRootAsPortRange(bb: flatbuffers.ByteBuffer, obj?: PortRange): PortRange;
    static getSizePrefixedRootAsPortRange(bb: flatbuffers.ByteBuffer, obj?: PortRange): PortRange;
    min(): number;
    max(): number;
    static startPortRange(builder: flatbuffers.Builder): void;
    static addMin(builder: flatbuffers.Builder, min: number): void;
    static addMax(builder: flatbuffers.Builder, max: number): void;
    static endPortRange(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createPortRange(builder: flatbuffers.Builder, min: number, max: number): flatbuffers.Offset;
    unpack(): PortRangeT;
    unpackTo(_o: PortRangeT): void;
}
export declare class PortRangeT implements flatbuffers.IGeneratedObject {
    min: number;
    max: number;
    constructor(min?: number, max?: number);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=port-range.d.ts.map