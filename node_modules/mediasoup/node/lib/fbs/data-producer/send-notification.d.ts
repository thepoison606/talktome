import * as flatbuffers from 'flatbuffers';
export declare class SendNotification implements flatbuffers.IUnpackableObject<SendNotificationT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): SendNotification;
    static getRootAsSendNotification(bb: flatbuffers.ByteBuffer, obj?: SendNotification): SendNotification;
    static getSizePrefixedRootAsSendNotification(bb: flatbuffers.ByteBuffer, obj?: SendNotification): SendNotification;
    ppid(): number;
    data(index: number): number | null;
    dataLength(): number;
    dataArray(): Uint8Array | null;
    subchannels(index: number): number | null;
    subchannelsLength(): number;
    subchannelsArray(): Uint16Array | null;
    requiredSubchannel(): number | null;
    static startSendNotification(builder: flatbuffers.Builder): void;
    static addPpid(builder: flatbuffers.Builder, ppid: number): void;
    static addData(builder: flatbuffers.Builder, dataOffset: flatbuffers.Offset): void;
    static createDataVector(builder: flatbuffers.Builder, data: number[] | Uint8Array): flatbuffers.Offset;
    static startDataVector(builder: flatbuffers.Builder, numElems: number): void;
    static addSubchannels(builder: flatbuffers.Builder, subchannelsOffset: flatbuffers.Offset): void;
    static createSubchannelsVector(builder: flatbuffers.Builder, data: number[] | Uint16Array): flatbuffers.Offset;
    /**
     * @deprecated This Uint8Array overload will be removed in the future.
     */
    static createSubchannelsVector(builder: flatbuffers.Builder, data: number[] | Uint8Array): flatbuffers.Offset;
    static startSubchannelsVector(builder: flatbuffers.Builder, numElems: number): void;
    static addRequiredSubchannel(builder: flatbuffers.Builder, requiredSubchannel: number): void;
    static endSendNotification(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createSendNotification(builder: flatbuffers.Builder, ppid: number, dataOffset: flatbuffers.Offset, subchannelsOffset: flatbuffers.Offset, requiredSubchannel: number | null): flatbuffers.Offset;
    unpack(): SendNotificationT;
    unpackTo(_o: SendNotificationT): void;
}
export declare class SendNotificationT implements flatbuffers.IGeneratedObject {
    ppid: number;
    data: (number)[];
    subchannels: (number)[];
    requiredSubchannel: number | null;
    constructor(ppid?: number, data?: (number)[], subchannels?: (number)[], requiredSubchannel?: number | null);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=send-notification.d.ts.map