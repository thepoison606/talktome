import * as flatbuffers from 'flatbuffers';
export declare class Log implements flatbuffers.IUnpackableObject<LogT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): Log;
    static getRootAsLog(bb: flatbuffers.ByteBuffer, obj?: Log): Log;
    static getSizePrefixedRootAsLog(bb: flatbuffers.ByteBuffer, obj?: Log): Log;
    data(): string | null;
    data(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    static startLog(builder: flatbuffers.Builder): void;
    static addData(builder: flatbuffers.Builder, dataOffset: flatbuffers.Offset): void;
    static endLog(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createLog(builder: flatbuffers.Builder, dataOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): LogT;
    unpackTo(_o: LogT): void;
}
export declare class LogT implements flatbuffers.IGeneratedObject {
    data: string | Uint8Array | null;
    constructor(data?: string | Uint8Array | null);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=log.d.ts.map