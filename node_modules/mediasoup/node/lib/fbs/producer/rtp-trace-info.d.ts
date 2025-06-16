import * as flatbuffers from 'flatbuffers';
import { Dump, DumpT } from '../../fbs/rtp-packet/dump';
export declare class RtpTraceInfo implements flatbuffers.IUnpackableObject<RtpTraceInfoT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): RtpTraceInfo;
    static getRootAsRtpTraceInfo(bb: flatbuffers.ByteBuffer, obj?: RtpTraceInfo): RtpTraceInfo;
    static getSizePrefixedRootAsRtpTraceInfo(bb: flatbuffers.ByteBuffer, obj?: RtpTraceInfo): RtpTraceInfo;
    rtpPacket(obj?: Dump): Dump | null;
    isRtx(): boolean;
    static startRtpTraceInfo(builder: flatbuffers.Builder): void;
    static addRtpPacket(builder: flatbuffers.Builder, rtpPacketOffset: flatbuffers.Offset): void;
    static addIsRtx(builder: flatbuffers.Builder, isRtx: boolean): void;
    static endRtpTraceInfo(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createRtpTraceInfo(builder: flatbuffers.Builder, rtpPacketOffset: flatbuffers.Offset, isRtx: boolean): flatbuffers.Offset;
    unpack(): RtpTraceInfoT;
    unpackTo(_o: RtpTraceInfoT): void;
}
export declare class RtpTraceInfoT implements flatbuffers.IGeneratedObject {
    rtpPacket: DumpT | null;
    isRtx: boolean;
    constructor(rtpPacket?: DumpT | null, isRtx?: boolean);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=rtp-trace-info.d.ts.map