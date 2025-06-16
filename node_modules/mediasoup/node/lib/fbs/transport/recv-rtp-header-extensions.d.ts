import * as flatbuffers from 'flatbuffers';
export declare class RecvRtpHeaderExtensions implements flatbuffers.IUnpackableObject<RecvRtpHeaderExtensionsT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): RecvRtpHeaderExtensions;
    static getRootAsRecvRtpHeaderExtensions(bb: flatbuffers.ByteBuffer, obj?: RecvRtpHeaderExtensions): RecvRtpHeaderExtensions;
    static getSizePrefixedRootAsRecvRtpHeaderExtensions(bb: flatbuffers.ByteBuffer, obj?: RecvRtpHeaderExtensions): RecvRtpHeaderExtensions;
    mid(): number | null;
    rid(): number | null;
    rrid(): number | null;
    absSendTime(): number | null;
    transportWideCc01(): number | null;
    static startRecvRtpHeaderExtensions(builder: flatbuffers.Builder): void;
    static addMid(builder: flatbuffers.Builder, mid: number): void;
    static addRid(builder: flatbuffers.Builder, rid: number): void;
    static addRrid(builder: flatbuffers.Builder, rrid: number): void;
    static addAbsSendTime(builder: flatbuffers.Builder, absSendTime: number): void;
    static addTransportWideCc01(builder: flatbuffers.Builder, transportWideCc01: number): void;
    static endRecvRtpHeaderExtensions(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createRecvRtpHeaderExtensions(builder: flatbuffers.Builder, mid: number | null, rid: number | null, rrid: number | null, absSendTime: number | null, transportWideCc01: number | null): flatbuffers.Offset;
    unpack(): RecvRtpHeaderExtensionsT;
    unpackTo(_o: RecvRtpHeaderExtensionsT): void;
}
export declare class RecvRtpHeaderExtensionsT implements flatbuffers.IGeneratedObject {
    mid: number | null;
    rid: number | null;
    rrid: number | null;
    absSendTime: number | null;
    transportWideCc01: number | null;
    constructor(mid?: number | null, rid?: number | null, rrid?: number | null, absSendTime?: number | null, transportWideCc01?: number | null);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=recv-rtp-header-extensions.d.ts.map