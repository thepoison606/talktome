import * as flatbuffers from 'flatbuffers';
import { Dump, DumpT } from '../../fbs/transport/dump';
export declare class DumpResponse implements flatbuffers.IUnpackableObject<DumpResponseT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): DumpResponse;
    static getRootAsDumpResponse(bb: flatbuffers.ByteBuffer, obj?: DumpResponse): DumpResponse;
    static getSizePrefixedRootAsDumpResponse(bb: flatbuffers.ByteBuffer, obj?: DumpResponse): DumpResponse;
    base(obj?: Dump): Dump | null;
    static startDumpResponse(builder: flatbuffers.Builder): void;
    static addBase(builder: flatbuffers.Builder, baseOffset: flatbuffers.Offset): void;
    static endDumpResponse(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createDumpResponse(builder: flatbuffers.Builder, baseOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): DumpResponseT;
    unpackTo(_o: DumpResponseT): void;
}
export declare class DumpResponseT implements flatbuffers.IGeneratedObject {
    base: DumpT | null;
    constructor(base?: DumpT | null);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=dump-response.d.ts.map