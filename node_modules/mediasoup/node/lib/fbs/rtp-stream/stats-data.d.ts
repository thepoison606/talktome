import { BaseStats } from '../../fbs/rtp-stream/base-stats';
import { RecvStats } from '../../fbs/rtp-stream/recv-stats';
import { SendStats } from '../../fbs/rtp-stream/send-stats';
export declare enum StatsData {
    NONE = 0,
    BaseStats = 1,
    RecvStats = 2,
    SendStats = 3
}
export declare function unionToStatsData(type: StatsData, accessor: (obj: BaseStats | RecvStats | SendStats) => BaseStats | RecvStats | SendStats | null): BaseStats | RecvStats | SendStats | null;
export declare function unionListToStatsData(type: StatsData, accessor: (index: number, obj: BaseStats | RecvStats | SendStats) => BaseStats | RecvStats | SendStats | null, index: number): BaseStats | RecvStats | SendStats | null;
//# sourceMappingURL=stats-data.d.ts.map