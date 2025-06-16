import * as flatbuffers from 'flatbuffers';
export declare class TupleHash implements flatbuffers.IUnpackableObject<TupleHashT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): TupleHash;
    static getRootAsTupleHash(bb: flatbuffers.ByteBuffer, obj?: TupleHash): TupleHash;
    static getSizePrefixedRootAsTupleHash(bb: flatbuffers.ByteBuffer, obj?: TupleHash): TupleHash;
    tupleHash(): bigint;
    webRtcTransportId(): string | null;
    webRtcTransportId(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    static startTupleHash(builder: flatbuffers.Builder): void;
    static addTupleHash(builder: flatbuffers.Builder, tupleHash: bigint): void;
    static addWebRtcTransportId(builder: flatbuffers.Builder, webRtcTransportIdOffset: flatbuffers.Offset): void;
    static endTupleHash(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createTupleHash(builder: flatbuffers.Builder, tupleHash: bigint, webRtcTransportIdOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): TupleHashT;
    unpackTo(_o: TupleHashT): void;
}
export declare class TupleHashT implements flatbuffers.IGeneratedObject {
    tupleHash: bigint;
    webRtcTransportId: string | Uint8Array | null;
    constructor(tupleHash?: bigint, webRtcTransportId?: string | Uint8Array | null);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=tuple-hash.d.ts.map