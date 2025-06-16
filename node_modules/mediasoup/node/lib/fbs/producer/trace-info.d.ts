import { FirTraceInfo } from '../../fbs/producer/fir-trace-info';
import { KeyFrameTraceInfo } from '../../fbs/producer/key-frame-trace-info';
import { PliTraceInfo } from '../../fbs/producer/pli-trace-info';
import { RtpTraceInfo } from '../../fbs/producer/rtp-trace-info';
import { SrTraceInfo } from '../../fbs/producer/sr-trace-info';
export declare enum TraceInfo {
    NONE = 0,
    KeyFrameTraceInfo = 1,
    FirTraceInfo = 2,
    PliTraceInfo = 3,
    RtpTraceInfo = 4,
    SrTraceInfo = 5
}
export declare function unionToTraceInfo(type: TraceInfo, accessor: (obj: FirTraceInfo | KeyFrameTraceInfo | PliTraceInfo | RtpTraceInfo | SrTraceInfo) => FirTraceInfo | KeyFrameTraceInfo | PliTraceInfo | RtpTraceInfo | SrTraceInfo | null): FirTraceInfo | KeyFrameTraceInfo | PliTraceInfo | RtpTraceInfo | SrTraceInfo | null;
export declare function unionListToTraceInfo(type: TraceInfo, accessor: (index: number, obj: FirTraceInfo | KeyFrameTraceInfo | PliTraceInfo | RtpTraceInfo | SrTraceInfo) => FirTraceInfo | KeyFrameTraceInfo | PliTraceInfo | RtpTraceInfo | SrTraceInfo | null, index: number): FirTraceInfo | KeyFrameTraceInfo | PliTraceInfo | RtpTraceInfo | SrTraceInfo | null;
//# sourceMappingURL=trace-info.d.ts.map