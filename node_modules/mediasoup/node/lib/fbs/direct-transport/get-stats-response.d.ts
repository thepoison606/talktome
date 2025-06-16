import * as flatbuffers from 'flatbuffers';
import { Stats, StatsT } from '../../fbs/transport/stats';
export declare class GetStatsResponse implements flatbuffers.IUnpackableObject<GetStatsResponseT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): GetStatsResponse;
    static getRootAsGetStatsResponse(bb: flatbuffers.ByteBuffer, obj?: GetStatsResponse): GetStatsResponse;
    static getSizePrefixedRootAsGetStatsResponse(bb: flatbuffers.ByteBuffer, obj?: GetStatsResponse): GetStatsResponse;
    base(obj?: Stats): Stats | null;
    static startGetStatsResponse(builder: flatbuffers.Builder): void;
    static addBase(builder: flatbuffers.Builder, baseOffset: flatbuffers.Offset): void;
    static endGetStatsResponse(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createGetStatsResponse(builder: flatbuffers.Builder, baseOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): GetStatsResponseT;
    unpackTo(_o: GetStatsResponseT): void;
}
export declare class GetStatsResponseT implements flatbuffers.IGeneratedObject {
    base: StatsT | null;
    constructor(base?: StatsT | null);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=get-stats-response.d.ts.map