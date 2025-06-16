import * as flatbuffers from 'flatbuffers';
export declare class SetMinOutgoingBitrateRequest implements flatbuffers.IUnpackableObject<SetMinOutgoingBitrateRequestT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): SetMinOutgoingBitrateRequest;
    static getRootAsSetMinOutgoingBitrateRequest(bb: flatbuffers.ByteBuffer, obj?: SetMinOutgoingBitrateRequest): SetMinOutgoingBitrateRequest;
    static getSizePrefixedRootAsSetMinOutgoingBitrateRequest(bb: flatbuffers.ByteBuffer, obj?: SetMinOutgoingBitrateRequest): SetMinOutgoingBitrateRequest;
    minOutgoingBitrate(): number;
    static startSetMinOutgoingBitrateRequest(builder: flatbuffers.Builder): void;
    static addMinOutgoingBitrate(builder: flatbuffers.Builder, minOutgoingBitrate: number): void;
    static endSetMinOutgoingBitrateRequest(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createSetMinOutgoingBitrateRequest(builder: flatbuffers.Builder, minOutgoingBitrate: number): flatbuffers.Offset;
    unpack(): SetMinOutgoingBitrateRequestT;
    unpackTo(_o: SetMinOutgoingBitrateRequestT): void;
}
export declare class SetMinOutgoingBitrateRequestT implements flatbuffers.IGeneratedObject {
    minOutgoingBitrate: number;
    constructor(minOutgoingBitrate?: number);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=set-min-outgoing-bitrate-request.d.ts.map