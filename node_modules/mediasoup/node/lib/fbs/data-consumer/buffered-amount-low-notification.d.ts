import * as flatbuffers from 'flatbuffers';
export declare class BufferedAmountLowNotification implements flatbuffers.IUnpackableObject<BufferedAmountLowNotificationT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): BufferedAmountLowNotification;
    static getRootAsBufferedAmountLowNotification(bb: flatbuffers.ByteBuffer, obj?: BufferedAmountLowNotification): BufferedAmountLowNotification;
    static getSizePrefixedRootAsBufferedAmountLowNotification(bb: flatbuffers.ByteBuffer, obj?: BufferedAmountLowNotification): BufferedAmountLowNotification;
    bufferedAmount(): number;
    static startBufferedAmountLowNotification(builder: flatbuffers.Builder): void;
    static addBufferedAmount(builder: flatbuffers.Builder, bufferedAmount: number): void;
    static endBufferedAmountLowNotification(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createBufferedAmountLowNotification(builder: flatbuffers.Builder, bufferedAmount: number): flatbuffers.Offset;
    unpack(): BufferedAmountLowNotificationT;
    unpackTo(_o: BufferedAmountLowNotificationT): void;
}
export declare class BufferedAmountLowNotificationT implements flatbuffers.IGeneratedObject {
    bufferedAmount: number;
    constructor(bufferedAmount?: number);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=buffered-amount-low-notification.d.ts.map