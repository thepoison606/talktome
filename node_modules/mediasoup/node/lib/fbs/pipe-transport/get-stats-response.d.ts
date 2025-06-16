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
    tuple(obj?: Tuple): Tuple | null;
    static startGetStatsResponse(builder: flatbuffers.Builder): void;
    static addBase(builder: flatbuffers.Builder, baseOffset: flatbuffers.Offset): void;
    static addTuple(builder: flatbuffers.Builder, tupleOffset: flatbuffers.Offset): void;
    static endGetStatsResponse(builder: flatbuffers.Builder): flatbuffers.Offset;
    unpack(): GetStatsResponseT;
    unpackTo(_o: GetStatsResponseT): void;
}
export declare class GetStatsResponseT implements flatbuffers.IGeneratedObject {
    base: StatsT | null;
    tuple: TupleT | null;
    constructor(base?: StatsT | null, tuple?: TupleT | null);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=get-stats-response.d.ts.map