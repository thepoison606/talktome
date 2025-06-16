import * as flatbuffers from 'flatbuffers';
import { Dump, DumpT } from '../../fbs/rtp-packet/dump';
export declare class KeyFrameTraceInfo implements flatbuffers.IUnpackableObject<KeyFrameTraceInfoT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): KeyFrameTraceInfo;
    static getRootAsKeyFrameTraceInfo(bb: flatbuffers.ByteBuffer, obj?: KeyFrameTraceInfo): KeyFrameTraceInfo;
    static getSizePrefixedRootAsKeyFrameTraceInfo(bb: flatbuffers.ByteBuffer, obj?: KeyFrameTraceInfo): KeyFrameTraceInfo;
    rtpPacket(obj?: Dump): Dump | null;
    isRtx(): boolean;
    static startKeyFrameTraceInfo(builder: flatbuffers.Builder): void;
    static addRtpPacket(builder: flatbuffers.Builder, rtpPacketOffset: flatbuffers.Offset): void;
    static addIsRtx(builder: flatbuffers.Builder, isRtx: boolean): void;
    static endKeyFrameTraceInfo(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createKeyFrameTraceInfo(builder: flatbuffers.Builder, rtpPacketOffset: flatbuffers.Offset, isRtx: boolean): flatbuffers.Offset;
    unpack(): KeyFrameTraceInfoT;
    unpackTo(_o: KeyFrameTraceInfoT): void;
}
export declare class KeyFrameTraceInfoT implements flatbuffers.IGeneratedObject {
    rtpPacket: DumpT | null;
    isRtx: boolean;
    constructor(rtpPacket?: DumpT | null, isRtx?: boolean);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=key-frame-trace-info.d.ts.map