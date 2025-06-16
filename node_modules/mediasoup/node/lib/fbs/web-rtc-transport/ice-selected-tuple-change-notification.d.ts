import * as flatbuffers from 'flatbuffers';
import { Tuple, TupleT } from '../../fbs/transport/tuple';
export declare class IceSelectedTupleChangeNotification implements flatbuffers.IUnpackableObject<IceSelectedTupleChangeNotificationT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): IceSelectedTupleChangeNotification;
    static getRootAsIceSelectedTupleChangeNotification(bb: flatbuffers.ByteBuffer, obj?: IceSelectedTupleChangeNotification): IceSelectedTupleChangeNotification;
    static getSizePrefixedRootAsIceSelectedTupleChangeNotification(bb: flatbuffers.ByteBuffer, obj?: IceSelectedTupleChangeNotification): IceSelectedTupleChangeNotification;
    tuple(obj?: Tuple): Tuple | null;
    static startIceSelectedTupleChangeNotification(builder: flatbuffers.Builder): void;
    static addTuple(builder: flatbuffers.Builder, tupleOffset: flatbuffers.Offset): void;
    static endIceSelectedTupleChangeNotification(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createIceSelectedTupleChangeNotification(builder: flatbuffers.Builder, tupleOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): IceSelectedTupleChangeNotificationT;
    unpackTo(_o: IceSelectedTupleChangeNotificationT): void;
}
export declare class IceSelectedTupleChangeNotificationT implements flatbuffers.IGeneratedObject {
    tuple: TupleT | null;
    constructor(tuple?: TupleT | null);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=ice-selected-tuple-change-notification.d.ts.map