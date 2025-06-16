import * as flatbuffers from 'flatbuffers';
import { TraceDirection } from '../../fbs/common/trace-direction';
import { BweTraceInfoT } from '../../fbs/transport/bwe-trace-info';
import { TraceEventType } from '../../fbs/transport/trace-event-type';
import { TraceInfo } from '../../fbs/transport/trace-info';
export declare class TraceNotification implements flatbuffers.IUnpackableObject<TraceNotificationT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): TraceNotification;
    static getRootAsTraceNotification(bb: flatbuffers.ByteBuffer, obj?: TraceNotification): TraceNotification;
    static getSizePrefixedRootAsTraceNotification(bb: flatbuffers.ByteBuffer, obj?: TraceNotification): TraceNotification;
    type(): TraceEventType;
    timestamp(): bigint;
    direction(): TraceDirection;
    infoType(): TraceInfo;
    info<T extends flatbuffers.Table>(obj: any): any | null;
    static startTraceNotification(builder: flatbuffers.Builder): void;
    static addType(builder: flatbuffers.Builder, type: TraceEventType): void;
    static addTimestamp(builder: flatbuffers.Builder, timestamp: bigint): void;
    static addDirection(builder: flatbuffers.Builder, direction: TraceDirection): void;
    static addInfoType(builder: flatbuffers.Builder, infoType: TraceInfo): void;
    static addInfo(builder: flatbuffers.Builder, infoOffset: flatbuffers.Offset): void;
    static endTraceNotification(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createTraceNotification(builder: flatbuffers.Builder, type: TraceEventType, timestamp: bigint, direction: TraceDirection, infoType: TraceInfo, infoOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): TraceNotificationT;
    unpackTo(_o: TraceNotificationT): void;
}
export declare class TraceNotificationT implements flatbuffers.IGeneratedObject {
    type: TraceEventType;
    timestamp: bigint;
    direction: TraceDirection;
    infoType: TraceInfo;
    info: BweTraceInfoT | null;
    constructor(type?: TraceEventType, timestamp?: bigint, direction?: TraceDirection, infoType?: TraceInfo, info?: BweTraceInfoT | null);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=trace-notification.d.ts.map