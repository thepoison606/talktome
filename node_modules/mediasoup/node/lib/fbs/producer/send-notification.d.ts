import * as flatbuffers from 'flatbuffers';
export declare class SendNotification implements flatbuffers.IUnpackableObject<SendNotificationT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): SendNotification;
    static getRootAsSendNotification(bb: flatbuffers.ByteBuffer, obj?: SendNotification): SendNotification;
    static getSizePrefixedRootAsSendNotification(bb: flatbuffers.ByteBuffer, obj?: SendNotification): SendNotification;
    data(index: number): number | null;
    dataLength(): number;
    dataArray(): Uint8Array | null;
    static startSendNotification(builder: flatbuffers.Builder): void;
    static addData(builder: flatbuffers.Builder, dataOffset: flatbuffers.Offset): void;
    static createDataVector(builder: flatbuffers.Builder, data: number[] | Uint8Array): flatbuffers.Offset;
    static startDataVector(builder: flatbuffers.Builder, numElems: number): void;
    static endSendNotification(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createSendNotification(builder: flatbuffers.Builder, dataOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): SendNotificationT;
    unpackTo(_o: SendNotificationT): void;
}
export declare class SendNotificationT implements flatbuffers.IGeneratedObject {
    data: (number)[];
    constructor(data?: (number)[]);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=send-notification.d.ts.map