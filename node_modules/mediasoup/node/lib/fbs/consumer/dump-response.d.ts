import * as flatbuffers from 'flatbuffers';
import { ConsumerDump, ConsumerDumpT } from '../../fbs/consumer/consumer-dump';
export declare class DumpResponse implements flatbuffers.IUnpackableObject<DumpResponseT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): DumpResponse;
    static getRootAsDumpResponse(bb: flatbuffers.ByteBuffer, obj?: DumpResponse): DumpResponse;
    static getSizePrefixedRootAsDumpResponse(bb: flatbuffers.ByteBuffer, obj?: DumpResponse): DumpResponse;
    data(obj?: ConsumerDump): ConsumerDump | null;
    static startDumpResponse(builder: flatbuffers.Builder): void;
    static addData(builder: flatbuffers.Builder, dataOffset: flatbuffers.Offset): void;
    static endDumpResponse(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createDumpResponse(builder: flatbuffers.Builder, dataOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): DumpResponseT;
    unpackTo(_o: DumpResponseT): void;
}
export declare class DumpResponseT implements flatbuffers.IGeneratedObject {
    data: ConsumerDumpT | null;
    constructor(data?: ConsumerDumpT | null);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=dump-response.d.ts.map