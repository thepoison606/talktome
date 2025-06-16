import * as flatbuffers from 'flatbuffers';
export declare class RemoveSubchannelResponse implements flatbuffers.IUnpackableObject<RemoveSubchannelResponseT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): RemoveSubchannelResponse;
    static getRootAsRemoveSubchannelResponse(bb: flatbuffers.ByteBuffer, obj?: RemoveSubchannelResponse): RemoveSubchannelResponse;
    static getSizePrefixedRootAsRemoveSubchannelResponse(bb: flatbuffers.ByteBuffer, obj?: RemoveSubchannelResponse): RemoveSubchannelResponse;
    subchannels(index: number): number | null;
    subchannelsLength(): number;
    subchannelsArray(): Uint16Array | null;
    static startRemoveSubchannelResponse(builder: flatbuffers.Builder): void;
    static addSubchannels(builder: flatbuffers.Builder, subchannelsOffset: flatbuffers.Offset): void;
    static createSubchannelsVector(builder: flatbuffers.Builder, data: number[] | Uint16Array): flatbuffers.Offset;
    /**
     * @deprecated This Uint8Array overload will be removed in the future.
     */
    static createSubchannelsVector(builder: flatbuffers.Builder, data: number[] | Uint8Array): flatbuffers.Offset;
    static startSubchannelsVector(builder: flatbuffers.Builder, numElems: number): void;
    static endRemoveSubchannelResponse(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createRemoveSubchannelResponse(builder: flatbuffers.Builder, subchannelsOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): RemoveSubchannelResponseT;
    unpackTo(_o: RemoveSubchannelResponseT): void;
}
export declare class RemoveSubchannelResponseT implements flatbuffers.IGeneratedObject {
    subchannels: (number)[];
    constructor(subchannels?: (number)[]);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=remove-subchannel-response.d.ts.map