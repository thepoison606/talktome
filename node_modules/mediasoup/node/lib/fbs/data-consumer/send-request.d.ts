import * as flatbuffers from 'flatbuffers';
export declare class SendRequest implements flatbuffers.IUnpackableObject<SendRequestT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): SendRequest;
    static getRootAsSendRequest(bb: flatbuffers.ByteBuffer, obj?: SendRequest): SendRequest;
    static getSizePrefixedRootAsSendRequest(bb: flatbuffers.ByteBuffer, obj?: SendRequest): SendRequest;
    ppid(): number;
    data(index: number): number | null;
    dataLength(): number;
    dataArray(): Uint8Array | null;
    static startSendRequest(builder: flatbuffers.Builder): void;
    static addPpid(builder: flatbuffers.Builder, ppid: number): void;
    static addData(builder: flatbuffers.Builder, dataOffset: flatbuffers.Offset): void;
    static createDataVector(builder: flatbuffers.Builder, data: number[] | Uint8Array): flatbuffers.Offset;
    static startDataVector(builder: flatbuffers.Builder, numElems: number): void;
    static endSendRequest(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createSendRequest(builder: flatbuffers.Builder, ppid: number, dataOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): SendRequestT;
    unpackTo(_o: SendRequestT): void;
}
export declare class SendRequestT implements flatbuffers.IGeneratedObject {
    ppid: number;
    data: (number)[];
    constructor(ppid?: number, data?: (number)[]);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=send-request.d.ts.map