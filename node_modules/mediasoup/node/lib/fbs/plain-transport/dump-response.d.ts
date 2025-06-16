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
    rtcpMux(): boolean;
    comedia(): boolean;
    tuple(obj?: Tuple): Tuple | null;
    rtcpTuple(obj?: Tuple): Tuple | null;
    srtpParameters(obj?: SrtpParameters): SrtpParameters | null;
    static startDumpResponse(builder: flatbuffers.Builder): void;
    static addBase(builder: flatbuffers.Builder, baseOffset: flatbuffers.Offset): void;
    static addRtcpMux(builder: flatbuffers.Builder, rtcpMux: boolean): void;
    static addComedia(builder: flatbuffers.Builder, comedia: boolean): void;
    static addTuple(builder: flatbuffers.Builder, tupleOffset: flatbuffers.Offset): void;
    static addRtcpTuple(builder: flatbuffers.Builder, rtcpTupleOffset: flatbuffers.Offset): void;
    static addSrtpParameters(builder: flatbuffers.Builder, srtpParametersOffset: flatbuffers.Offset): void;
    static endDumpResponse(builder: flatbuffers.Builder): flatbuffers.Offset;
    unpack(): DumpResponseT;
    unpackTo(_o: DumpResponseT): void;
}
export declare class DumpResponseT implements flatbuffers.IGeneratedObject {
    base: DumpT | null;
    rtcpMux: boolean;
    comedia: boolean;
    tuple: TupleT | null;
    rtcpTuple: TupleT | null;
    srtpParameters: SrtpParametersT | null;
    constructor(base?: DumpT | null, rtcpMux?: boolean, comedia?: boolean, tuple?: TupleT | null, rtcpTuple?: TupleT | null, srtpParameters?: SrtpParametersT | null);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=dump-response.d.ts.map