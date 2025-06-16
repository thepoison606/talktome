import * as flatbuffers from 'flatbuffers';
import { Stats, StatsT } from '../../fbs/rtp-stream/stats';
export declare class GetStatsResponse implements flatbuffers.IUnpackableObject<GetStatsResponseT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): GetStatsResponse;
    static getRootAsGetStatsResponse(bb: flatbuffers.ByteBuffer, obj?: GetStatsResponse): GetStatsResponse;
    static getSizePrefixedRootAsGetStatsResponse(bb: flatbuffers.ByteBuffer, obj?: GetStatsResponse): GetStatsResponse;
    stats(index: number, obj?: Stats): Stats | null;
    statsLength(): number;
    static startGetStatsResponse(builder: flatbuffers.Builder): void;
    static addStats(builder: flatbuffers.Builder, statsOffset: flatbuffers.Offset): void;
    static createStatsVector(builder: flatbuffers.Builder, data: flatbuffers.Offset[]): flatbuffers.Offset;
    static startStatsVector(builder: flatbuffers.Builder, numElems: number): void;
    static endGetStatsResponse(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createGetStatsResponse(builder: flatbuffers.Builder, statsOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): GetStatsResponseT;
    unpackTo(_o: GetStatsResponseT): void;
}
export declare class GetStatsResponseT implements flatbuffers.IGeneratedObject {
    stats: (StatsT)[];
    constructor(stats?: (StatsT)[]);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=get-stats-response.d.ts.map