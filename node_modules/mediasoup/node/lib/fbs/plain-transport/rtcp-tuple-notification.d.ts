import * as flatbuffers from 'flatbuffers';
import { Tuple, TupleT } from '../../fbs/transport/tuple';
export declare class RtcpTupleNotification implements flatbuffers.IUnpackableObject<RtcpTupleNotificationT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): RtcpTupleNotification;
    static getRootAsRtcpTupleNotification(bb: flatbuffers.ByteBuffer, obj?: RtcpTupleNotification): RtcpTupleNotification;
    static getSizePrefixedRootAsRtcpTupleNotification(bb: flatbuffers.ByteBuffer, obj?: RtcpTupleNotification): RtcpTupleNotification;
    tuple(obj?: Tuple): Tuple | null;
    static startRtcpTupleNotification(builder: flatbuffers.Builder): void;
    static addTuple(builder: flatbuffers.Builder, tupleOffset: flatbuffers.Offset): void;
    static endRtcpTupleNotification(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createRtcpTupleNotification(builder: flatbuffers.Builder, tupleOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): RtcpTupleNotificationT;
    unpackTo(_o: RtcpTupleNotificationT): void;
}
export declare class RtcpTupleNotificationT implements flatbuffers.IGeneratedObject {
    tuple: TupleT | null;
    constructor(tuple?: TupleT | null);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=rtcp-tuple-notification.d.ts.map