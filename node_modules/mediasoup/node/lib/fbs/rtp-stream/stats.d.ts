import * as flatbuffers from 'flatbuffers';
import { BaseStatsT } from '../../fbs/rtp-stream/base-stats';
import { RecvStatsT } from '../../fbs/rtp-stream/recv-stats';
import { SendStatsT } from '../../fbs/rtp-stream/send-stats';
import { StatsData } from '../../fbs/rtp-stream/stats-data';
export declare class Stats implements flatbuffers.IUnpackableObject<StatsT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): Stats;
    static getRootAsStats(bb: flatbuffers.ByteBuffer, obj?: Stats): Stats;
    static getSizePrefixedRootAsStats(bb: flatbuffers.ByteBuffer, obj?: Stats): Stats;
    dataType(): StatsData;
    data<T extends flatbuffers.Table>(obj: any): any | null;
    static startStats(builder: flatbuffers.Builder): void;
    static addDataType(builder: flatbuffers.Builder, dataType: StatsData): void;
    static addData(builder: flatbuffers.Builder, dataOffset: flatbuffers.Offset): void;
    static endStats(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createStats(builder: flatbuffers.Builder, dataType: StatsData, dataOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): StatsT;
    unpackTo(_o: StatsT): void;
}
export declare class StatsT implements flatbuffers.IGeneratedObject {
    dataType: StatsData;
    data: BaseStatsT | RecvStatsT | SendStatsT | null;
    constructor(dataType?: StatsData, data?: BaseStatsT | RecvStatsT | SendStatsT | null);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=stats.d.ts.map