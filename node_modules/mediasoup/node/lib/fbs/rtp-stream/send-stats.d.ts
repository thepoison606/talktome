import * as flatbuffers from 'flatbuffers';
import { Stats, StatsT } from '../../fbs/rtp-stream/stats';
export declare class SendStats implements flatbuffers.IUnpackableObject<SendStatsT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): SendStats;
    static getRootAsSendStats(bb: flatbuffers.ByteBuffer, obj?: SendStats): SendStats;
    static getSizePrefixedRootAsSendStats(bb: flatbuffers.ByteBuffer, obj?: SendStats): SendStats;
    base(obj?: Stats): Stats | null;
    packetCount(): bigint;
    byteCount(): bigint;
    bitrate(): number;
    static startSendStats(builder: flatbuffers.Builder): void;
    static addBase(builder: flatbuffers.Builder, baseOffset: flatbuffers.Offset): void;
    static addPacketCount(builder: flatbuffers.Builder, packetCount: bigint): void;
    static addByteCount(builder: flatbuffers.Builder, byteCount: bigint): void;
    static addBitrate(builder: flatbuffers.Builder, bitrate: number): void;
    static endSendStats(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createSendStats(builder: flatbuffers.Builder, baseOffset: flatbuffers.Offset, packetCount: bigint, byteCount: bigint, bitrate: number): flatbuffers.Offset;
    unpack(): SendStatsT;
    unpackTo(_o: SendStatsT): void;
}
export declare class SendStatsT implements flatbuffers.IGeneratedObject {
    base: StatsT | null;
    packetCount: bigint;
    byteCount: bigint;
    bitrate: number;
    constructor(base?: StatsT | null, packetCount?: bigint, byteCount?: bigint, bitrate?: number);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=send-stats.d.ts.map