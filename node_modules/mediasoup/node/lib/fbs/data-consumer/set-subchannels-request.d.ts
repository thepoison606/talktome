import * as flatbuffers from 'flatbuffers';
export declare class SetSubchannelsRequest implements flatbuffers.IUnpackableObject<SetSubchannelsRequestT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): SetSubchannelsRequest;
    static getRootAsSetSubchannelsRequest(bb: flatbuffers.ByteBuffer, obj?: SetSubchannelsRequest): SetSubchannelsRequest;
    static getSizePrefixedRootAsSetSubchannelsRequest(bb: flatbuffers.ByteBuffer, obj?: SetSubchannelsRequest): SetSubchannelsRequest;
    subchannels(index: number): number | null;
    subchannelsLength(): number;
    subchannelsArray(): Uint16Array | null;
    static startSetSubchannelsRequest(builder: flatbuffers.Builder): void;
    static addSubchannels(builder: flatbuffers.Builder, subchannelsOffset: flatbuffers.Offset): void;
    static createSubchannelsVector(builder: flatbuffers.Builder, data: number[] | Uint16Array): flatbuffers.Offset;
    /**
     * @deprecated This Uint8Array overload will be removed in the future.
     */
    static createSubchannelsVector(builder: flatbuffers.Builder, data: number[] | Uint8Array): flatbuffers.Offset;
    static startSubchannelsVector(builder: flatbuffers.Builder, numElems: number): void;
    static endSetSubchannelsRequest(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createSetSubchannelsRequest(builder: flatbuffers.Builder, subchannelsOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): SetSubchannelsRequestT;
    unpackTo(_o: SetSubchannelsRequestT): void;
}
export declare class SetSubchannelsRequestT implements flatbuffers.IGeneratedObject {
    subchannels: (number)[];
    constructor(subchannels?: (number)[]);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=set-subchannels-request.d.ts.map