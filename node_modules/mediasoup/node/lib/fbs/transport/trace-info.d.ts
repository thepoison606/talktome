import { BweTraceInfo } from '../../fbs/transport/bwe-trace-info';
export declare enum TraceInfo {
    NONE = 0,
    BweTraceInfo = 1
}
export declare function unionToTraceInfo(type: TraceInfo, accessor: (obj: BweTraceInfo) => BweTraceInfo | null): BweTraceInfo | null;
export declare function unionListToTraceInfo(type: TraceInfo, accessor: (index: number, obj: BweTraceInfo) => BweTraceInfo | null, index: number): BweTraceInfo | null;
//# sourceMappingURL=trace-info.d.ts.map