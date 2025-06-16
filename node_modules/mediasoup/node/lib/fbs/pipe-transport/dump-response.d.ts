import * as flatbuffers from 'flatbuffers';
import { SrtpParameters, SrtpParametersT } from '../../fbs/srtp-parameters/srtp-parameters';
import { Dump, DumpT } from '../../fbs/transport/dump';
import { Tuple, TupleT } from '../../fbs/transport/tuple';
export declare class DumpResponse implements flatbuffers.IUnpackableObject<DumpResponseT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): DumpResponse;
    static getRootAsDumpResponse(bb: flatbuffers.ByteBuffer, obj?: DumpResponse): DumpResponse;
    static getSizePrefixedRootAsDumpResponse(bb: flatbuffers.ByteBuffer, obj?: DumpResponse): DumpResponse;
    base(obj?: Dump): Dump | null;
    tuple(obj?: Tuple): Tuple | null;
    rtx(): boolean;
    srtpParameters(obj?: SrtpParameters): SrtpParameters | null;
    static startDumpResponse(builder: flatbuffers.Builder): void;
    static addBase(builder: flatbuffers.Builder, baseOffset: flatbuffers.Offset): void;
    static addTuple(builder: flatbuffers.Builder, tupleOffset: flatbuffers.Offset): void;
    static addRtx(builder: flatbuffers.Builder, rtx: boolean): void;
    static addSrtpParameters(builder: flatbuffers.Builder, srtpParametersOffset: flatbuffers.Offset): void;
    static endDumpResponse(builder: flatbuffers.Builder): flatbuffers.Offset;
    unpack(): DumpResponseT;
    unpackTo(_o: DumpResponseT): void;
}
export declare class DumpResponseT implements flatbuffers.IGeneratedObject {
    base: DumpT | null;
    tuple: TupleT | null;
    rtx: boolean;
    srtpParameters: SrtpParametersT | null;
    constructor(base?: DumpT | null, tuple?: TupleT | null, rtx?: boolean, srtpParameters?: SrtpParametersT | null);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=dump-response.d.ts.map