import * as flatbuffers from 'flatbuffers';
import { Stats, StatsT } from '../../fbs/transport/stats';
import { Tuple, TupleT } from '../../fbs/transport/tuple';
export declare class GetStatsResponse implements flatbuffers.IUnpackableObject<GetStatsResponseT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): GetStatsResponse;
    static getRootAsGetStatsResponse(bb: flatbuffers.ByteBuffer, obj?: GetStatsResponse): GetStatsResponse;
    static getSizePrefixedRootAsGetStatsResponse(bb: flatbuffers.ByteBuffer, obj?: GetStatsResponse): GetStatsResponse;
    base(obj?: Stats): Stats | null;
    rtcpMux(): boolean;
    comedia(): boolean;
    tuple(obj?: Tuple): Tuple | null;
    rtcpTuple(obj?: Tuple): Tuple | null;
    static startGetStatsResponse(builder: flatbuffers.Builder): void;
    static addBase(builder: flatbuffers.Builder, baseOffset: flatbuffers.Offset): void;
    static addRtcpMux(builder: flatbuffers.Builder, rtcpMux: boolean): void;
    static addComedia(builder: flatbuffers.Builder, comedia: boolean): void;
    static addTuple(builder: flatbuffers.Builder, tupleOffset: flatbuffers.Offset): void;
    static addRtcpTuple(builder: flatbuffers.Builder, rtcpTupleOffset: flatbuffers.Offset): void;
    static endGetStatsResponse(builder: flatbuffers.Builder): flatbuffers.Offset;
    unpack(): GetStatsResponseT;
    unpackTo(_o: GetStatsResponseT): void;
}
export declare class GetStatsResponseT implements flatbuffers.IGeneratedObject {
    base: StatsT | null;
    rtcpMux: boolean;
    comedia: boolean;
    tuple: TupleT | null;
    rtcpTuple: TupleT | null;
    constructor(base?: StatsT | null, rtcpMux?: boolean, comedia?: boolean, tuple?: TupleT | null, rtcpTuple?: TupleT | null);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=get-stats-response.d.ts.map