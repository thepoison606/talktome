import * as flatbuffers from 'flatbuffers';
export declare class MessageNotification implements flatbuffers.IUnpackableObject<MessageNotificationT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): MessageNotification;
    static getRootAsMessageNotification(bb: flatbuffers.ByteBuffer, obj?: MessageNotification): MessageNotification;
    static getSizePrefixedRootAsMessageNotification(bb: flatbuffers.ByteBuffer, obj?: MessageNotification): MessageNotification;
    ppid(): number;
    data(index: number): number | null;
    dataLength(): number;
    dataArray(): Uint8Array | null;
    static startMessageNotification(builder: flatbuffers.Builder): void;
    static addPpid(builder: flatbuffers.Builder, ppid: number): void;
    static addData(builder: flatbuffers.Builder, dataOffset: flatbuffers.Offset): void;
    static createDataVector(builder: flatbuffers.Builder, data: number[] | Uint8Array): flatbuffers.Offset;
    static startDataVector(builder: flatbuffers.Builder, numElems: number): void;
    static endMessageNotification(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createMessageNotification(builder: flatbuffers.Builder, ppid: number, dataOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): MessageNotificationT;
    unpackTo(_o: MessageNotificationT): void;
}
export declare class MessageNotificationT implements flatbuffers.IGeneratedObject {
    ppid: number;
    data: (number)[];
    constructor(ppid?: number, data?: (number)[]);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=message-notification.d.ts.map