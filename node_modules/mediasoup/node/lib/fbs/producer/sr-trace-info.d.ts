import * as flatbuffers from 'flatbuffers';
export declare class SrTraceInfo implements flatbuffers.IUnpackableObject<SrTraceInfoT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): SrTraceInfo;
    static getRootAsSrTraceInfo(bb: flatbuffers.ByteBuffer, obj?: SrTraceInfo): SrTraceInfo;
    static getSizePrefixedRootAsSrTraceInfo(bb: flatbuffers.ByteBuffer, obj?: SrTraceInfo): SrTraceInfo;
    ssrc(): number;
    ntpSec(): number;
    ntpFrac(): number;
    rtpTs(): number;
    packetCount(): number;
    octetCount(): number;
    static startSrTraceInfo(builder: flatbuffers.Builder): void;
    static addSsrc(builder: flatbuffers.Builder, ssrc: number): void;
    static addNtpSec(builder: flatbuffers.Builder, ntpSec: number): void;
    static addNtpFrac(builder: flatbuffers.Builder, ntpFrac: number): void;
    static addRtpTs(builder: flatbuffers.Builder, rtpTs: number): void;
    static addPacketCount(builder: flatbuffers.Builder, packetCount: number): void;
    static addOctetCount(builder: flatbuffers.Builder, octetCount: number): void;
    static endSrTraceInfo(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createSrTraceInfo(builder: flatbuffers.Builder, ssrc: number, ntpSec: number, ntpFrac: number, rtpTs: number, packetCount: number, octetCount: number): flatbuffers.Offset;
    unpack(): SrTraceInfoT;
    unpackTo(_o: SrTraceInfoT): void;
}
export declare class SrTraceInfoT implements flatbuffers.IGeneratedObject {
    ssrc: number;
    ntpSec: number;
    ntpFrac: number;
    rtpTs: number;
    packetCount: number;
    octetCount: number;
    constructor(ssrc?: number, ntpSec?: number, ntpFrac?: number, rtpTs?: number, packetCount?: number, octetCount?: number);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=sr-trace-info.d.ts.map