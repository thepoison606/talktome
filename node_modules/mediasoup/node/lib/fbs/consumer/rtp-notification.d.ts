import * as flatbuffers from 'flatbuffers';
export declare class RtpNotification implements flatbuffers.IUnpackableObject<RtpNotificationT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): RtpNotification;
    static getRootAsRtpNotification(bb: flatbuffers.ByteBuffer, obj?: RtpNotification): RtpNotification;
    static getSizePrefixedRootAsRtpNotification(bb: flatbuffers.ByteBuffer, obj?: RtpNotification): RtpNotification;
    data(index: number): number | null;
    dataLength(): number;
    dataArray(): Uint8Array | null;
    static startRtpNotification(builder: flatbuffers.Builder): void;
    static addData(builder: flatbuffers.Builder, dataOffset: flatbuffers.Offset): void;
    static createDataVector(builder: flatbuffers.Builder, data: number[] | Uint8Array): flatbuffers.Offset;
    static startDataVector(builder: flatbuffers.Builder, numElems: number): void;
    static endRtpNotification(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createRtpNotification(builder: flatbuffers.Builder, dataOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): RtpNotificationT;
    unpackTo(_o: RtpNotificationT): void;
}
export declare class RtpNotificationT implements flatbuffers.IGeneratedObject {
    data: (number)[];
    constructor(data?: (number)[]);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=rtp-notification.d.ts.map