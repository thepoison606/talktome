import * as flatbuffers from 'flatbuffers';
import { Tuple, TupleT } from '../../fbs/transport/tuple';
export declare class TupleNotification implements flatbuffers.IUnpackableObject<TupleNotificationT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): TupleNotification;
    static getRootAsTupleNotification(bb: flatbuffers.ByteBuffer, obj?: TupleNotification): TupleNotification;
    static getSizePrefixedRootAsTupleNotification(bb: flatbuffers.ByteBuffer, obj?: TupleNotification): TupleNotification;
    tuple(obj?: Tuple): Tuple | null;
    static startTupleNotification(builder: flatbuffers.Builder): void;
    static addTuple(builder: flatbuffers.Builder, tupleOffset: flatbuffers.Offset): void;
    static endTupleNotification(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createTupleNotification(builder: flatbuffers.Builder, tupleOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): TupleNotificationT;
    unpackTo(_o: TupleNotificationT): void;
}
export declare class TupleNotificationT implements flatbuffers.IGeneratedObject {
    tuple: TupleT | null;
    constructor(tuple?: TupleT | null);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=tuple-notification.d.ts.map