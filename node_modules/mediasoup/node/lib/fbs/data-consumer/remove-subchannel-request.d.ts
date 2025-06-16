import * as flatbuffers from 'flatbuffers';
export declare class RemoveSubchannelRequest implements flatbuffers.IUnpackableObject<RemoveSubchannelRequestT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): RemoveSubchannelRequest;
    static getRootAsRemoveSubchannelRequest(bb: flatbuffers.ByteBuffer, obj?: RemoveSubchannelRequest): RemoveSubchannelRequest;
    static getSizePrefixedRootAsRemoveSubchannelRequest(bb: flatbuffers.ByteBuffer, obj?: RemoveSubchannelRequest): RemoveSubchannelRequest;
    subchannel(): number;
    static startRemoveSubchannelRequest(builder: flatbuffers.Builder): void;
    static addSubchannel(builder: flatbuffers.Builder, subchannel: number): void;
    static endRemoveSubchannelRequest(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createRemoveSubchannelRequest(builder: flatbuffers.Builder, subchannel: number): flatbuffers.Offset;
    unpack(): RemoveSubchannelRequestT;
    unpackTo(_o: RemoveSubchannelRequestT): void;
}
export declare class RemoveSubchannelRequestT implements flatbuffers.IGeneratedObject {
    subchannel: number;
    constructor(subchannel?: number);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=remove-subchannel-request.d.ts.map