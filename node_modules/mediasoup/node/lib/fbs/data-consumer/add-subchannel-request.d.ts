import * as flatbuffers from 'flatbuffers';
export declare class AddSubchannelRequest implements flatbuffers.IUnpackableObject<AddSubchannelRequestT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): AddSubchannelRequest;
    static getRootAsAddSubchannelRequest(bb: flatbuffers.ByteBuffer, obj?: AddSubchannelRequest): AddSubchannelRequest;
    static getSizePrefixedRootAsAddSubchannelRequest(bb: flatbuffers.ByteBuffer, obj?: AddSubchannelRequest): AddSubchannelRequest;
    subchannel(): number;
    static startAddSubchannelRequest(builder: flatbuffers.Builder): void;
    static addSubchannel(builder: flatbuffers.Builder, subchannel: number): void;
    static endAddSubchannelRequest(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createAddSubchannelRequest(builder: flatbuffers.Builder, subchannel: number): flatbuffers.Offset;
    unpack(): AddSubchannelRequestT;
    unpackTo(_o: AddSubchannelRequestT): void;
}
export declare class AddSubchannelRequestT implements flatbuffers.IGeneratedObject {
    subchannel: number;
    constructor(subchannel?: number);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=add-subchannel-request.d.ts.map