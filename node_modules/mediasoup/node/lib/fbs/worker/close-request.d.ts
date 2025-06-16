import * as flatbuffers from 'flatbuffers';
export declare class CloseRequest implements flatbuffers.IUnpackableObject<CloseRequestT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): CloseRequest;
    static getRootAsCloseRequest(bb: flatbuffers.ByteBuffer, obj?: CloseRequest): CloseRequest;
    static getSizePrefixedRootAsCloseRequest(bb: flatbuffers.ByteBuffer, obj?: CloseRequest): CloseRequest;
    static startCloseRequest(builder: flatbuffers.Builder): void;
    static endCloseRequest(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createCloseRequest(builder: flatbuffers.Builder): flatbuffers.Offset;
    unpack(): CloseRequestT;
    unpackTo(_o: CloseRequestT): void;
}
export declare class CloseRequestT implements flatbuffers.IGeneratedObject {
    constructor();
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=close-request.d.ts.map