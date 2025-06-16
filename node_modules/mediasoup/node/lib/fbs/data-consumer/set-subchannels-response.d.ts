import * as flatbuffers from 'flatbuffers';
export declare class SetSubchannelsResponse implements flatbuffers.IUnpackableObject<SetSubchannelsResponseT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): SetSubchannelsResponse;
    static getRootAsSetSubchannelsResponse(bb: flatbuffers.ByteBuffer, obj?: SetSubchannelsResponse): SetSubchannelsResponse;
    static getSizePrefixedRootAsSetSubchannelsResponse(bb: flatbuffers.ByteBuffer, obj?: SetSubchannelsResponse): SetSubchannelsResponse;
    subchannels(index: number): number | null;
    subchannelsLength(): number;
    subchannelsArray(): Uint16Array | null;
    static startSetSubchannelsResponse(builder: flatbuffers.Builder): void;
    static addSubchannels(builder: flatbuffers.Builder, subchannelsOffset: flatbuffers.Offset): void;
    static createSubchannelsVector(builder: flatbuffers.Builder, data: number[] | Uint16Array): flatbuffers.Offset;
    /**
     * @deprecated This Uint8Array overload will be removed in the future.
     */
    static createSubchannelsVector(builder: flatbuffers.Builder, data: number[] | Uint8Array): flatbuffers.Offset;
    static startSubchannelsVector(builder: flatbuffers.Builder, numElems: number): void;
    static endSetSubchannelsResponse(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createSetSubchannelsResponse(builder: flatbuffers.Builder, subchannelsOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): SetSubchannelsResponseT;
    unpackTo(_o: SetSubchannelsResponseT): void;
}
export declare class SetSubchannelsResponseT implements flatbuffers.IGeneratedObject {
    subchannels: (number)[];
    constructor(subchannels?: (number)[]);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=set-subchannels-response.d.ts.map