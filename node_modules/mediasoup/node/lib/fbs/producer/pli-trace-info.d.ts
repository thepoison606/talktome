import * as flatbuffers from 'flatbuffers';
export declare class PliTraceInfo implements flatbuffers.IUnpackableObject<PliTraceInfoT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): PliTraceInfo;
    static getRootAsPliTraceInfo(bb: flatbuffers.ByteBuffer, obj?: PliTraceInfo): PliTraceInfo;
    static getSizePrefixedRootAsPliTraceInfo(bb: flatbuffers.ByteBuffer, obj?: PliTraceInfo): PliTraceInfo;
    ssrc(): number;
    static startPliTraceInfo(builder: flatbuffers.Builder): void;
    static addSsrc(builder: flatbuffers.Builder, ssrc: number): void;
    static endPliTraceInfo(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createPliTraceInfo(builder: flatbuffers.Builder, ssrc: number): flatbuffers.Offset;
    unpack(): PliTraceInfoT;
    unpackTo(_o: PliTraceInfoT): void;
}
export declare class PliTraceInfoT implements flatbuffers.IGeneratedObject {
    ssrc: number;
    constructor(ssrc?: number);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=pli-trace-info.d.ts.map