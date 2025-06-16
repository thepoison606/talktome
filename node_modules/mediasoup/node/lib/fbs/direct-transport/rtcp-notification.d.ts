import * as flatbuffers from 'flatbuffers';
export declare class RtcpNotification implements flatbuffers.IUnpackableObject<RtcpNotificationT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): RtcpNotification;
    static getRootAsRtcpNotification(bb: flatbuffers.ByteBuffer, obj?: RtcpNotification): RtcpNotification;
    static getSizePrefixedRootAsRtcpNotification(bb: flatbuffers.ByteBuffer, obj?: RtcpNotification): RtcpNotification;
    data(index: number): number | null;
    dataLength(): number;
    dataArray(): Uint8Array | null;
    static startRtcpNotification(builder: flatbuffers.Builder): void;
    static addData(builder: flatbuffers.Builder, dataOffset: flatbuffers.Offset): void;
    static createDataVector(builder: flatbuffers.Builder, data: number[] | Uint8Array): flatbuffers.Offset;
    static startDataVector(builder: flatbuffers.Builder, numElems: number): void;
    static endRtcpNotification(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createRtcpNotification(builder: flatbuffers.Builder, dataOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): RtcpNotificationT;
    unpackTo(_o: RtcpNotificationT): void;
}
export declare class RtcpNotificationT implements flatbuffers.IGeneratedObject {
    data: (number)[];
    constructor(data?: (number)[]);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=rtcp-notification.d.ts.map