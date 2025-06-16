import * as flatbuffers from 'flatbuffers';
export declare class AddSubchannelResponse implements flatbuffers.IUnpackableObject<AddSubchannelResponseT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): AddSubchannelResponse;
    static getRootAsAddSubchannelResponse(bb: flatbuffers.ByteBuffer, obj?: AddSubchannelResponse): AddSubchannelResponse;
    static getSizePrefixedRootAsAddSubchannelResponse(bb: flatbuffers.ByteBuffer, obj?: AddSubchannelResponse): AddSubchannelResponse;
    subchannels(index: number): number | null;
    subchannelsLength(): number;
    subchannelsArray(): Uint16Array | null;
    static startAddSubchannelResponse(builder: flatbuffers.Builder): void;
    static addSubchannels(builder: flatbuffers.Builder, subchannelsOffset: flatbuffers.Offset): void;
    static createSubchannelsVector(builder: flatbuffers.Builder, data: number[] | Uint16Array): flatbuffers.Offset;
    /**
     * @deprecated This Uint8Array overload will be removed in the future.
     */
    static createSubchannelsVector(builder: flatbuffers.Builder, data: number[] | Uint8Array): flatbuffers.Offset;
    static startSubchannelsVector(builder: flatbuffers.Builder, numElems: number): void;
    static endAddSubchannelResponse(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createAddSubchannelResponse(builder: flatbuffers.Builder, subchannelsOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): AddSubchannelResponseT;
    unpackTo(_o: AddSubchannelResponseT): void;
}
export declare class AddSubchannelResponseT implements flatbuffers.IGeneratedObject {
    subchannels: (number)[];
    constructor(subchannels?: (number)[]);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=add-subchannel-response.d.ts.map