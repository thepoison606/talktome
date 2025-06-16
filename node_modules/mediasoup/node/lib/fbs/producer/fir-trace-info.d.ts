import * as flatbuffers from 'flatbuffers';
export declare class FirTraceInfo implements flatbuffers.IUnpackableObject<FirTraceInfoT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): FirTraceInfo;
    static getRootAsFirTraceInfo(bb: flatbuffers.ByteBuffer, obj?: FirTraceInfo): FirTraceInfo;
    static getSizePrefixedRootAsFirTraceInfo(bb: flatbuffers.ByteBuffer, obj?: FirTraceInfo): FirTraceInfo;
    ssrc(): number;
    static startFirTraceInfo(builder: flatbuffers.Builder): void;
    static addSsrc(builder: flatbuffers.Builder, ssrc: number): void;
    static endFirTraceInfo(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createFirTraceInfo(builder: flatbuffers.Builder, ssrc: number): flatbuffers.Offset;
    unpack(): FirTraceInfoT;
    unpackTo(_o: FirTraceInfoT): void;
}
export declare class FirTraceInfoT implements flatbuffers.IGeneratedObject {
    ssrc: number;
    constructor(ssrc?: number);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=fir-trace-info.d.ts.map