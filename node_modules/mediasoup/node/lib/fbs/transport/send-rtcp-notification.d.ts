import * as flatbuffers from 'flatbuffers';
export declare class SendRtcpNotification implements flatbuffers.IUnpackableObject<SendRtcpNotificationT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): SendRtcpNotification;
    static getRootAsSendRtcpNotification(bb: flatbuffers.ByteBuffer, obj?: SendRtcpNotification): SendRtcpNotification;
    static getSizePrefixedRootAsSendRtcpNotification(bb: flatbuffers.ByteBuffer, obj?: SendRtcpNotification): SendRtcpNotification;
    data(index: number): number | null;
    dataLength(): number;
    dataArray(): Uint8Array | null;
    static startSendRtcpNotification(builder: flatbuffers.Builder): void;
    static addData(builder: flatbuffers.Builder, dataOffset: flatbuffers.Offset): void;
    static createDataVector(builder: flatbuffers.Builder, data: number[] | Uint8Array): flatbuffers.Offset;
    static startDataVector(builder: flatbuffers.Builder, numElems: number): void;
    static endSendRtcpNotification(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createSendRtcpNotification(builder: flatbuffers.Builder, dataOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): SendRtcpNotificationT;
    unpackTo(_o: SendRtcpNotificationT): void;
}
export declare class SendRtcpNotificationT implements flatbuffers.IGeneratedObject {
    data: (number)[];
    constructor(data?: (number)[]);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=send-rtcp-notification.d.ts.map