import { FirTraceInfo } from '../../fbs/consumer/fir-trace-info';
import { KeyFrameTraceInfo } from '../../fbs/consumer/key-frame-trace-info';
import { PliTraceInfo } from '../../fbs/consumer/pli-trace-info';
import { RtpTraceInfo } from '../../fbs/consumer/rtp-trace-info';
export declare enum TraceInfo {
    NONE = 0,
    KeyFrameTraceInfo = 1,
    FirTraceInfo = 2,
    PliTraceInfo = 3,
    RtpTraceInfo = 4
}
export declare function unionToTraceInfo(type: TraceInfo, accessor: (obj: FirTraceInfo | KeyFrameTraceInfo | PliTraceInfo | RtpTraceInfo) => FirTraceInfo | KeyFrameTraceInfo | PliTraceInfo | RtpTraceInfo | null): FirTraceInfo | KeyFrameTraceInfo | PliTraceInfo | RtpTraceInfo | null;
export declare function unionListToTraceInfo(type: TraceInfo, accessor: (index: number, obj: FirTraceInfo | KeyFrameTraceInfo | PliTraceInfo | RtpTraceInfo) => FirTraceInfo | KeyFrameTraceInfo | PliTraceInfo | RtpTraceInfo | null, index: number): FirTraceInfo | KeyFrameTraceInfo | PliTraceInfo | RtpTraceInfo | null;
//# sourceMappingURL=trace-info.d.ts.map